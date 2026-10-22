# Changelog

## 0.4.1 — 2026-10-22

- Simplified the editable configuration form to four controls (auto-review,
  review threshold, curator, consolidation) with a Save action; every other
  setting remains in the profile patch. Removed the redundant groups and the
  read-only preset/path duplication.

## 0.4.0 — 2026-10-22

- The dashboard Configuration section is now an editable form: auto-review, review
  threshold/timeout/transcript limit, curator interval and stale/archive days,
  consolidation state/timeout/backups.
- New `POST /skill-curator/api/config` (loopback-only, JSON-only, fixed schema) persists
  changes through the Host `configEditor` into the active profile patch and applies them
  live. Plugin/preset/provider/path values are read-only from the browser.
- Tests for the config route: validation, unknown keys, POST-only/JSON-only/loopback,
  missing config editor, and the persisted patch.

## 0.3.2 — 2026-10-22

- Dashboard: a visible Configuration section with the live review/curator/
  consolidation settings and paths; consolidation state (`lastConsolidateAt`,
  summary) is exposed in the state payload.
- The Technical details disclosure now only carries the recent ledger rows.

## 0.3.1 — 2026-10-22

- Manual consolidation trigger: `skillctl curator --request-consolidation` writes a
  request marker that the plugin consumes at the next completed turn (works even when
  `consolidateEnabled` is false, like Hermes's `curator run --consolidate`).
- Test for the request marker.

## 0.3.0 — 2026-10-22

- Optional Hermes-style consolidation pass (`consolidateEnabled`, off by default):
  after the deterministic curator, a restricted child merges overlapping
  curator-managed skills into umbrellas and archives absorbed siblings.
- `skillctl consolidate` prints the umbrella-building prompt; `skillctl list --json`
  exposes the library snapshot used for before/after reporting.
- `skill_manage archive` accepts `absorbed_into`; in consolidation mode skillctl
  requires it, validates the umbrella exists, refuses pinned/user-owned skills, and
  records the mapping in the ledger and usage record.
- Pre-run `skillctl backup` snapshot, per-run `run.json` + `REPORT.md` under
  `<stateDir>/curator-runs/`, and consolidated/pruned classification from the ledger.
- New `skill-consolidate` preset; tests for prompt candidates, absorbed_into guards,
  list JSON, preset environment and report building.

## 0.2.1 — 2026-10-22

- Hard write limits, aligned with Hermes and returned as tool errors (never truncation):
  `SKILL.md` 100,000 characters, each supporting file 1 MiB. The 24,000-byte body warning
  remains advisory.
- Removed the unused `maxContentChars` preset config key.
- Added tests for oversized create/patch/write_file rejection.

## 0.2.0 — 2026-10-22

First public release.

- Host plugin: post-turn review counter (model iterations, Hermes-compatible), queue with
  one review at a time, restricted child activation, durable review counters.
- `skill-review` agent preset with only `skill_list`, `skill_read`, `skill_manage`.
- Vendored `skillctl`: validated writes, SHA-guarded patches, support-file confinement,
  ledger with blobs, archive/restore, usage telemetry, deterministic curator, reviewer
  prompt builder.
- Read-only dashboard: sidebar panel with library, review history, 14-day activity and a
  collapsed technical section; two loopback-only GET routes.
- Self-test canary on first activation.
- Tests: Node test runner for host/dashboard/preset/browser halves; Python `unittest`
  for the vendored CLI. CI on Node 20/22 + Python 3.11.
