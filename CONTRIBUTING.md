# Contributing

Thanks for taking a look. This is a small, dependency-free bundle; keeping it that way
is part of the design.

## Development loop

```bash
git clone https://github.com/xinyanglii/dsh-skill-curator.git
cd dsh-skill-curator

# Link the checkout into a profile (desktop or web)
dsh plugin --profile desktop add "$PWD"

# Activate it once: add "dsh-skill-curator" to dsh.profile.bundles in
# ~/.dsh/profiles/desktop/package.json

# After editing host code, remove + reinstall the bundle (or restart the app)
# so the new module generation loads.
```

Useful checks:

```bash
npm test          # Node tests + vendored skillctl tests
npm run check     # syntax checks for every entry point
node --check client.js
python3 -m py_compile scripts/skillctl
```

## Layout

| File | Responsibility |
|---|---|
| `index.js` | Host plugin: session observation, counters, review queue, child activation, curator, self-test. |
| `dashboard.js` | Loopback-only GET routes and the read-only state payload. |
| `preset.js` | Scoped tools for the `skill-review` preset: `skill_list`, `skill_read`, `skill_manage`. |
| `client.js` | Browser half: sidebar icon + main panel, polling the two routes. |
| `cordis.patch.yml` | Bundle patch: the host row and the `skill-review` preset declaration. |
| `scripts/skillctl` | Vendored authoring CLI: validation, ledger, usage, curator, prompt builder. |

Rules of thumb:

- Keep the browser half read-only. Writes belong to `skillctl` on the Host.
- Keep the review child's tool surface minimal. New tools are a design decision, not a
  convenience.
- Never add a delete action to the skill library. Archive is reversible; deletion is not.
- Tests must not require a live DSH host. Fake the Cordis context; use temporary
  directories for the skill library.

## Pull requests

- One change per PR, with the reason in the description.
- Run `npm test` and `npm run check` before opening it.
- Add or update a test for every behavior change. Route changes need a 200/403/405 case;
  `skillctl` changes need a create/patch/archive case.
- Keep the browser half's EN/ZH dictionaries in `client.js` in sync; `locale/*.json`
  only carries the plugin's display metadata (title/description).

## Release checklist

1. Update `CHANGELOG.md` and bump `package.json` `version`.
2. `npm test && npm run check`.
3. Tag: `git tag vX.Y.Z && git push --tags`.
4. Verify a clean clone: install it into a throwaway profile, confirm `plugin.started`
   and the dashboard route answer.
