# Changelog

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
