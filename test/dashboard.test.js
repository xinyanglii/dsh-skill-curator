import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { registerDashboard } from '../dashboard.js'

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-skill-curator-'))
}

function writeSkill(root, name, description, body = 'Instructions.') {
  const dir = path.join(root, name)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n${body}\n`)
  return dir
}

function fakeWebServer() {
  const handlers = new Map()
  return {
    handlers,
    register(route) {
      handlers.set(route.path, route.handler)
      return () => handlers.delete(route.path)
    },
  }
}

function fakeContext(web, configEditor) {
  return {
    get: (key) => (key === 'webServer' ? web : key === 'configEditor' ? configEditor : undefined),
    effect: (fn) => {
      const dispose = fn()
      return typeof dispose === 'function' ? dispose : () => {}
    },
  }
}

function fakeRequest(method, url, remoteAddress = '127.0.0.1') {
  return { method, url, headers: { host: '127.0.0.1:1' }, socket: { remoteAddress } }
}

function fakeConfigEditor(config) {
  const entry = {
    options: { id: 'skill-curator', name: 'dsh-skill-curator', config: { ...config } },
    fiber: { state: 2 },
  }
  const calls = []
  return {
    entry,
    calls,
    entries: () => [entry],
    async edit(target, change) {
      const next = change(target.options.config || {})
      calls.push(next)
      target.options.config = next
    },
  }
}

function fakePostRequest(body, remoteAddress = '127.0.0.1', contentType = 'application/json') {
  const listeners = new Map()
  const request = {
    method: 'POST',
    url: '/skill-curator/api/config',
    headers: { 'content-type': contentType },
    socket: { remoteAddress },
    on(event, callback) {
      if (!listeners.has(event)) listeners.set(event, [])
      listeners.get(event).push(callback)
      return request
    },
  }
  setTimeout(() => {
    for (const callback of listeners.get('data') || []) callback(Buffer.from(body))
    for (const callback of listeners.get('end') || []) callback()
  }, 0)
  return request
}

async function invokeAsync(web, routePath, request) {
  const handler = web.handlers.get(routePath)
  assert.ok(handler, `route ${routePath} registered`)
  const res = fakeResponse()
  await handler(request, res)
  return res
}

function fakeResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(key, value) {
      this.headers[key] = value
    },
    end(chunk = '') {
      this.body += String(chunk)
    },
  }
}

function invoke(web, routePath, request) {
  const handler = web.handlers.get(routePath)
  assert.ok(handler, `route ${routePath} registered`)
  const res = fakeResponse()
  handler(request, res)
  return res
}

function makeDashboard() {
  const skillsRoot = tempRoot()
  const stateDir = tempRoot()
  writeSkill(skillsRoot, 'demo', 'A demo skill')
  const web = fakeWebServer()
  const state = { reviewTotal: 2, reviewFailed: 1, lastReviewAt: 1700000000000 }
  const configEditor = fakeConfigEditor({
    enabled: true,
    reviewEnabled: true,
    curatorEnabled: true,
    consolidateEnabled: false,
    nudgeAfterToolIters: 10,
    reviewPreset: 'skill-review',
    reviewProvider: 'spawn',
    staleDays: 14,
    archiveDays: 30,
  })
  const dashboard = registerDashboard(fakeContext(web, configEditor), {
    cfg: {
      skillsRoot,
      stateDir,
      enabled: true,
      nudgeAfterToolIters: 10,
      reviewEnabled: true,
      reviewPreset: 'skill-review',
      reviewProvider: 'spawn',
      curatorEnabled: true,
      curatorEveryDays: 7,
      staleDays: 14,
      archiveDays: 30,
      reviewTimeoutMs: 900000,
      maxTranscriptChars: 40000,
      consolidateEnabled: false,
      consolidatePreset: 'skill-consolidate',
      consolidateTimeoutMs: 1800000,
      consolidateBackupKeep: 2,
      skillctl: '/tmp/skillctl',
    },
    state,
    snapshot: () => ({ reviewing: false, curatorRunning: false, lastCuratorAt: 0, selfTested: 0, sessions: [] }),
  })
  return { dashboard, web, skillsRoot, stateDir, configEditor }
}

test('registers both GET routes and reports them', () => {
  const { dashboard, web } = makeDashboard()
  assert.equal(dashboard.registered, true)
  assert.deepEqual(dashboard.routes.sort(), ['/skill-curator/api/config', '/skill-curator/api/skill', '/skill-curator/api/state'])
  assert.ok(web.handlers.has('/skill-curator/api/state'))
  assert.ok(web.handlers.has('/skill-curator/api/skill'))
})

test('state route returns the snapshot shape', () => {
  const { web } = makeDashboard()
  const res = invoke(web, '/skill-curator/api/state', fakeRequest('GET', '/skill-curator/api/state'))
  assert.equal(res.statusCode, 200)
  assert.match(res.headers['content-type'], /application\/json/)
  const body = JSON.parse(res.body)
  assert.equal(body.stats.skills, 1)
  assert.equal(body.stats.reviews, 2)
  assert.equal(body.stats.reviewFailed, 1)
  assert.equal(body.config.consolidateEnabled, false)
  assert.equal(body.config.consolidatePreset, 'skill-consolidate')
  assert.equal(body.config.consolidateBackupKeep, 2)
  assert.equal(body.runtime.lastConsolidateAt, 0)
  assert.equal(body.runtime.lastConsolidateSummary, '')
  assert.equal(body.skills[0].name, 'demo')
  assert.equal(body.skills[0].description, 'A demo skill')
  assert.ok(Array.isArray(body.learning))
  assert.ok(Array.isArray(body.activity))
  assert.ok(body.generatedAt > 0)
})

test('skill route serves SKILL.md and validates the name', () => {
  const { web } = makeDashboard()
  const ok = invoke(web, '/skill-curator/api/skill', fakeRequest('GET', '/skill-curator/api/skill?name=demo'))
  assert.equal(ok.statusCode, 200)
  const body = JSON.parse(ok.body)
  assert.equal(body.name, 'demo')
  assert.match(body.content, /Instructions\./)

  const traversal = invoke(web, '/skill-curator/api/skill', fakeRequest('GET', '/skill-curator/api/skill?name=../demo'))
  assert.equal(traversal.statusCode, 400)

  const missing = invoke(web, '/skill-curator/api/skill', fakeRequest('GET', '/skill-curator/api/skill?name=missing'))
  assert.equal(missing.statusCode, 404)
})

test('routes reject non-GET and non-loopback callers', () => {
  const { web } = makeDashboard()
  const post = invoke(web, '/skill-curator/api/state', fakeRequest('POST', '/skill-curator/api/state'))
  assert.equal(post.statusCode, 405)

  const remote = invoke(web, '/skill-curator/api/state', fakeRequest('GET', '/skill-curator/api/state', '192.168.1.20'))
  assert.equal(remote.statusCode, 403)
})

test('dispose removes the registered routes', () => {
  const { dashboard, web } = makeDashboard()
  dashboard.dispose()
  assert.equal(web.handlers.size, 0)
})


test('config route persists a validated patch through the config editor', async () => {
  const { web, configEditor } = makeDashboard()
  const body = JSON.stringify({ consolidateEnabled: true, nudgeAfterToolIters: 12 })
  const res = await invokeAsync(web, '/skill-curator/api/config', fakePostRequest(body))
  assert.equal(res.statusCode, 200)
  const payload = JSON.parse(res.body)
  assert.equal(payload.ok, true)
  assert.equal(payload.config.consolidateEnabled, true)
  assert.equal(configEditor.calls.length, 1)
  assert.equal(configEditor.calls[0].consolidateEnabled, true)
  assert.equal(configEditor.calls[0].nudgeAfterToolIters, 12)
  assert.equal(configEditor.calls[0].reviewPreset, 'skill-review')
})

test('config route rejects unknown keys, bad types and inconsistent days', async () => {
  const { web, configEditor } = makeDashboard()
  const unknown = await invokeAsync(web, '/skill-curator/api/config', fakePostRequest(JSON.stringify({ python: '/tmp/python' })))
  assert.equal(unknown.statusCode, 400)

  const badType = await invokeAsync(web, '/skill-curator/api/config', fakePostRequest(JSON.stringify({ nudgeAfterToolIters: '10' })))
  assert.equal(badType.statusCode, 400)

  const inconsistent = await invokeAsync(web, '/skill-curator/api/config', fakePostRequest(JSON.stringify({ staleDays: 40, archiveDays: 30 })))
  assert.equal(inconsistent.statusCode, 400)

  assert.equal(configEditor.calls.length, 0)
})

test('config route is POST-only, JSON-only, loopback-only and needs an editor', async () => {
  const { web } = makeDashboard()
  const get = invoke(web, '/skill-curator/api/config', fakeRequest('GET', '/skill-curator/api/config'))
  assert.equal(get.statusCode, 405)

  const form = await invokeAsync(web, '/skill-curator/api/config', fakePostRequest('a=b', '127.0.0.1', 'application/x-www-form-urlencoded'))
  assert.equal(form.statusCode, 415)

  const remote = await invokeAsync(web, '/skill-curator/api/config', fakePostRequest('{}', '192.168.1.20'))
  assert.equal(remote.statusCode, 403)

  const skillsRoot = tempRoot()
  const stateDir = tempRoot()
  const webNoEditor = fakeWebServer()
  const dashboard = registerDashboard(fakeContext(webNoEditor), {
    cfg: { skillsRoot, stateDir, skillctl: '/tmp/skillctl' },
    state: {},
    snapshot: () => ({ sessions: [] }),
  })
  assert.equal(dashboard.registered, true)
  const noEditor = await invokeAsync(webNoEditor, '/skill-curator/api/config', fakePostRequest(JSON.stringify({ enabled: true })))
  assert.equal(noEditor.statusCode, 501)
})
