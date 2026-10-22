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

function fakeContext(web) {
  return {
    get: (key) => (key === 'webServer' ? web : undefined),
    effect: (fn) => {
      const dispose = fn()
      return typeof dispose === 'function' ? dispose : () => {}
    },
  }
}

function fakeRequest(method, url, remoteAddress = '127.0.0.1') {
  return { method, url, headers: { host: '127.0.0.1:1' }, socket: { remoteAddress } }
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
  const dashboard = registerDashboard(fakeContext(web), {
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
  return { dashboard, web, skillsRoot, stateDir }
}

test('registers both GET routes and reports them', () => {
  const { dashboard, web } = makeDashboard()
  assert.equal(dashboard.registered, true)
  assert.deepEqual(dashboard.routes.sort(), ['/skill-curator/api/skill', '/skill-curator/api/state'])
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
