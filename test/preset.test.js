import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { apply, inject } from '../preset.js'

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-skill-curator-preset-'))
}

function fakeSkillctl(root) {
  const script = path.join(root, 'fake-skillctl.mjs')
  fs.writeFileSync(
    script,
    [
      '#!/usr/bin/env node',
      "import fs from 'node:fs'",
      'const log = process.env.FAKE_SKILLCTL_LOG',
      "if (log) fs.appendFileSync(log, JSON.stringify(process.argv.slice(2)) + '\\n')",
      'const envLog = process.env.FAKE_SKILLCTL_ENV_LOG',
      "if (envLog) fs.appendFileSync(envLog, String(process.env.DSH_CURATOR_CONSOLIDATION || '') + '\\n')",
      "process.stdout.write('ok\\n')",
      'process.exit(0)',
      '',
    ].join('\n'),
  )
  return script
}

function fakeContext() {
  const tools = new Map()
  const denies = []
  const handlers = new Map()
  return {
    tools,
    denies,
    handlers,
    ctx: {
      tools: {
        register(definition) {
          tools.set(definition.name, definition)
          return () => tools.delete(definition.name)
        },
        schemas: () => [{ name: 'bash' }, { name: 'skill_list' }, { name: 'skill_read' }, { name: 'skill_manage' }],
        restrict(filter) {
          denies.push(filter.deny)
          return () => {}
        },
      },
      on(event, handler) {
        handlers.set(event, handler)
        return () => handlers.delete(event)
      },
    },
  }
}

function makeHarness(extraConfig = {}) {
  const root = tempRoot()
  const skillsRoot = path.join(root, 'skills')
  fs.mkdirSync(skillsRoot, { recursive: true })
  const log = path.join(root, 'argv.log')
  process.env.FAKE_SKILLCTL_LOG = log
  const fake = fakeContext()
  const config = { skillsRoot, python: process.execPath, skillctl: fakeSkillctl(root), timeoutMs: 10000, ...extraConfig }
  const realSetTimeout = globalThis.setTimeout
  globalThis.setTimeout = (fn, _ms) => realSetTimeout(fn, 0)
  try {
    apply(fake.ctx, config)
  } finally {
    globalThis.setTimeout = realSetTimeout
  }
  return { fake, config, log, skillsRoot, root }
}

function argvLines(log) {
  if (!fs.existsSync(log)) return []
  return fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
}

function exec() {
  return { signal: new AbortController().signal }
}

test('preset registers the three skill tools and restricts global tools', () => {
  const { fake } = makeHarness()
  assert.deepEqual([...fake.tools.keys()].sort(), ['skill_list', 'skill_manage', 'skill_read'])
  assert.deepEqual(fake.denies, [['bash']])
  assert.equal(typeof fake.handlers.get('tools/change'), 'function')
})

test('skill_manage create shells out to skillctl with validated arguments', async () => {
  const { fake, log } = makeHarness()
  const tool = fake.tools.get('skill_manage')
  const output = await tool.execute({
    action: 'create',
    name: 'demo-skill',
    description: 'A demo skill',
    content: '## When to Use\n\nUse it.\n\n## Verification\n\nCheck it.\n',
  }, exec())
  assert.match(output, /ok/)
  const [args] = argvLines(log)
  assert.deepEqual(args.slice(0, 3), ['manage', 'create', 'demo-skill'])
  assert.ok(args.includes('--description=A demo skill'))
  assert.ok(args.includes('--file=-'))
})

test('skill_manage rejects traversal names and unsafe support paths before spawning', async () => {
  const { fake, log } = makeHarness()
  const tool = fake.tools.get('skill_manage')

  await assert.rejects(
    tool.execute({ action: 'create', name: '../escape', description: 'x', content: 'body' }),
    /invalid skill name/,
  )
  await assert.rejects(
    tool.execute({ action: 'write_file', name: 'demo', path: '../escape.md', content: 'x' }),
    /path must be under/,
  )
  await assert.rejects(
    tool.execute({ action: 'write_file', name: 'demo', path: 'references/../escape.md', content: 'x' }),
    /path must be under/,
  )
  assert.deepEqual(argvLines(log), [])
})

test('skill_manage write_file and archive map to skillctl actions', async () => {
  const { fake, log } = makeHarness()
  const tool = fake.tools.get('skill_manage')

  await tool.execute({ action: 'write_file', name: 'demo', path: 'references/notes.md', content: 'notes' }, exec())
  await tool.execute({ action: 'archive', name: 'demo' }, exec())

  const lines = argvLines(log)
  assert.deepEqual(lines[0].slice(0, 3), ['manage', 'write_file', 'demo'])
  assert.ok(lines[0].includes('--path=references/notes.md'))
  assert.deepEqual(lines[1], ['manage', 'archive', 'demo', '--actor=agent'])
})

test('skill_list and skill_read work against the local library', async () => {
  const { fake, skillsRoot } = makeHarness()
  const dir = path.join(skillsRoot, 'demo')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: demo\ndescription: Demo\n---\n\nBody\n')

  const readTool = fake.tools.get('skill_read')
  const read = await readTool.execute({ name: 'demo' }, exec())
  assert.match(read, /skill: demo/)
  assert.match(read, /sha256: [0-9a-f]{64}/)
  assert.match(read, /Body/)

  const listTool = fake.tools.get('skill_list')
  assert.match(await listTool.execute({}, exec()), /ok/)

  await assert.rejects(readTool.execute({ name: '../escape' }), /invalid skill name/)
})


test('consolidationMode sets the skillctl environment flag', async () => {
  const harness = makeHarness({ consolidationMode: true })
  const envLog = path.join(harness.root, 'env.log')
  process.env.FAKE_SKILLCTL_ENV_LOG = envLog
  try {
    const tool = harness.fake.tools.get('skill_manage')
    await tool.execute(
      { action: 'create', name: 'demo-skill', description: 'A demo skill', content: '## When to Use\n\nx\n' },
      exec(),
    )
  } finally {
    delete process.env.FAKE_SKILLCTL_ENV_LOG
  }
  assert.equal(fs.readFileSync(envLog, 'utf8').trim(), '1')
})

test('skill_manage archive forwards absorbed_into', async () => {
  const { fake, log } = makeHarness()
  const tool = fake.tools.get('skill_manage')
  assert.ok(tool.parameters.properties.absorbed_into)
  await tool.execute({ action: 'archive', name: 'demo', absorbed_into: 'umbrella' }, exec())
  const [args] = argvLines(log)
  assert.ok(args.includes('--absorbed-into=umbrella'))
  assert.ok(args.includes('--actor=agent'))
})

test('skill_manage archive omits absorbed_into when not provided', async () => {
  const { fake, log } = makeHarness()
  await fake.tools.get('skill_manage').execute({ action: 'archive', name: 'demo' }, exec())
  const [args] = argvLines(log)
  assert.ok(!args.some((arg) => arg.startsWith('--absorbed-into=')))
})
