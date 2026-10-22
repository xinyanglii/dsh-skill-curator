// Report builder for the optional consolidation pass.
//
// Pure functions: the Host plugin collects the before/after library snapshots
// (`skillctl list --json`) and the ledger rows written during the run, then this
// module classifies every removed skill as consolidated or pruned and renders a
// per-run report. No network, no model, no file access here beyond writing the
// report directory.

import fs from 'node:fs'
import path from 'node:path'

function iso(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function names(rows) {
  return new Set((Array.isArray(rows) ? rows : []).map((row) => row && row.name).filter((name) => typeof name === 'string' && name))
}

export function buildConsolidationReport({
  startedAt,
  finishedAt = Date.now(),
  before,
  after,
  ledgerEntries,
  output = '',
  error = null,
  autoSummary = '',
  dryRun = false,
}) {
  const beforeRows = Array.isArray(before) ? before : []
  const afterRows = Array.isArray(after) ? after : []
  const beforeNames = names(beforeRows)
  const afterNames = names(afterRows)
  const added = [...afterNames].filter((name) => !beforeNames.has(name)).sort()
  const removed = [...beforeNames].filter((name) => !afterNames.has(name)).sort()

  // The ledger is the authoritative signal: an archive that declared
  // absorbed_into was a consolidation; one without it was a prune.
  const absorbed = new Map()
  for (const entry of Array.isArray(ledgerEntries) ? ledgerEntries : []) {
    if (!entry || entry.op !== 'archive') continue
    if (typeof entry.name !== 'string' || !entry.name) continue
    const ts = Date.parse(entry.ts || '')
    if (!Number.isFinite(ts) || ts < startedAt - 2000) continue
    if (typeof entry.absorbed_into === 'string' && entry.absorbed_into) {
      absorbed.set(entry.name, entry.absorbed_into)
    }
  }

  const destinations = new Set([...afterNames, ...added])
  const consolidated = []
  const pruned = []
  for (const name of removed) {
    const into = absorbed.get(name)
    if (into && into !== name && destinations.has(into)) {
      consolidated.push({ name, into, source: 'absorbed_into (ledger)' })
    } else {
      pruned.push({ name, source: into ? 'absorbed_into target missing' : 'no absorbed_into' })
    }
  }

  const beforeByName = new Map(beforeRows.map((row) => [row && row.name, row]))
  const transitions = []
  for (const row of afterRows) {
    const previous = beforeByName.get(row && row.name)
    if (previous && row.state && previous.state && previous.state !== row.state) {
      transitions.push({ name: row.name, from: previous.state, to: row.state })
    }
  }

  return {
    startedAt: iso(startedAt),
    finishedAt: iso(finishedAt),
    durationMs: Math.max(0, finishedAt - startedAt),
    autoSummary: String(autoSummary || ''),
    dryRun: dryRun === true,
    beforeTotal: beforeNames.size,
    afterTotal: afterNames.size,
    delta: afterNames.size - beforeNames.size,
    added,
    removed,
    consolidated,
    pruned,
    transitions,
    counts: {
      consolidated: consolidated.length,
      pruned: pruned.length,
      added: added.length,
      removed: removed.length,
    },
    output: String(output || ''),
    error: error ? String(error) : null,
  }
}

export function renderConsolidationReport(report) {
  const seconds = Math.round((report.durationMs || 0) / 1000)
  const lines = [
    `# Curator consolidation — ${report.startedAt}${report.dryRun ? ' (dry run)' : ''}`,
    '',
    `Library: ${report.beforeTotal} → ${report.afterTotal} skills (${report.delta >= 0 ? '+' : ''}${report.delta}) · ${seconds}s`,
    '',
  ]
  if (report.dryRun) lines.push('> Dry run: no writes were allowed. The sections below describe what the pass reported.', '')
  if (report.error) lines.push(`> ⚠ Consolidation pass error: \`${report.error}\``, '')
  if (report.autoSummary) lines.push('## Deterministic curator (no LLM)', '', report.autoSummary, '')
  lines.push('## Consolidation pass', '')
  lines.push(`- consolidated into umbrellas: **${report.counts.consolidated}**`)
  lines.push(`- pruned (archived without an umbrella): **${report.counts.pruned}**`)
  lines.push(`- new skills this run: **${report.counts.added}**`)
  lines.push(`- state transitions: **${report.transitions.length}**`, '')
  if (report.consolidated.length > 0) {
    lines.push('### Consolidated into umbrella skills', '')
    lines.push('_Archived and recoverable via `skillctl restore <name>`._', '')
    for (const entry of report.consolidated) lines.push(`- \`${entry.name}\` → merged into \`${entry.into}\``)
    lines.push('')
  }
  if (report.pruned.length > 0) {
    lines.push('### Pruned — archived without an umbrella', '')
    for (const entry of report.pruned) lines.push(`- \`${entry.name}\` (${entry.source})`)
    lines.push('')
  }
  if (report.added.length > 0) {
    lines.push('### New skills this run', '')
    for (const name of report.added) lines.push(`- \`${name}\``)
    lines.push('')
  }
  if (report.transitions.length > 0) {
    lines.push('### State transitions', '')
    for (const item of report.transitions) lines.push(`- \`${item.name}\`: ${item.from} → ${item.to}`)
    lines.push('')
  }
  if (report.output) {
    lines.push('## Curator final summary', '', report.output, '')
  }
  lines.push('## Recovery', '')
  lines.push('- Restore an archived skill: `skillctl restore <name>`')
  lines.push('- Archives live under `<skillsRoot>/.archive/` and are recoverable')
  lines.push('- The full machine-readable record is `run.json` in this directory', '')
  return lines.join('\n')
}

export function writeConsolidationReport(stateDir, report) {
  const stamp = report.startedAt.replace(/[:]/g, '-')
  const dir = path.join(stateDir, 'curator-runs', stamp)
  fs.mkdirSync(dir, { recursive: true })
  const runPath = path.join(dir, 'run.json')
  fs.writeFileSync(runPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  const reportPath = path.join(dir, 'REPORT.md')
  fs.writeFileSync(reportPath, renderConsolidationReport(report), 'utf8')
  return { dir, runPath, reportPath }
}
