# Security

## Reporting

Please open a private security advisory on this repository
(Security → Advisories → "Report a vulnerability") rather than a public issue.
Include the version, the configuration, and a minimal reproduction.

## Threat model

This plugin runs inside the DeepSeek Harness Host process with the user's privileges. It
spawns `skillctl` (Python) and a restricted review child agent. The relevant boundaries:

- **Review child.** Mounted under the bundled `skill-review` preset, which exposes only
  `skill_list`, `skill_read` and `skill_manage`. The preset scope denies every other
  global tool. The child has no shell, no direct filesystem writes, no network tools.
- **Writes.** All skill changes go through `skillctl`: name validation, frontmatter
  validation, read-before-write SHA checks, support-file path confinement, ledger with
  blobs, archive instead of delete. The Host never writes `SKILL.md` itself.
- **Browser half.** Two GET-only routes, loopback-only, skill names validated, and no
  path outside `<skillsRoot>/<name>/SKILL.md` is exposed. The browser half has no write
  path.
- **Data leaving the process.** The reviewer receives the finished conversation
  transcript (up to `maxTranscriptChars`) and the skill list, and runs on the same model
  route as the reviewed session unless configured otherwise. This is inherent to
  background review; do not enable the plugin where transcripts may not reach that
  provider.
- **Credentials.** `skillctl` never reads credential files. The Host passes the
  environment through to `skillctl`; `reviewEnv` only adds `DSH_SKILLS_ROOT`.

## Supported versions

The latest tagged release on the default branch. The plugin tracks the DSH version it
was tested against in the README; older DSH builds may not provide the services the
bundle expects.
