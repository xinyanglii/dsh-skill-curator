// dsh-skill-curator: an in-process, Hermes-style background skill reviewer.
//
// It observes the live session event feed, counts model iterations per root
// session, and after a completed turn crosses the threshold it starts a child
// agent — in this same process — whose agent preset exposes only the skill
// tools. The child reviews the finished conversation and writes through
// `skillctl`, so validation, provenance, the ledger and archive-only lifecycle
// stay in one place.
//
// It owns no model-facing tools. Its review child gets its tools from the
// `skill-review` preset declared beside it in cordis.patch.yml.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { registerDashboard } from './dashboard.js'

const PACKAGE_ROOT = path.dirname(fileURLToPath(import.meta.url))

export const name = 'skill-curator'
// Hard dependencies: no agents means no sessions to observe, no subagents
// means no review child, and the timer service owns every delayed step.
export const inject = ['agents', 'subagents', 'timer']

const REVIEW_MARKER = 'background skill REVIEWER'
const DAY_MS = 24 * 60 * 60 * 1000

const DEFAULTS = {
  enabled: true,
  skillsRoot: path.join(os.homedir(), '.dsh', 'skills'),
  skillctl: path.join(PACKAGE_ROOT, 'scripts', 'skillctl'),
  python: process.env.DSH_CURATOR_PYTHON || 'python3',
  stateDir: '',
  // Hermes: review after 10 accumulated model iterations, across turns
  // (`agent.skills.creation_nudge_interval`, default 10).
  nudgeAfterToolIters: 10,
  reviewEnabled: true,
  reviewPreset: 'skill-review',
  reviewProvider: 'spawn',
  // Optional explicit model route for the reviewer; empty means "copy the
  // parent session's live route".
  reviewAgentProvider: '',
  reviewAgentModel: '',
  reviewTimeoutMs: 15 * 60 * 1000,
  maxTranscriptChars: 40000,
  // Hermes: the deterministic curator runs when idle at most once per 7 days.
  curatorEnabled: true,
  curatorEveryDays: 7,
  staleDays: 14,
  archiveDays: 30,
  // One canary child on first activation proves the preset, the tools and the
  // path to skillctl before the first real review depends on them.
  selfTestOnFirstRun: true,
  maxSessions: 200,
  logMaxBytes: 2 * 1024 * 1024,
}

function isoNow() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function idOf(value) {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  const id = value.id ?? value.header?.id ?? value.session?.id ?? value.session?.header?.id
  return id === undefined || id === null ? '' : String(id)
}

function textOfBlocks(blocks) {
  if (!Array.isArray(blocks)) return ''
  return blocks
    .map((block) => (block && block.type === 'text' && typeof block.text === 'string' ? block.text : ''))
    .filter(Boolean)
    .join('\n')
}

// A subagent result promise should settle when its activation is aborted, but
// that is the subagent manager's contract, not ours. Race it with a hard
// deadline so one stuck child cannot leave `reviewing` true forever.
function withTimeout(promise, ms, message) {
  let timer
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

function errorText(error) {
  if (error instanceof Error) return error.stack || error.message
  try {
    return String(error)
  } catch {
    return 'unknown error'
  }
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJsonAtomic(file, value) {
  const tmp = `${file}.tmp`
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  fs.renameSync(tmp, file)
}

// Run one short-lived helper process (python3 skillctl / zstdcat via skillctl).
function runProcess(command, args, options = {}) {
  const {
    input = null,
    env = process.env,
    timeoutMs = 60000,
    signal = undefined,
  } = options
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    let child
    const finish = (code, error) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve({ code, stdout, stderr, error })
    }
    try {
      child = spawn(command, args, { env, stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (error) {
      finish(-1, errorText(error))
      return
    }
    const timer = timeoutMs > 0
      ? setTimeout(() => {
          try {
            child.kill('SIGKILL')
          } catch {
            /* already gone */
          }
          finish(-1, 'timeout')
        }, timeoutMs)
      : null
    const onAbort = () => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* already gone */
      }
      finish(-1, 'aborted')
    }
    if (signal) {
      if (signal.aborted) {
        onAbort()
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', (error) => finish(-1, errorText(error)))
    child.on('close', (code) => finish(code === null ? -1 : code))
    // A helper that exits before reading stdin closes the pipe; without this
    // listener the EPIPE becomes an uncaught stream error and kills the Host.
    child.stdin.on('error', () => {})
    try {
      if (input !== null) child.stdin.end(input)
      else child.stdin.end()
    } catch {
      finish(-1, 'stdin closed before write')
    }
  })
}

export function apply(ctx, config = {}) {
  const cfg = { ...DEFAULTS, ...config }
  if (!cfg.stateDir) cfg.stateDir = path.join(cfg.skillsRoot, '.dsh-curator')
  if (!cfg.enabled) return

  try {
    fs.mkdirSync(cfg.stateDir, { recursive: true })
  } catch {
    // A missing state directory is reported by every later write; keep the
    // process alive instead of failing the whole profile.
  }
  const statePath = path.join(cfg.stateDir, 'state.json')
  const logPath = path.join(cfg.stateDir, 'plugin.log')

  const state = readJson(statePath, { version: 1, sessions: {}, lastCuratorAt: 0, selfTested: 0 })
  if (!state.sessions || typeof state.sessions !== 'object') state.sessions = {}
  // Survive counter pruning and log rotation; the per-session map is evicted.
  state.reviewTotal = Number(state.reviewTotal) || 0
  state.reviewFailed = Number(state.reviewFailed) || 0
  state.lastReviewAt = Number(state.lastReviewAt) || 0

  // session id -> { iterations, lastTurnAt, lastReviewAt, reviews }. `iterations`
  // counts model steps (Hermes's `_iters_since_skill` unit), not individual tool calls.
  const counters = new Map()
  for (const [sessionId, record] of Object.entries(state.sessions)) {
    counters.set(sessionId, {
      iterations: Number(record?.iterations) || 0,
      lastTurnAt: Number(record?.lastTurnAt) || 0,
      lastReviewAt: Number(record?.lastReviewAt) || 0,
      reviews: Number(record?.reviews) || 0,
    })
  }
  // The previous build counted individual tool results. Hermes counts model
  // iterations, so old counters are in a different unit; zero them once and stamp
  // the unit so a reload cannot resurrect them.
  if (state.counterSemantics !== 'iterations') {
    for (const record of counters.values()) record.iterations = 0
    state.counterSemantics = 'iterations'
  }
  // skill name -> loads observed since the last flush
  const pendingSkillUses = new Map()
  const reviewQueue = []
  const reviewChildren = new Set()

  let reviewing = false
  let curatorRunning = false
  let selfTesting = false
  let disposed = false
  let activeController = null
  let activeActivation = null

  function log(record) {
    try {
      if (fs.existsSync(logPath) && fs.statSync(logPath).size > cfg.logMaxBytes) {
        try {
          fs.renameSync(logPath, `${logPath}.1`)
        } catch {
          /* keep writing to the current file */
        }
      }
      fs.appendFileSync(logPath, `${JSON.stringify({ ts: isoNow(), ...record })}\n`, 'utf8')
    } catch {
      /* logging must never disturb the session */
    }
  }

  function persistState() {
    const now = Date.now()
    for (const [sessionId, record] of counters) {
      // lastTurnAt === 0 means the session is mid-turn; it must not be aged out
      // by another session's turn/end.
      if (record.lastTurnAt > 0 && now - record.lastTurnAt > 30 * DAY_MS) counters.delete(sessionId)
    }
    while (counters.size > cfg.maxSessions) {
      const ageScore = (record) => (record.lastTurnAt > 0 ? record.lastTurnAt : Number.MAX_SAFE_INTEGER)
      const oldest = [...counters.entries()].sort((a, b) => ageScore(a[1]) - ageScore(b[1]))[0]
      if (!oldest) break
      counters.delete(oldest[0])
    }
    try {
      writeJsonAtomic(statePath, {
        version: 1,
        updatedAt: now,
        lastCuratorAt: Number(state.lastCuratorAt) || 0,
        selfTested: Number(state.selfTested) || 0,
        reviewTotal: Number(state.reviewTotal) || 0,
        reviewFailed: Number(state.reviewFailed) || 0,
        lastReviewAt: Number(state.lastReviewAt) || 0,
        counterSemantics: state.counterSemantics || 'iterations',
        sessions: Object.fromEntries(counters),
      })
    } catch (error) {
      log({ event: 'state.write-failed', error: errorText(error) })
    }
  }

  function flushSkillUsage() {
    if (pendingSkillUses.size === 0) return
    // The curator subprocess rewrites the same file; defer to the next turn.
    if (curatorRunning) return
    const usagePath = path.join(cfg.skillsRoot, '.dsh-usage.json')
    try {
      const data = readJson(usagePath, { version: 1, skills: {} })
      if (!data.skills || typeof data.skills !== 'object') data.skills = {}
      const at = isoNow()
      for (const [skill, count] of pendingSkillUses) {
        const record = data.skills[skill] ?? {}
        record.use_count = (Number(record.use_count) || 0) + count
        record.last_used_at = at
        if (record.state === 'stale') record.state = 'active'
        data.skills[skill] = record
      }
      writeJsonAtomic(usagePath, data)
    } catch (error) {
      log({ event: 'usage.write-failed', error: errorText(error) })
    } finally {
      pendingSkillUses.clear()
    }
  }

  function liveAgent(sessionId) {
    try {
      return ctx.agents.get(sessionId) ?? undefined
    } catch {
      return undefined
    }
  }

  function isRootSession(sessionId) {
    try {
      const roots = ctx.agents.roots?.() ?? []
      return roots.some((agent) => idOf(agent) === sessionId)
    } catch {
      return false
    }
  }

  function reviewEnv(controllerSignal) {
    return {
      ...process.env,
      PATH: process.env.PATH ?? '',
      DSH_SKILLS_ROOT: cfg.skillsRoot,
      ...(controllerSignal ? {} : {}),
    }
  }

  // The spawn backend may resolve a saved subagent model selection that differs
  // from the session's live route. The reviewer should use the same model as the
  // conversation it reviews, so copy the parent's last request header. Fall back
  // to the deployment default selection, then to an explicit config override.
  function parentRoute(agent) {
    try {
      const session = agent?.session
      if (!session || typeof session.eventAt !== 'function') return undefined
      const end = Number(session.seq) || 0
      for (let index = end - 1; index >= 0; index -= 1) {
        let event
        try {
          event = session.eventAt(index)
        } catch {
          continue
        }
        if (!event || event.type !== 'request/header') continue
        const config = event.data?.header?.config
        if (config?.provider && config?.model) {
          const route = { provider: config.provider, model: config.model }
          if (config.reasoningEffort) route.reasoningEffort = config.reasoningEffort
          return route
        }
      }
    } catch {
      /* fall through to the other sources */
    }
    return undefined
  }

  function defaultRoute() {
    try {
      const selection = ctx.get('agentDefaultModel')?.currentSelection?.()
      if (selection?.provider && selection?.model) {
        const route = { provider: selection.provider, model: selection.model }
        if (selection.reasoningEffort) route.reasoningEffort = selection.reasoningEffort
        return route
      }
    } catch {
      /* no default selection service */
    }
    return undefined
  }

  function resolveRoute(agent) {
    const fromParent = parentRoute(agent)
    if (fromParent) return { route: fromParent, source: 'parent' }
    const fromDefault = defaultRoute()
    if (fromDefault) return { route: fromDefault, source: 'default-selection' }
    if (cfg.reviewAgentProvider && cfg.reviewAgentModel) {
      return { route: { provider: cfg.reviewAgentProvider, model: cfg.reviewAgentModel }, source: 'config' }
    }
    return { route: undefined, source: 'provider-default' }
  }

  function reviewRequest(promptText, agent) {
    const request = {
      prompt: [{ type: 'text', text: promptText }],
      parent: agent,
      agentPreset: cfg.reviewPreset,
    }
    const resolved = resolveRoute(agent)
    if (resolved.route) request.agentOptions = resolved.route
    return { request, routeSource: resolved.source, route: resolved.route }
  }

  // Probe-time canary: prefer the most recently active live root, which is the
  // session the user is currently working in.
  function mostRecentRootAgent() {
    let best
    let bestTime = -1
    try {
      for (const agent of ctx.agents.roots?.() ?? []) {
        let time = 0
        try {
          const session = agent?.session
          const seq = Number(session?.seq) || 0
          if (seq > 0) time = Number(session.eventAt(seq - 1)?.time) || 0
        } catch {
          time = 0
        }
        if (time > bestTime) {
          bestTime = time
          best = agent
        }
      }
    } catch {
      return undefined
    }
    return best
  }

  // ── review pipeline ───────────────────────────────────────────────────────

  function maybeQueueReview(sessionId) {
    const record = counters.get(sessionId)
    if (!record) return
    if (record.iterations < cfg.nudgeAfterToolIters) return
    if (!reviewQueue.includes(sessionId)) reviewQueue.push(sessionId)
    drainQueue()
  }

  function drainQueue() {
    if (disposed || reviewing) return
    while (reviewQueue.length > 0) {
      const sessionId = reviewQueue.shift()
      const record = counters.get(sessionId)
      if (!record || record.iterations < cfg.nudgeAfterToolIters) continue
      const agent = liveAgent(sessionId)
      if (!agent) continue
      startReview(sessionId, agent)
      return
    }
  }

  function startReview(sessionId, agent) {
    reviewing = true
    const record = counters.get(sessionId) ?? { iterations: 0, lastTurnAt: 0, lastReviewAt: 0, reviews: 0 }
    const startedAt = Date.now()
    record.iterations = 0
    record.lastReviewAt = startedAt
    record.reviews = (record.reviews || 0) + 1
    counters.set(sessionId, record)
    state.reviewTotal = (Number(state.reviewTotal) || 0) + 1
    state.lastReviewAt = startedAt
    persistState()

    const controller = new AbortController()
    activeController = controller
    runReview(sessionId, agent, controller)
      .catch((error) => {
        state.reviewFailed = (Number(state.reviewFailed) || 0) + 1
        persistState()
        log({ event: 'review.failed', session: sessionId, error: errorText(error) })
      })
      .finally(() => {
        reviewing = false
        activeController = null
        activeActivation = null
        persistState()
        if (!disposed) {
          try {
            ctx.timeout(() => drainQueue(), 1000)
          } catch {
            /* timer already disposed */
          }
        }
      })
  }

  async function runReview(sessionId, agent, controller) {
    const prompt = await runProcess(
      cfg.python,
      [
        cfg.skillctl,
        'review',
        '--session',
        sessionId,
        '--max-chars',
        String(cfg.maxTranscriptChars),
      ],
      { env: reviewEnv(), timeoutMs: 60000, signal: controller.signal },
    )
    if (controller.signal.aborted) throw new Error('review aborted before activation')
    if (prompt.code !== 0) {
      throw new Error(`review prompt failed (exit ${prompt.code}): ${(prompt.stderr || prompt.error || '').slice(-800)}`)
    }
    const text = prompt.stdout.trim()
    if (!text) throw new Error('review prompt was empty')

    const planning = reviewRequest(text, agent)
    log({
      event: 'review.start',
      session: sessionId,
      promptChars: text.length,
      routeSource: planning.routeSource,
      route: planning.route,
    })
    const activation = await ctx.subagents.startActivation({
      provider: cfg.reviewProvider,
      label: 'skill review',
      request: planning.request,
      signal: controller.signal,
      delivery: 'caller',
    })
    activeActivation = activation
    reviewChildren.add(idOf(activation.childId))
    log({ event: 'review.activated', session: sessionId, child: idOf(activation.childId) })

    const timer = ctx.timeout(() => {
      try {
        controller.abort()
      } catch {
        /* already aborted */
      }
    }, cfg.reviewTimeoutMs)
    let result
    try {
      result = await withTimeout(activation.result, cfg.reviewTimeoutMs + 5000, 'review result did not settle')
    } finally {
      try {
        timer()
      } catch {
        /* timer already disposed */
      }
      try {
        await activation.dispose()
      } catch {
        /* already settled */
      }
      activeActivation = null
    }
    const output = textOfBlocks(result?.output)
    if (result?.stopReason && result.stopReason !== 'completed') {
      state.reviewFailed = (Number(state.reviewFailed) || 0) + 1
      persistState()
    }
    log({
      event: 'review.finished',
      session: sessionId,
      child: idOf(activation.childId),
      stopReason: result?.stopReason,
      diagnostic: result?.diagnostic,
      output: output.length > 4000 ? `${output.slice(0, 4000)}\n…[truncated]` : output,
    })
  }

  // ── self-test (once) ──────────────────────────────────────────────────────

  const SELF_TEST_PROMPT = [
    'You are a one-shot self-test for DSH background skill REVIEWER.',
    'Call the skill_list tool exactly once. Then reply with the first line of its result verbatim.',
    'Do not call any other tool. If no skill_list tool is available, reply exactly: NO_TOOLS',
  ].join(' ')

  async function runSelfTest(agent) {
    if (selfTesting) return
    selfTesting = true
    const controller = new AbortController()
    try {
      const planning = reviewRequest(SELF_TEST_PROMPT, agent)
      log({
        event: 'selftest.start',
        parent: idOf(agent),
        routeSource: planning.routeSource,
        route: planning.route,
      })
      const activation = await ctx.subagents.startActivation({
        provider: cfg.reviewProvider,
        label: 'skill curator self-test',
        request: planning.request,
        signal: controller.signal,
        delivery: 'caller',
      })
      const timer = ctx.timeout(() => {
        try {
          controller.abort()
        } catch {
          /* already aborted */
        }
      }, 180000)
      let result
      try {
        result = await withTimeout(activation.result, 185000, 'selftest result did not settle')
      } finally {
        try {
          timer()
        } catch {
          /* timer already disposed */
        }
        try {
          await activation.dispose()
        } catch {
          /* already settled */
        }
      }
      log({
        event: 'selftest.finished',
        child: idOf(activation.childId),
        stopReason: result?.stopReason,
        diagnostic: result?.diagnostic,
        output: textOfBlocks(result?.output).slice(0, 2000),
      })
    } finally {
      selfTesting = false
    }
  }

  // One canary latch shared by the activation probe and the first completed
  // turn. Each path used to own a separate flag, so both could spawn a child and
  // one path could record the canary as done while the other actually ran it.
  let selfTestPending = Boolean(cfg.selfTestOnFirstRun) && !state.selfTested
  function finishSelfTest() {
    selfTestPending = false
    state.selfTested = Date.now()
    persistState()
  }
  function startSelfTest(agent) {
    if (!selfTestPending || disposed || selfTesting) return false
    runSelfTest(agent)
      .catch((error) => log({ event: 'selftest.failed', error: errorText(error) }))
      .finally(finishSelfTest)
    return true
  }
  // Probe right after activation: a canary child proves the preset mounted and
  // the tools resolve before the first real review depends on them. Retries only
  // while no root session exists, because a preset declaration may mount after
  // this row.
  function selfTestProbe(attempt = 0) {
    if (!selfTestPending || disposed || selfTesting) return
    try {
      ctx.timeout(() => {
        if (!selfTestPending || disposed || selfTesting) return
        let root
        try {
          root = mostRecentRootAgent()
        } catch {
          root = undefined
        }
        if (!root) {
          if (attempt < 20) selfTestProbe(attempt + 1)
          return
        }
        startSelfTest(root)
      }, 5000)
    } catch {
      /* plugin disposed before the probe could run */
    }
  }
  selfTestProbe()

  // ── curator (deterministic lifecycle) ─────────────────────────────────────

  function maybeRunCurator() {
    if (!cfg.curatorEnabled || curatorRunning || disposed || reviewing) return
    const now = Date.now()
    if (now - (Number(state.lastCuratorAt) || 0) < cfg.curatorEveryDays * DAY_MS) return
    curatorRunning = true
    const controller = new AbortController()
    runProcess(
      cfg.python,
      [
        cfg.skillctl,
        'curator',
        '--apply',
        '--stale-days',
        String(cfg.staleDays),
        '--archive-days',
        String(cfg.archiveDays),
      ],
      { env: reviewEnv(), timeoutMs: 120000, signal: controller.signal },
    )
      .then((result) => {
        log({
          event: 'curator.finished',
          code: result.code,
          stdout: (result.stdout || '').slice(-3000),
          stderr: (result.stderr || '').slice(-1000),
        })
        if (result.code === 0) {
          state.lastCuratorAt = now
          persistState()
        }
      })
      .catch((error) => log({ event: 'curator.failed', error: errorText(error) }))
      .finally(() => {
        curatorRunning = false
      })
  }

  // ── observation ──────────────────────────────────────────────────────────

  // Hermes gives its review fork a whitelist: skills + read, no terminal, no
  // file writes. The `skill-review` preset enforces that on its own scope (see
  // preset.js), so this plugin only has to observe and trigger.

  // Counting lives in the session/event listener below; this listener only records
  // which skills were loaded (usage telemetry).
  ctx.on('tools/result', (exec, result) => {
    try {
      const agent = exec?.agent
      if (!agent) return
      const sessionId = idOf(agent)
      if (!sessionId || !isRootSession(sessionId)) return
      if (exec.name === 'skill' && !result?.isError) {
        const skillName = exec.arguments?.name
        if (typeof skillName === 'string' && skillName) {
          pendingSkillUses.set(skillName, (pendingSkillUses.get(skillName) || 0) + 1)
        }
      }
    } catch {
      /* observe-only */
    }
  })

  ctx.on('session/event', (session, event) => {
    try {
      if (!event) return
      const sessionId = idOf(session)
      if (!sessionId) return
      if (reviewChildren.has(sessionId)) return
      if (!isRootSession(sessionId)) return
      if (event.type === 'step/start') {
        // Hermes increments once per model iteration, so parallel tool calls in
        // one iteration count once. Every step counts, including the final
        // response step, matching turn_iteration_prep.py.
        const record = counters.get(sessionId) ?? { iterations: 0, lastTurnAt: 0, lastReviewAt: 0, reviews: 0 }
        record.iterations += 1
        counters.set(sessionId, record)
        return
      }
      if (event.type !== 'turn/end') return
      const agent = liveAgent(sessionId)
      if (!agent) return
      flushSkillUsage()
      const record = counters.get(sessionId) ?? { iterations: 0, lastTurnAt: 0, lastReviewAt: 0, reviews: 0 }
      record.lastTurnAt = Date.now()
      counters.set(sessionId, record)
      persistState()
      if (event.data?.reason?.kind !== 'completed') return

      if (!state.selfTested && cfg.selfTestOnFirstRun) startSelfTest(agent)
      if (cfg.reviewEnabled) maybeQueueReview(sessionId)
      maybeRunCurator()
    } catch (error) {
      log({ event: 'session.handler-failed', error: errorText(error) })
    }
  })

  // Abort in-flight work when the plugin goes away (disable, profile reload,
  // app quit). Cordis emits `dispose` on the owning context.
  let dashboard = null
  try {
    ctx.on('dispose', () => {
      disposed = true
      try {
        activeController?.abort()
      } catch {
        /* already aborted */
      }
      try {
        Promise.resolve(activeActivation?.dispose?.()).catch(() => {})
      } catch {
        /* already settled */
      }
      try {
        dashboard?.dispose?.()
      } catch {
        /* routes already removed */
      }
    })
  } catch {
    /* older Cordis without a dispose event */
  }

  // ── dashboard (read-only Web surface) ────────────────────────────────────

  // On App boot this plugin can apply before the webServer service mounts.
  // Probing once left the page 404 after a restart; wait for the service instead.
  function attachDashboard() {
    try {
      dashboard = registerDashboard(ctx, {
        cfg,
        state,
        snapshot: () => ({
          reviewing,
          curatorRunning,
          lastCuratorAt: Number(state.lastCuratorAt) || 0,
          selfTested: Number(state.selfTested) || 0,
          sessions: [...counters.entries()].map(([sessionId, record]) => ({
            id: sessionId,
            iterations: Number(record.iterations) || 0,
            lastTurnAt: Number(record.lastTurnAt) || 0,
            lastReviewAt: Number(record.lastReviewAt) || 0,
            reviews: Number(record.reviews) || 0,
            live: Boolean(liveAgent(sessionId)),
          })),
        }),
      })
      if (dashboard.registered) log({ event: 'dashboard.registered', routes: dashboard.routes })
      else log({ event: 'dashboard.skipped', reason: 'no webServer route carrier' })
    } catch (error) {
      log({ event: 'dashboard.failed', error: errorText(error) })
    }
    return () => {
      try {
        dashboard?.dispose?.()
      } catch {
        /* routes already removed */
      }
      dashboard = null
    }
  }

  try {
    ctx.inject(['webServer'], attachDashboard)
  } catch {
    attachDashboard()
  }

  log({
    event: 'plugin.started',
    skillsRoot: cfg.skillsRoot,
    threshold: cfg.nudgeAfterToolIters,
    preset: cfg.reviewPreset,
    sessions: counters.size,
  })
}
