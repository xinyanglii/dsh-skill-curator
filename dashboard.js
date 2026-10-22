// Read-only HTTP surface for the Skill Curator dashboard.
//
// The Host plugin owns the state; this module turns that state plus the skill
// library on disk into one JSON document the Web UI page polls, and serves a
// single skill's SKILL.md on demand. Read-only by design: the dashboard shows
// what the curator did, it does not drive it.
//
// Routes (exact, GET only, loopback clients only):
//   /skill-curator/api/state        full dashboard snapshot
//   /skill-curator/api/skill?name=  one skill's SKILL.md, sha256 and support files
//
// The state route is polled every few seconds, so every file is parsed once per
// request and cached by (mtime, size) across requests; the plugin log and the
// append-only ledger are not re-read and re-parsed twice per poll.

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const SUPPORT_DIRS = ['references', 'scripts', 'templates', 'assets']
const SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/
const STATE_ROUTE = '/skill-curator/api/state'
const SKILL_ROUTE = '/skill-curator/api/skill'
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

function readJson(file, fallback) {
  const text = readText(file)
  if (text === null) return fallback
  try {
    return JSON.parse(text)
  } catch {
    return fallback
  }
}

function statOf(file) {
  try {
    return fs.statSync(file)
  } catch {
    return null
  }
}

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

// DSH's frontmatter is small and flat; the full parser lives in skillctl.
function parseFrontmatter(text) {
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text || '')
  if (!match) return {}
  const data = {}
  for (const raw of match[1].split(/\r?\n/)) {
    const line = /^([A-Za-z0-9_-]+):(.*)$/.exec(raw)
    if (!line) continue
    let value = line[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    data[line[1]] = value
  }
  return data
}

function listSupportFiles(skillDir) {
  const files = []
  const walk = (dir, prefix, depth) => {
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (depth >= 2) continue
        walk(path.join(dir, entry.name), relative, depth + 1)
      } else {
        files.push(relative)
      }
    }
  }
  for (const dirName of SUPPORT_DIRS) walk(path.join(skillDir, dirName), dirName, 1)
  return files.slice(0, 40)
}

function listSkillDirs(root) {
  let entries
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return []
  }
  const dirs = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const skillFile = path.join(root, entry.name, 'SKILL.md')
    const stat = statOf(skillFile)
    if (!stat || !stat.isFile()) continue
    dirs.push({ name: entry.name, dir: path.join(root, entry.name), skillFile, stat })
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name))
  return dirs
}

function isoOf(value) {
  if (!value) return null
  const ms = typeof value === 'number' ? value : Date.parse(value)
  if (!Number.isFinite(ms)) return null
  return { ms, iso: new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z') }
}

// Accepts milliseconds or an ISO string; NEVER an isoOf() result object.
function daysSince(value) {
  if (value === null || value === undefined) return null
  const ms = typeof value === 'number' ? value : Date.parse(value)
  if (!Number.isFinite(ms)) return null
  return Math.max(0, (Date.now() - ms) / 86400000)
}

function sendJson(res, status, body) {
  try {
    const payload = JSON.stringify(body)
    res.statusCode = status
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.setHeader('cache-control', 'no-store')
    res.end(payload)
  } catch {
    try {
      res.statusCode = 500
      res.end('{"error":"response failed"}')
    } catch {
      /* socket already gone */
    }
  }
}

function isLoopbackRequest(req) {
  const address = req.socket && req.socket.remoteAddress
  return typeof address === 'string' && LOOPBACK.has(address)
}

function trimEvent(record, id) {
  if (!record || typeof record !== 'object') return null
  const event = String(record.event || '')
  const out = { id, ts: record.ts || null, event }
  for (const key of ['session', 'child', 'preset', 'routeSource', 'promptChars', 'code', 'stopReason', 'denied', 'threshold', 'sessions']) {
    if (record[key] !== undefined) out[key] = record[key]
  }
  if (record.route && typeof record.route === 'object') {
    out.route = `${record.route.provider || '?'} / ${record.route.model || '?'}`
  }
  if (typeof record.output === 'string' && record.output) out.output = record.output.slice(-1200)
  if (typeof record.error === 'string' && record.error) out.error = record.error.slice(-1200)
  if (typeof record.stdout === 'string' && record.stdout) out.stdout = record.stdout.slice(-800)
  if (typeof record.stderr === 'string' && record.stderr) out.stderr = record.stderr.slice(-800)
  return out
}

// Parse a JSON-lines file, cached by the file's (mtimeMs, size). A partially
// written last line is skipped. Each retained row carries its line index so the
// dashboard can key a row stably while new rows are appended.
function readJsonLines(file, cache) {
  const stat = statOf(file)
  if (!stat) return []
  const signature = `${stat.mtimeMs}:${stat.size}`
  const cached = cache.get(file)
  if (cached && cached.signature === signature) return cached.rows
  const rows = []
  const text = readText(file)
  if (text !== null) {
    let lineNumber = 0
    for (const line of text.split(/\r?\n/)) {
      lineNumber += 1
      if (!line.trim()) continue
      try {
        const value = JSON.parse(line)
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          value.__line = lineNumber
          rows.push(value)
        }
      } catch {
        /* partially written last line or a corrupt row */
      }
    }
  }
  cache.set(file, { signature, rows })
  return rows
}

function readEvents(rows, limit) {
  return rows
    .slice(-limit)
    .reverse()
    .map((record) => trimEvent(record, `log-${record.__line}`))
    .filter(Boolean)
}

function readLedger(rows, limit) {
  return rows
    .slice(-limit)
    .reverse()
    .map((entry, index) => ({
      id: String(entry.id || `line-${entry.__line || index}`),
      ts: typeof entry.ts === 'string' ? entry.ts : null,
      op: typeof entry.op === 'string' ? entry.op : '?',
      name: typeof entry.name === 'string' ? entry.name : '?',
      actor: typeof entry.actor === 'string' ? entry.actor : '?',
    }))
}

function localDay(ms) {
  const date = new Date(ms)
  if (!Number.isFinite(date.getTime())) return null
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

// Reviews and agent writes per local day for the last `days` days. Takes the
// already-parsed rows; it never re-reads a file.
function readActivity(logRows, ledgerRows, days) {
  const counts = new Map()
  const today = new Date()
  const buckets = []
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset)
    const key = localDay(date.getTime())
    buckets.push({ date: key, reviews: 0, changes: 0 })
    counts.set(key, buckets[buckets.length - 1])
  }
  for (const record of logRows) {
    if (record.event !== 'review.start') continue
    const key = localDay(Date.parse(record.ts))
    const bucket = key ? counts.get(key) : undefined
    if (bucket) bucket.reviews += 1
  }
  for (const entry of ledgerRows) {
    const key = localDay(Date.parse(entry.ts))
    const bucket = key ? counts.get(key) : undefined
    if (bucket) bucket.changes += 1
  }
  return buckets
}

// Join each review (start -> finished/failed) with the skill writes that landed
// inside its window, so the UI can say what the review actually changed instead
// of showing an opaque event feed plus a separate ledger.
function buildLearning(logRows, ledgerRows) {
  const learning = []
  let current = null
  for (const row of logRows) {
    if (row.event === 'review.start') {
      current = row
      continue
    }
    if (row.event !== 'review.finished' && row.event !== 'review.failed') continue
    const endTs = Date.parse(row.ts || '')
    const startTs = current ? Date.parse(current.ts || '') : Number.NaN
    const changed = new Map()
    if (Number.isFinite(endTs)) {
      const from = Number.isFinite(startTs) ? startTs - 1000 : endTs - 15 * 60000
      for (const entry of ledgerRows) {
        const entryTs = Date.parse(entry.ts || '')
        if (!Number.isFinite(entryTs) || entryTs < from || entryTs > endTs + 5000) continue
        if (typeof entry.name === 'string' && entry.name) changed.set(entry.name, true)
      }
    }
    learning.push({
      ts: row.ts || null,
      status: row.event === 'review.failed' ? 'failed' : String(row.stopReason || 'unknown'),
      session: row.session || (current && current.session) || null,
      child: row.child || null,
      startTs: current ? current.ts || null : null,
      durationMs: Number.isFinite(endTs) && Number.isFinite(startTs) ? Math.max(0, endTs - startTs) : null,
      changes: [...changed.keys()],
      // The reviewer opens with its conclusion ("Patched X in place ..."); keep
      // the HEAD. Keeping the tail starts the text mid-sentence and reads as noise.
      summary: row.event === 'review.failed'
        ? (String(row.error || '').slice(0, 1200) || null)
        : typeof row.output === 'string'
          ? (row.output.length > 1600 ? `${row.output.slice(0, 1600)}\n…` : row.output) || null
          : null,
    })
    current = null
  }
  return learning.slice(-8).reverse()
}

function buildStats(skills, sessions, ledgerRows, events, state) {
  const byState = { active: 0, stale: 0, archived: 0 }
  let uses = 0
  for (const skill of skills) {
    uses += Number(skill.uses) || 0
    if (skill.state === 'stale') byState.stale += 1
    else if (skill.state === 'archived') byState.archived += 1
    else byState.active += 1
  }
  // Durable counters survive session-map pruning; the per-session sum is only a
  // fallback for state written before these fields existed.
  let reviews = Number(state.reviewTotal) || 0
  let lastReviewAt = Number(state.lastReviewAt) || 0
  if (reviews === 0) {
    for (const session of sessions) {
      reviews += Number(session.reviews) || 0
      lastReviewAt = Math.max(lastReviewAt, Number(session.lastReviewAt) || 0)
    }
  }
  let lastReviewStop = ''
  for (const event of events) {
    if (event.event === 'review.finished' && event.stopReason) {
      lastReviewStop = String(event.stopReason)
      break
    }
  }
  const lastChange = ledgerRows.length > 0 ? ledgerRows[ledgerRows.length - 1] : null
  return {
    skills: skills.length,
    active: byState.active,
    stale: byState.stale,
    archived: byState.archived,
    uses,
    reviews,
    reviewFailed: Number(state.reviewFailed) || 0,
    lastReviewAt,
    lastReviewStop,
    ledgerTotal: ledgerRows.length,
    lastChangeAt: lastChange ? isoOf(lastChange.ts)?.ms || 0 : 0,
    lastChangeName: lastChange && typeof lastChange.name === 'string' ? lastChange.name : '',
  }
}

export function registerDashboard(ctx, options) {
  const { cfg, state, snapshot } = options
  const skillsRoot = cfg.skillsRoot
  const stateDir = cfg.stateDir
  const usagePath = path.join(skillsRoot, '.dsh-usage.json')
  const ledgerPath = path.join(skillsRoot, '.curator_ledger.jsonl')
  const logPath = path.join(stateDir, 'plugin.log')
  const statePath = path.join(stateDir, 'state.json')

  // (mtime, size) caches: the page polls, these files are append-only.
  const lineCache = new Map()
  const skillFileCache = new Map()

  function skillFileInfo(skillFile, stat) {
    const signature = `${stat.mtimeMs}:${stat.size}`
    const cached = skillFileCache.get(skillFile)
    if (cached && cached.signature === signature) return cached.info
    const text = readText(skillFile) || ''
    const info = {
      description: String(parseFrontmatter(text).description || '').slice(0, 240),
      bytes: Buffer.byteLength(text, 'utf8'),
      supportFiles: listSupportFiles(path.dirname(skillFile)).length,
    }
    skillFileCache.set(skillFile, { signature, info })
    return info
  }

  function buildSkillRows() {
    const usage = readJson(usagePath, { version: 1, skills: {} })
    const records = usage && typeof usage.skills === 'object' ? usage.skills : {}
    return listSkillDirs(skillsRoot).map(({ name, skillFile, stat }) => {
      const info = skillFileInfo(skillFile, stat)
      const record = records[name] || {}
      const lastUsed = isoOf(record.last_used_at)
      const created = isoOf(record.created_at)
      return {
        name,
        description: info.description,
        state: record.state || 'active',
        origin: record.created_by || 'manual',
        uses: Number(record.use_count) || 0,
        patches: Number(record.patch_count) || 0,
        pinned: Boolean(record.pinned),
        lastUsed: lastUsed ? lastUsed.iso : null,
        created: created ? created.iso : null,
        // daysSince takes ms, never the isoOf() wrapper object.
        ageDays: daysSince(lastUsed ? lastUsed.ms : created ? created.ms : stat.mtimeMs),
        path: skillFile,
        bytes: info.bytes,
        supportFiles: info.supportFiles,
      }
    })
  }

  function archivedCount() {
    try {
      return fs.readdirSync(path.join(skillsRoot, '.archive'), { withFileTypes: true })
        .filter((entry) => entry.isDirectory()).length
    } catch {
      return 0
    }
  }

  function buildStatePayload() {
    const live = snapshot ? snapshot() : {}
    const skills = buildSkillRows()
    const sessions = Array.isArray(live.sessions) ? live.sessions : []
    const logRows = readJsonLines(logPath, lineCache)
    const ledgerRows = readJsonLines(ledgerPath, lineCache)
    const events = readEvents(logRows, 60)
    return {
      generatedAt: Date.now(),
      config: {
        enabled: cfg.enabled !== false,
        threshold: cfg.nudgeAfterToolIters,
        reviewEnabled: cfg.reviewEnabled !== false,
        reviewPreset: cfg.reviewPreset,
        reviewProvider: cfg.reviewProvider,
        curatorEnabled: cfg.curatorEnabled !== false,
        curatorEveryDays: cfg.curatorEveryDays,
        staleDays: cfg.staleDays,
        archiveDays: cfg.archiveDays,
        skillsRoot,
        statePath,
        logPath,
        skillctl: cfg.skillctl,
      },
      runtime: {
        reviewing: Boolean(live.reviewing),
        curatorRunning: Boolean(live.curatorRunning),
        lastCuratorAt: Number(live.lastCuratorAt) || 0,
        selfTested: Number(live.selfTested) || 0,
        sessions,
      },
      stats: buildStats(skills, sessions, ledgerRows, events, state),
      activity: readActivity(logRows, ledgerRows, 14),
      learning: buildLearning(logRows, ledgerRows),
      skills,
      archivedCount: archivedCount(),
      ledger: readLedger(ledgerRows, 20),
      events,
    }
  }

  function buildSkillPayload(name) {
    if (!SKILL_NAME.test(name)) return { status: 400, body: { error: 'invalid skill name' } }
    const dir = path.join(skillsRoot, name)
    const file = path.join(dir, 'SKILL.md')
    const text = readText(file)
    if (text === null) return { status: 404, body: { error: `no skill "${name}"` } }
    const frontmatter = parseFrontmatter(text)
    return {
      status: 200,
      body: {
        name,
        description: frontmatter.description || '',
        sha256: sha256(text),
        path: file,
        supportFiles: listSupportFiles(dir),
        content: text,
      },
    }
  }

  const routes = []
  const web = (() => {
    try {
      return ctx.get ? ctx.get('webServer') : undefined
    } catch {
      return undefined
    }
  })()
  if (!web || typeof web.register !== 'function') {
    return { registered: false, routes: [], dispose() {} }
  }

  const handlers = [
    [STATE_ROUTE, (req, res) => {
      if (!isLoopbackRequest(req)) return sendJson(res, 403, { error: 'loopback only' })
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'GET only' })
      try {
        sendJson(res, 200, buildStatePayload())
      } catch (error) {
        sendJson(res, 500, { error: String(error && error.message ? error.message : error) })
      }
    }],
    [SKILL_ROUTE, (req, res) => {
      if (!isLoopbackRequest(req)) return sendJson(res, 403, { error: 'loopback only' })
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'GET only' })
      try {
        const url = new URL(req.url || '/', 'http://localhost')
        const result = buildSkillPayload(String(url.searchParams.get('name') || ''))
        sendJson(res, result.status, result.body)
      } catch (error) {
        sendJson(res, 500, { error: String(error && error.message ? error.message : error) })
      }
    }],
  ]

  for (const [routePath, handler] of handlers) {
    try {
      routes.push(web.register({ kind: 'exact', path: routePath, handler }))
    } catch {
      /* a duplicate route belongs to another composition; leave it alone */
    }
  }

  function dispose() {
    while (routes.length > 0) {
      const remove = routes.pop()
      try {
        remove()
      } catch {
        /* already removed */
      }
    }
  }
  if (typeof ctx.effect === 'function') {
    try {
      ctx.effect(() => () => dispose())
    } catch {
      /* effect registration unavailable; the plugin dispose hook calls this too */
    }
  }

  return { registered: routes.length > 0, routes: handlers.map(([routePath]) => routePath), dispose }
}
