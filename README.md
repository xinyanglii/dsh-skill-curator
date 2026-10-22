# dsh-skill-curator

[![test](https://github.com/xinyanglii/dsh-skill-curator/actions/workflows/test.yml/badge.svg)](https://github.com/xinyanglii/dsh-skill-curator/actions/workflows/test.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node >= 20](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](package.json)

Hermes-style, in-process background skill learning for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

It watches finished conversations, reviews them in a restricted child agent, writes
class-level skills through a validated CLI, keeps the library tidy with a
deterministic lifecycle curator, and ships a read-only dashboard panel.

## What it does

- **Post-turn review.** Counts model iterations per root session (one per assistant
  step, parallel tool calls in a step count once) across turns. When a completed turn
  crosses the threshold, it starts a review child in the same process.
- **Restricted reviewer.** The child runs under the bundled `skill-review` agent preset:
  a persona plus `skill_list` / `skill_read` / `skill_manage`. No shell, no direct file
  writes, no network tools.
- **Validated writes.** Every write goes through `skillctl` (vendored in `scripts/`):
  name and frontmatter validation, read-before-write SHA checks, support-file path
  confinement, append-only ledger with blobs, and archive instead of delete.
- **Lifecycle curator.** Once per `curatorEveryDays` it runs `skillctl curator --apply`:
  `active → stale` (14 days unused) → `archived` (30 days unused). Archive-only and
  reversible.
- **Optional consolidation pass.** Off by default. When enabled, the same run then starts
  one restricted child that merges overlapping curator-managed skills into umbrellas,
  demotes narrow depth into support files, and archives absorbed siblings with an explicit
  `absorbed_into` mapping.
- **Usage telemetry.** Skill loads are folded into `<skillsRoot>/.dsh-usage.json`, the
  same file the curator reads.
- **Dashboard.** A sidebar panel (`Skill Curator`) backed by two loopback-only GET
  routes: library, review history, 14-day activity, and a collapsed technical section.
- **Self-test canary.** On first activation it starts one canary child that must resolve
  the preset and call `skill_list`, so a broken setup fails visibly before the first
  real review.

## How it works

```
session events ──► iteration counter (root sessions only, persisted)
                         │
             completed turn, counter ≥ threshold
                         ▼
              skillctl review --session <id>        (build prompt from the transcript)
                         ▼
        subagent activation under the `skill-review` preset
        (persona + skill_list / skill_read / skill_manage only)
                         ▼
              skillctl manage create|patch|write_file|archive
              (validate → write → ledger → usage)
                         ▼
        review.finished / review.failed → state.json → dashboard
```

The plugin never edits `SKILL.md` itself and never exposes a write API to the browser.

## Requirements

| Requirement | Notes |
|---|---|
| DeepSeek Harness | Developed against `0.2.1-rc.2`; bundles are ordinary profile patch layers. |
| Node.js | `>= 20` for the host plugin. |
| Python | `>= 3.9` on `PATH` (or set `python` / `DSH_CURATOR_PYTHON`). |
| `zstd` | `zstdcat` is used to read session logs for transcripts and usage scans. Install with `brew install zstd` or `apt install zstd`. |

## Install

A DSH bundle is a package with a `dsh.bundle.patch` layer. Installing the package does
not activate it; add it to the profile's bundle list as well.

### From GitHub

```bash
# 1. Install the package into the profile (creates ~/.dsh/profiles/<name>/node_modules)
dsh plugin --profile desktop add github:xinyanglii/dsh-skill-curator

# 2. Activate the bundle: add "dsh-skill-curator" to dsh.profile.bundles in
#    ~/.dsh/profiles/desktop/package.json

# 3. Restart the app once so the browser half is loaded.
```

Use `--profile web` (or another profile) to install into a different runtime. The
dashboard only appears in Web/Desktop profiles; headless and ACP profiles have no
browser surface.

### From a local checkout

```bash
git clone https://github.com/xinyanglii/dsh-skill-curator.git
dsh plugin --profile desktop add /absolute/path/to/dsh-skill-curator
# then add "dsh-skill-curator" to dsh.profile.bundles
```

### Verify

```bash
tail ~/.dsh/skills/.dsh-curator/plugin.log     # plugin.started / dashboard.registered
curl http://127.0.0.1:<port>/skill-curator/api/state
```

The port is the profile's Web host; the desktop app proxies it internally.

## Configuration

Override any value from the profile's `cordis.patch.yml` by row id (`skill-curator`):

```yaml
- id: skill-curator
  config:
    nudgeAfterToolIters: 10
    python: /usr/bin/python3
```

| Field | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Master switch. |
| `skillsRoot` | `~/.dsh/skills` | Skill library root (shared by every profile). |
| `skillctl` | packaged `scripts/skillctl` | Authoring CLI used for prompts and writes. |
| `python` | `python3` | Interpreter for `skillctl` (`DSH_CURATOR_PYTHON` also works). |
| `stateDir` | `<skillsRoot>/.dsh-curator` | `state.json` and `plugin.log`. |
| `nudgeAfterToolIters` | `10` | Accumulated model iterations before a review. |
| `reviewEnabled` | `true` | Trigger reviews at all. |
| `reviewPreset` | `skill-review` | Agent preset mounted for the child. |
| `reviewProvider` | `spawn` | Subagent provider used for the child. |
| `reviewAgentProvider` / `reviewAgentModel` | empty | Explicit reviewer route; empty copies the parent session's live route. |
| `reviewTimeoutMs` | `900000` | Hard timeout for one review. |
| `maxTranscriptChars` | `40000` | Transcript budget passed to `skillctl review`. |
| `curatorEnabled` | `true` | Run the deterministic lifecycle curator. |
| `curatorEveryDays` | `7` | Minimum interval between curator runs. |
| `staleDays` | `14` | Unused days before a skill becomes stale. |
| `archiveDays` | `30` | Unused days before a stale skill is archived. |
| `consolidateEnabled` | `false` | Run the optional LLM umbrella-building pass after the deterministic curator. |
| `consolidatePreset` | `skill-consolidate` | Preset mounted for the consolidation child. |
| `consolidateTimeoutMs` | `1800000` | Hard timeout for one consolidation run. |
| `consolidateBackupKeep` | `2` | Whole-tree snapshots kept before consolidation runs. |
| `selfTestOnFirstRun` | `true` | Run the one-shot canary on first activation. |
| `maxSessions` | `200` | Session-counter records kept in state. |
| `logMaxBytes` | `2097152` | Rotate `plugin.log` after this size. |

## Skill lifecycle and layout

```
~/.dsh/skills/
├── <skill>/SKILL.md            # skills themselves
├── .dsh-usage.json             # use counts, last-used, state, provenance
├── .curator_ledger.jsonl       # append-only write ledger
├── .ledger/blobs/              # content blobs for rollback
├── .curator_backups/           # tree snapshots
├── .archive/                   # archived skills (never deleted)
└── .dsh-curator/               # state.json, plugin.log
```

Available `skill_manage` actions: `create`, `patch`, `write_file`, `archive`.
There is deliberately no delete action; `skillctl restore` brings an archived skill back.

## Write limits

`skillctl` enforces these as **hard errors returned to the reviewer**; skill content is
never silently truncated. A rejected write leaves the library unchanged and the reviewer
gets the measured size plus the limit, so it can split the skill or move detail into
`references/` and retry.

| Item | Limit | Behavior |
|---|---|---|
| `SKILL.md` (whole file) | 100,000 characters | hard error |
| One supporting file | 1 MiB | hard error |
| `description` | 500 characters | hard error (DSH truncates above 500); 120 is the recommended routing length |
| `SKILL.md` advisory | 24,000 bytes | warning only: "should split into references/" |

These are write-path limits. The only truncation in the plugin is the review **input**
transcript (`maxTranscriptChars`, default 40,000 characters), which is a prompt budget, not
a skill-content limit. Skill injection/read behavior belongs to DSH itself.

## Consolidation pass (optional)

A library can fragment into many narrow siblings that no single review can see. The
consolidation pass is Hermes's answer: one extra background child that reads the whole
curator-managed library and builds umbrellas.

- **Off by default.** Enabling it costs one model call per curator run and rewrites
  skill content, so it is an explicit opt-in.
- Runs after the deterministic stale/archive transitions, at most once per
  `curatorEveryDays`.
- Candidates are **curator-managed** skills (`created_by: agent`), excluding pinned
  skills; user-authored/installed skills are never touched.
- The child gets the same restricted tool surface (`skill_list`, `skill_read`,
  `skill_manage`) and a dedicated prompt. It may merge into an existing umbrella, create a
  new one, or demote depth into `references/`/`templates/`/`scripts/`.
- Every archive must declare `absorbed_into=<existing umbrella>`; skillctl validates the
  umbrella exists and records the mapping in the ledger and usage record. Without it the
  archive is refused.
- A whole-tree snapshot is taken first (`skillctl backup --keep N`); the run writes
  `run.json` and `REPORT.md` under `<stateDir>/curator-runs/<timestamp>/` with the
  consolidated/pruned classification, added skills, state transitions and the child's
  final summary. Archives remain recoverable with `skillctl restore <name>`.
- Manual trigger (Hermes `curator run --consolidate` equivalent):
  `skillctl curator --request-consolidation` writes a request marker; the plugin consumes
  it at the next completed turn and runs one pass even when `consolidateEnabled` is false.
- Unlike Hermes, DSH has no cron-job skill references, so there is no cron rewrite step.

### User-owned skills

Skills with `created_by: manual`, `learn` or `installed` are user-owned. The background
reviewer may read them, but it never writes to them:

- The review prompt tags every skill with its origin; `[manual]`, `[learn]` and
  `[installed]` are marked read-only.
- If a user-owned skill already covers the workflow or lesson, the reviewer must say
  `Nothing to save.` instead of creating a parallel agent skill.
- `skillctl` refuses agent writes (patch, write_file, archive) to user-owned skills, and
  the consolidation pass cannot absorb anything into one.
- To let the curator maintain a hand-written skill, run `skillctl adopt <name>`; this
  sets `created_by: agent` without touching its clocks.

## Dashboard

- Sidebar entry **Skill Curator** → full-width main panel.
- `GET /skill-curator/api/state`, `GET /skill-curator/api/skill?name=<name>`, and
  `POST /skill-curator/api/config` for the editable settings.
- All routes are loopback-only; the GET routes expose nothing outside
  `<skillsRoot>/<name>/SKILL.md`. The POST route accepts JSON only, validates every key
  against a fixed schema, and writes through the Host `configEditor` into the active
  profile patch (live reload); paths, python, skillctl and plugin/preset identities are
  not writable from the browser.

## Security model

- The review child sees only the three skill tools; the `skill-review` preset scope
  denies every other global tool, incrementally and defensively.
- The reviewer receives the conversation transcript (up to `maxTranscriptChars`) and the
  skill list; it runs on the same model route as the session it reviews unless overridden.
  Do not enable this plugin on sessions whose transcripts must not leave the model
  provider you already use.
- `skillctl` runs as the current user and writes only under `skillsRoot` (plus archive,
  ledger, backups and state beneath it). It never reads credential files.
- HTTP routes are loopback-only and expose no files outside the skill directory.

## Tests

```bash
npm test
```

- `node --test test/*.test.js` covers the manifest, bundle patch, dashboard routes
  (200/400/403/405, traversal, dispose), preset tool registration and argument
  validation against a fake `skillctl`, the consolidation report builder, and the
  browser-half registration.
- `python3 -m unittest discover -s test -p 'test_*.py'` covers the vendored `skillctl`:
  create, patch with SHA checks, confined support files, archive/restore, validation,
  consolidation candidates/prompt, `absorbed_into` guards, `list --json`, and the
  reviewer prompt builder.
- CI runs both on Node 20/22 with Python 3.11.

## Compatibility notes

- Counting matches Hermes's `_iters_since_skill`: one per model iteration, accumulated
  across turns, checked at turn end. Hermes's separate memory nudge counter is not
  implemented here; long-term memory belongs to your memory plugin.
- Cron/scheduled sessions are not skipped. Only root sessions are counted; review
  children are excluded.
- The consolidation pass follows Hermes's guard shape (curator-managed only, pinned
  skipped, archive-only with a validated umbrella, pre-run snapshot) but not its cron
  reference rewrite, because DSH schedules do not carry structured skill references.
- Adding or removing `dsh.client` metadata on an already-loaded package specifier needs
  an App restart. Code-only changes to an installed bundle can be reloaded by removing
  and reinstalling the bundle.

## License

MIT © 2026 dsh-skill-curator contributors
