# Skill rules

Every managed skill (user-level `~/.claude/skills/*`, project `.claude/skills/*`)
must obey these. `scripts/lint_skill.py` enforces them: **E** = error (blocks a
proposal), **W** = warning (reported, fix when convenient). Codes in brackets.

## 1. Frontmatter
- E [FM001] `SKILL.md` starts with YAML frontmatter containing `name` and `description`.
- E [FM002] `name` is kebab-case and equals the directory name.
- E [FM003] `description` ≤ 1024 characters.
- W [FM004] `description` says what the skill does **and** when to use it ("Use when/whenever/after/for …").

## 2. Size budget
- W [SZ001] SKILL.md > 300 lines. E [SZ002] > 500 lines.
- W [SZ003] SKILL.md > ~5,000 tokens (characters ÷ 4).

## 3. Progressive disclosure
- SKILL.md holds the workflow; detail lives in `references/*.md`, linked one level deep.
- E [PD001] A relative link or backticked `references/…`/`scripts/…` path in SKILL.md points to a missing file.
- W [PD002] A file in `references/` is not mentioned in SKILL.md.

## 4. Lessons — standing rules
- Section `## Lessons`, one bullet each: `Do X / Never Y — because Z [LL-xxxx]`.
- E [LS001] > 10 bullets. E [LS002] bullet > 200 characters. E [LS003] bullet without `[LL-xxxx]`.
- Overflow goes through consolidation, never just appended.

## 5. Pitfalls — situational traps
- Section `## Pitfalls`, one bullet each:
  `**<symptom/trigger>** → <why it fails> → <what to do instead> [LL-xxxx]`.
- A pitfall is something that *looks right but fails in a specific situation*;
  a lesson is a rule that always applies.
- E [PF001] > 10 pitfalls in SKILL.md. E [PF002] pitfall > 250 characters.
- E [PF003] pitfall missing a part (two `→`) or the `[LL-xxxx]` tag.
- E [PF004] > 10 pitfalls in `references/pitfalls.md` — hard cap of 20 per skill,
  so overflow cannot just move the bloat.
- W [PF005] a pitfall duplicates a lesson (similarity ≥ 0.8). Keep one.

## 6. No duplication
- W [DU001] two bullets within Lessons or Pitfalls with token similarity ≥ 0.8.
- W [DU002] a bullet restates a line of `~/.claude/CLAUDE.md`.

## 7. Imperative and generic
- W [GN001] a Lessons/Pitfalls bullet names an absolute path, a date, or a ticket/incident id.
  Specifics belong in ledger evidence, not the skill.

## 8. No secrets
- E [SC001] anything that looks like an API key, token, private key, `password=`/`secret=` value, or an email address.

## 9. Staleness
- W [ST001] a ledger entry `applied` with `hits=0` older than 90 days — candidate to retire.

## 10. Read-only targets
- Plugin skills, `~/.claude/skills/synced/`, and marketplace caches are never edited.
  Lint reports them with [RO001] (info) and `ledger.py` records lessons with `status=upstream`.

## 11. Encapsulated environment
Full contract: `skill-environments.md`.
- E [EV001] `scripts/` (or any code file) exists but there is no `skill-env.toml`.
- E [EV002] `skill-env.toml` invalid: unknown `runtime`, or `runtime="none"` with code present.
- E [EV003] uv runtime: a `.py` script without a PEP 723 `# /// script` block.
- E [EV004] SKILL.md runs scripts via bare `python`/`python3`/`node`/`npx` instead of the declared runner.
- E [EV005] global/host installs anywhere in the skill: `pip install`, `npm install -g`, `npm i -g`, `sudo`, `apt install`/`apt-get install`, `curl … | sh`.
- E [EV006] docker runtime: `env/Dockerfile` missing, or a `FROM` with `:latest` / no tag.
- W [EV007] uv script with third-party dependencies but no `<script>.py.lock`.
- W [EV008] docker `network` is not `none` and `network_reason` is empty.
- E [EV009] a declared entrypoint file does not exist.
- E [EV010] (`--exec`) the declared runner (`uv`/`docker`) is not installed, or an entrypoint smoke test fails.
