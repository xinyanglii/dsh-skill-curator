// Review-side skill tools for the `skill-review` agent preset.
//
// The preset mounts this plugin beside a persona and nothing else, so the
// review child has exactly the surface Hermes gives its review fork: read the
// library, read one skill, and write through `skillctl` (which validates the
// frontmatter, enforces read-before-write, records provenance + ledger, and
// archives instead of deleting). No shell, no direct file writes.

import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_ROOT = path.dirname(fileURLToPath(import.meta.url))

export const name = 'skill-review-tools'
export const inject = ['tools']

const SUPPORT_DIRS = ['references', 'scripts', 'templates', 'assets']
const SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/

const DEFAULTS = {
  skillsRoot: path.join(os.homedir(), '.dsh', 'skills'),
  skillctl: path.join(PACKAGE_ROOT, 'scripts', 'skillctl'),
  python: process.env.DSH_CURATOR_PYTHON || 'python3',
  timeoutMs: 60000,
  maxContentChars: 40000,
}

function textBlock(text) {
  return [{ type: 'text', text }]
}

function stringOutput() {
  return {
    schema: { type: 'string' },
    render: (_args, value) => textBlock(typeof value === 'string' ? value : JSON.stringify(value)),
  }
}

function errorText(error) {
  if (error instanceof Error) return error.stack || error.message
  try {
    return String(error)
  } catch {
    return 'unknown error'
  }
}

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

// Parse the flat frontmatter keys this toolkit cares about. `skillctl validate`
// remains the authority on whether a skill is well formed.
function readFrontmatter(text) {
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text)
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
  for (const dirName of SUPPORT_DIRS) {
    const dirPath = path.join(skillDir, dirName)
    let entries
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const relative = path.posix.join(dirName, entry.name)
      files.push(entry.isDirectory() ? `${relative}/` : relative)
    }
  }
  return files
}

function runCli(cfg, args, input, signal) {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    let timer = null
    let child
    const finish = (code, error) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve({ code, stdout, stderr, error })
    }
    try {
      child = spawn(cfg.python, [cfg.skillctl, ...args], {
        cwd: os.homedir(),
        env: {
          ...process.env,
          PATH: process.env.PATH ?? '',
          DSH_SKILLS_ROOT: cfg.skillsRoot,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (error) {
      finish(-1, errorText(error))
      return
    }
    timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* already gone */
      }
      finish(-1, 'timeout')
    }, cfg.timeoutMs)
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
    // A child that exits before reading stdin (bad arguments, missing python,
    // a validation error) closes the pipe. Without this listener the resulting
    // EPIPE is an uncaught stream 'error' event and kills the whole Host.
    child.stdin.on('error', () => {})
    try {
      if (typeof input === 'string') child.stdin.end(input)
      else child.stdin.end()
    } catch {
      finish(-1, 'stdin closed before write')
    }
  })
}

export function apply(ctx, config = {}) {
  const cfg = { ...DEFAULTS, ...config }

  function requireString(args, key) {
    const value = args?.[key]
    if (typeof value !== 'string' || value.trim() === '') throw new Error(`${key} is required`)
    return value
  }

  function assertSkillName(skillName) {
    if (!SKILL_NAME.test(skillName)) {
      throw new Error(`invalid skill name "${skillName}" (lowercase letters, digits and hyphens)`)
    }
    return skillName
  }

  function skillPath(skillName) {
    assertSkillName(skillName)
    return path.join(cfg.skillsRoot, skillName)
  }

  function isSafeSupportPath(relative) {
    if (relative.startsWith('/') || relative.includes('\\') || relative.includes('\u0000')) return false
    const parts = relative.split('/')
    return SUPPORT_DIRS.includes(parts[0]) && parts.every((part) => part !== '' && part !== '.' && part !== '..')
  }

  const skillList = {
    name: 'skill_list',
    description:
      'List the local DSH skill library: each skill name, one-line description, origin, lifecycle state, use count and last-used date. Call this first so you update or extend an existing skill instead of creating a sibling.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: stringOutput(),
    async execute(_args, exec) {
      const result = await runCli(cfg, ['list'], null, exec.signal)
      if (result.code !== 0) {
        throw new Error(`skillctl list failed: ${(result.stderr || result.error || '').trim() || `exit ${result.code}`}`)
      }
      return result.stdout.trim() || '(no skills)'
    },
  }

  const skillRead = {
    name: 'skill_read',
    description:
      'Read one skill before changing it: returns its SKILL.md (frontmatter and body), the sha256 to pass back as expect_sha on a patch, and the support files it already has. Patches require a fresh sha256 from this tool.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Exact skill name from skill_list.' },
      },
      required: ['name'],
      additionalProperties: false,
    },
    output: stringOutput(),
    async execute(args, exec) {
      exec?.signal?.throwIfAborted?.()
      const skillName = requireString(args, 'name')
      const dir = skillPath(skillName)
      const file = path.join(dir, 'SKILL.md')
      let content
      try {
        content = fs.readFileSync(file, 'utf8')
      } catch (error) {
        throw new Error(`no skill "${skillName}": ${errorText(error)}`)
      }
      const frontmatter = readFrontmatter(content)
      const support = listSupportFiles(dir)
      return [
        `skill: ${skillName}`,
        `sha256: ${sha256(content)}`,
        `description: ${frontmatter.description ?? ''}`,
        `support_files: ${support.length === 0 ? '(none)' : support.join(', ')}`,
        '',
        content,
      ].join('\n')
    },
  }

  const skillManage = {
    name: 'skill_manage',
    description:
      'Write the skill library through skillctl, the validated authoring CLI. Actions: create (name, description, content = body only, no frontmatter), patch (name, old, new, expect_sha from skill_read), write_file (name, path under references/scripts/templates/assets, content), archive (name; never deletes). Every action is validated, ledgered, and attributed; a rejected write leaves the library unchanged.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'One of: create, patch, write_file, archive.',
        },
        name: { type: 'string', description: 'Exact skill name.' },
        description: {
          type: 'string',
          description: 'create only: one-sentence description, under 120 characters. Quote-free; the tool adds YAML quoting.',
        },
        content: {
          type: 'string',
          description: 'create + write_file: the markdown body (create) or file contents (write_file). Bodies must include the ## When to Use and ## Verification sections.',
        },
        old: { type: 'string', description: 'patch only: exact text to replace; must match exactly once.' },
        new: { type: 'string', description: 'patch only: replacement text for old.' },
        expect_sha: {
          type: 'string',
          description: 'patch only: sha256 from skill_read; the write fails if the file changed since.',
        },
        path: {
          type: 'string',
          description: 'write_file only: relative path under references/, scripts/, templates/ or assets/.',
        },
      },
      required: ['action', 'name'],
      additionalProperties: false,
    },
    output: stringOutput(),
    async execute(args, exec) {
      exec?.signal?.throwIfAborted?.()
      const action = requireString(args, 'action')
      const skillName = assertSkillName(requireString(args, 'name'))
      let result
      if (action === 'create') {
        const description = requireString(args, 'description')
        if (description.includes('\n')) throw new Error('description must be a single line')
        const content = requireString(args, 'content')
        if (content.trimStart().startsWith('---')) {
          throw new Error('content must be the markdown body only; the tool generates the frontmatter')
        }
        result = await runCli(
          cfg,
          [
            'manage',
            'create',
            skillName,
            `--description=${description}`,
            '--created-by=agent',
            '--actor=agent',
            '--file=-',
          ],
          `${content.trimEnd()}\n`,
          exec.signal,
        )
      } else if (action === 'patch') {
        const oldText = requireString(args, 'old')
        const newText = typeof args?.new === 'string' ? args.new : ''
        const expectSha = requireString(args, 'expect_sha')
        result = await runCli(
          cfg,
          [
            'manage',
            'patch',
            skillName,
            `--old=${oldText}`,
            `--new=${newText}`,
            `--expect-sha=${expectSha}`,
            '--actor=agent',
          ],
          null,
          exec.signal,
        )
      } else if (action === 'write_file') {
        const relative = requireString(args, 'path')
        const content = requireString(args, 'content')
        if (!isSafeSupportPath(relative)) {
          throw new Error('path must be under references/, scripts/, templates/ or assets/ without ".."')
        }
        result = await runCli(
          cfg,
          [
            'manage',
            'write_file',
            skillName,
            `--path=${relative}`,
            '--file=-',
            '--actor=agent',
          ],
          content,
          exec.signal,
        )
      } else if (action === 'archive') {
        result = await runCli(cfg, ['manage', 'archive', skillName, '--actor=agent'], null, exec.signal)
      } else {
        throw new Error(`unknown action "${action}"; use create, patch, write_file or archive`)
      }
      const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
      if (result.code !== 0) {
        throw new Error(output || result.error || `skillctl exited with ${result.code}`)
      }
      return output || 'ok'
    },
  }

  ctx.tools.register(skillList)
  ctx.tools.register(skillRead)
  ctx.tools.register(skillManage)

  // Hermes gives the review fork a whitelist: skills + read, no terminal, no
  // file writes. This plugin's context IS the preset scope, so restricting the
  // global tools here covers every agent mounted under `skill-review` while the
  // scoped registrations above stay visible. The deny set only grows: a tool
  // registered later (an MCP server reconnecting, a deployment tool) is added on
  // the next `tools/change`, and a failing re-register keeps the previous mask.
  const ALLOWED_GLOBALS = new Set(['skill_list', 'skill_read', 'skill_manage'])
  const deniedGlobals = new Set()

  // One restriction per newly seen global tool. Restrictions intersect, so a
  // stale or scope-local name can fail alone without taking the whole mask
  // down. Replacing one full deny list would be all-or-nothing: a single
  // unknown name throws AFTER the old mask was disposed, leaving the review
  // scope unrestricted for every later child.
  function refreshToolRestriction() {
    for (const schema of ctx.tools.schemas()) {
      const toolName = schema?.name
      if (typeof toolName !== 'string' || !toolName) continue
      if (ALLOWED_GLOBALS.has(toolName) || deniedGlobals.has(toolName)) continue
      try {
        ctx.tools.restrict({ deny: [toolName] })
        deniedGlobals.add(toolName)
      } catch {
        /* transiently unknown or scope-local; retried on the next tools/change */
      }
    }
  }

  refreshToolRestriction()
  try {
    ctx.on('tools/change', () => refreshToolRestriction())
  } catch {
    /* older registry without the change event */
  }
  // Global tools may finish registering after this preset mounts at startup.
  setTimeout(() => refreshToolRestriction(), 3000)
}
