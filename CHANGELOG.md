# Changelog

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
