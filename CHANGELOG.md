# Changelog

## Unreleased

- Separate the curator's internal runs from the session subagent catalog. The shipped
  subagents button is unchanged except that internal rows are hidden and its count is
  corrected to user subagents only. A new `N curator runs` header action lists the
  internal review/consolidation/self-test runs and opens them like the subagents
  dropdown.
- Internal runs are identified by child session id recorded by the Host, not by label:
  a normal code-review subagent called "skill review" stays in the subagents list and
  is never treated as curator work.

## 0.3.2 — 2026-10-22

- Prevent the background reviewer from duplicating user-owned skills: the review
  prompt tags every skill with its origin, marks manual/learn/installed skills
  read-only, and tells the reviewer to say `Nothing to save.` when a user-owned skill
  already covers the lesson instead of creating a parallel agent skill.
- Review context: the prompt includes the skills the primary agent loaded this
  session and requires their conventions to be treated as binding.
- Read-before-write for support files: `skill_read` can read one file and return its
  SHA; overwriting an existing support file requires that SHA, matching SKILL.md
  patches.
- `skillctl` refuses agent writes to any non-agent skill (patch, write_file, archive),
  and consolidation refuses to absorb into a user-owned umbrella.
- Snapshot recovery: `backup --reason/--list`, `manifest.json`, and
  `rollback --snapshot <id|latest>` with an automatic pre-rollback snapshot.
- Ops: `status [--json]`, `pause/resume`, `curator --dry-run`,
  `request-consolidation --dry-run` (writes refused, report marked dry-run),
  `list-unmanaged`, `adopt --all-unmanaged [--yes]`, `list-archived`,
  `prune`, `purge`, and `ledger --skill/--json`.
- The host skips automatic curator runs while paused and runs requested consolidation
  passes in dry-run mode when the marker asks for it.

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
