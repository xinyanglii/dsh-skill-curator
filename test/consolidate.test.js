import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { buildConsolidationReport, renderConsolidationReport, writeConsolidationReport } from '../consolidate.js'

const started = Date.parse('2026-10-22T01:00:00Z')

function before() {
  return [
    { name: 'notion-read', state: 'active', use_count: 1 },
    { name: 'notion-write', state: 'active', use_count: 0 },
    { name: 'stale-one', state: 'stale', use_count: 0 },
    { name: 'old-skill', state: 'active', use_count: 3 },
  ]
}

function after() {
  return [
    { name: 'notion', state: 'active', use_count: 1 },
    { name: 'stale-one', state: 'archived', use_count: 0 },
  ]
}

test('classifies removed skills from the archive ledger', () => {
  const report = buildConsolidationReport({
    startedAt: started,
    finishedAt: started + 90_000,
    before: before(),
    after: after(),
    ledgerEntries: [
      { op: 'archive', name: 'notion-read', absorbed_into: 'notion', ts: '2026-10-22T01:00:30Z' },
      { op: 'archive', name: 'notion-write', absorbed_into: 'notion', ts: '2026-10-22T01:00:31Z' },
      { op: 'archive', name: 'old-skill', ts: '2026-10-22T01:00:32Z' },
      { op: 'archive', name: 'notion-read', absorbed_into: 'notion', ts: '2026-01-01T00:00:00Z' },
    ],
  })

  assert.deepEqual(report.added, ['notion'])
  assert.deepEqual(report.consolidated.map((entry) => entry.name).sort(), ['notion-read', 'notion-write'])
  assert.deepEqual(report.consolidated.map((entry) => entry.into), ['notion', 'notion'])
  assert.deepEqual(report.pruned.map((entry) => entry.name), ['old-skill'])
  assert.equal(report.counts.consolidated, 2)
  assert.equal(report.counts.pruned, 1)
  assert.deepEqual(report.transitions, [{ name: 'stale-one', from: 'stale', to: 'archived' }])
  assert.equal(report.beforeTotal, 4)
  assert.equal(report.afterTotal, 2)
  assert.equal(report.delta, -2)
})

test('does not treat a missing umbrella as a consolidation', () => {
  const report = buildConsolidationReport({
    startedAt: started,
    before: before(),
    after: [],
    ledgerEntries: [
      { op: 'archive', name: 'notion-read', absorbed_into: 'notion-missing', ts: '2026-10-22T01:00:30Z' },
    ],
  })
  assert.equal(report.consolidated.length, 0)
  assert.equal(report.pruned.length, 4)
  assert.equal(report.pruned[0].source, 'absorbed_into target missing')
})

test('renders a report with sections and recovery hints', () => {
  const report = buildConsolidationReport({
    startedAt: started,
    before: before(),
    after: after(),
    ledgerEntries: [{ op: 'archive', name: 'notion-read', absorbed_into: 'notion', ts: '2026-10-22T01:00:30Z' }],
    output: 'Merged the notion cluster.',
    autoSummary: '1 marked stale',
  })
  const markdown = renderConsolidationReport(report)
  assert.match(markdown, /# Curator consolidation/)
  assert.match(markdown, /notion-read.*→ merged into.*notion/)
  assert.match(markdown, /## Recovery/)
  assert.match(markdown, /skillctl restore/)
  assert.match(markdown, /Merged the notion cluster\./)
})

test('writes run.json and REPORT.md into the state directory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-curator-report-'))
  const report = buildConsolidationReport({ startedAt: started, before: before(), after: after() })
  const written = writeConsolidationReport(dir, report)
  assert.ok(fs.existsSync(written.runPath))
  assert.ok(fs.existsSync(written.reportPath))
  assert.equal(JSON.parse(fs.readFileSync(written.runPath, 'utf8')).beforeTotal, 4)
  fs.rmSync(dir, { recursive: true, force: true })
})
