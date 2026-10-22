# Changelog

## 0.3.1 — 2026-10-22

- Fix: the Configuration form was missing the dashboard `reload` prop, so a
  successful save still showed `Save failed: reload is not a function`. Saves now
  show Saved and refresh only when the reload function exists; regression check
  added.
- A pending `skillctl curator --request-consolidation` marker is also consumed on
  plugin activation, so a manual request survives a restart or bundle reload.
- Manual consolidation runs no longer label the report section "Deterministic
  curator (no LLM)"; only a real deterministic pass carries that summary.

## 0.3.0 — 2026-10-22

First public release.

- Host plugin: post-turn review counter (model iterations, Hermes-compatible), one
  review at a time, restricted child activation, durable review counters and a
  one-shot self-test canary.
- `skill-review` agent preset exposing only `skill_list`, `skill_read` and
  `skill_manage`.
- Vendored `skillctl`: validated writes, SHA-guarded patches, support-file path
  confinement and hard size limits, append-only ledger with blobs, archive/restore,
  usage telemetry, deterministic lifecycle curator and the reviewer prompt builder.
- Optional Hermes-style consolidation pass: off by default, restricted child,
  curator-managed candidates only, `absorbed_into` archive guard, pre-run backup and
  per-run `run.json`/`REPORT.md`. Manual trigger via
  `skillctl curator --request-consolidation`.
- Read-only dashboard: sidebar panel with library, review history, 14-day activity
  and a four-control editable configuration (auto-review, threshold, curator,
  consolidation); loopback-only routes.
- Tests: Node test runner for host/dashboard/preset/browser halves and the
  consolidation report; Python `unittest` for the vendored CLI. CI on Node 20/22 and
  Python 3.11.
