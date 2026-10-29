---
name: lessons-learned
description: >-
  Turns mistakes made while following a skill into small, verified, approved
  improvements to that skill (fixes, Pitfalls, Lessons), and enforces the
  skill rules that keep skills lean (size budgets, max 10 pitfalls / 10
  lessons, encapsulated uv/docker environments). Use after a skill-guided task
  failed, needed retries, or the user corrected the approach; when a
  lessons-learned hook reports pending signals; when the user says "remember
  this", "that skill got it wrong", or runs /lessons-learned [audit|status|
  consolidate|rollback]; or when creating or auditing any skill.
---

# Lessons Learned

Improves skills from real mistakes, without letting them bloat. State lives in
`~/.claude/lessons-learned/` (ledger, signals, backups), never in skill dirs.

Scripts run only through uv (see `skill-env.toml`). Set once per run:

```bash
LL=~/.claude/skills/lessons-learned/scripts
```

## Hard rules

- Never edit a skill without showing the diff and getting approval (AskUserQuestion: Apply / Edit / Reject).
- Never edit read-only skills: plugin skills, `~/.claude/skills/synced/`, marketplace caches. Record them with `--status upstream`.
- Every proposal must pass `lint_skill.py` before it is shown. Lint errors force consolidation, not exceptions.
- Prefer fixing the faulty instruction over adding anything. Adding is the last resort.
- Never put secrets, customer data, or one-off incident detail in a skill.

## Subcommands

| Invocation | Action |
|---|---|
| `/lessons-learned` (or a hook nudge) | Review this session — workflow below |
| `audit [skill-dir]` | `uv run --script $LL/lint_skill.py --all` (or a dir); add `--exec` to smoke-test environments |
| `status` | `uv run --script $LL/ledger.py status` |
| `consolidate <skill-dir>` | Follow `references/consolidation.md`, propose one diff |
| `rollback <LL-id>` | `uv run --script $LL/ledger.py rollback <LL-id>` |

## Workflow (session review)

1. **Detect.** `uv run --script $LL/ledger.py signals --session <id>` (or `--latest`)
   plus the conversation: failed commands, retries, user corrections.
2. **Attribute.** Name the skill whose instruction (or missing instruction) caused
   the mistake. If no skill caused it, route via `references/triage.md`
   (memory, CLAUDE.md, or discard) and stop.
3. **Gate.** Continue only if all three hold:
   (a) concrete evidence — error text, correction quote, or diff;
   (b) the fix was verified to work in this session;
   (c) it will recur in future tasks, not a one-off.
   Otherwise record `--status rejected:gate` and stop.
4. **Dedupe.** `uv run --script $LL/ledger.py find --skill <name> --text "<symptom>"`
   and read the target's Pitfalls/Lessons. If it exists: reword or strengthen it
   and `ledger.py hit <LL-id>` — do not add a new entry.
5. **Classify and draft** (formats in `references/lesson-template.md`):
   - `fix` — the instruction was wrong: correct it in place (preferred).
   - `pitfall` — a situational trap: one bullet under `## Pitfalls`.
   - `lesson` — a standing rule: one bullet under `## Lessons`.
   Record it: `ledger.py add --skill <name> --kind <kind> --symptom ... --rule ... --evidence ...`
   → returns `LL-xxxx`; tag the bullet with it. If the draft touches scripts,
   also update `skill-env.toml`, PEP 723 headers and locks
   (`references/skill-environments.md`).
6. **Lint.** Copy the skill to the scratchpad, apply the draft there, run
   `uv run --script $LL/lint_skill.py <copy-dir>`. On a cap error, consolidate
   (`references/consolidation.md`) into the same proposal.
7. **Propose.** Show the unified diff (`diff -u`), the evidence and the LL-id.
   Ask: Apply / Edit / Reject.
8. **Apply.** `uv run --script $LL/ledger.py apply <LL-id> --skill-dir <dir> --from <copy-dir>`
   (backs up, copies changed files, marks `applied`). On Reject:
   `ledger.py reject <LL-id> --reason "..."` — then treat the reason as a
   signal about **this** skill (step 2 with skill = `lessons-learned`).
9. **Report** one line per entry: `LL-id · skill · kind · applied|rejected|upstream`.
   Then `ledger.py clear-signals --session <id>`.

## Self-improvement

`lessons-learned` is a managed skill like any other: rejected proposals, noisy
hook nudges, and rollbacks are signals against it, it goes through the same
gate, dedupe and lint, and it obeys the same caps.

## Creating or editing any skill

Before writing a new skill or changing one, read `references/skill-rules.md`
and run the linter on the result. The rules apply to all managed skills.

## Pitfalls

## Lessons
