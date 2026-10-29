# Where a lesson belongs

Decide in this order; stop at the first match.

| The lesson is… | Goes to | How |
|---|---|---|
| A wrong or missing instruction in a managed skill | That skill — `fix` | Edit the instruction in place |
| A trap that bites only in a specific situation while using a skill | That skill — `pitfall` | `## Pitfalls` bullet |
| A rule that always applies while using a skill | That skill — `lesson` | `## Lessons` bullet |
| About a read-only skill (plugin / synced / marketplace) | Ledger only | `ledger.py add … --status upstream`; tell the user it needs an upstream fix |
| About the user, their preferences, or a project fact unrelated to any skill | Memory | The memory system (`~/.claude/projects/*/memory/`), not a skill |
| A repo-wide convention for one codebase | That repo's `CLAUDE.md` | Suggest it; use `claude-md-management` if asked |
| About how lessons-learned itself behaved | `lessons-learned` | Same workflow, skill = `lessons-learned` |
| A one-off, unverified, or obvious-from-docs fact | Nowhere | `ledger.py add … --status rejected:gate` |

## Attribution questions
- Did Claude follow the skill and still fail? → the skill is wrong (`fix`).
- Did the skill say nothing about this situation? → `pitfall` or `lesson`.
- Did Claude ignore what the skill said? → usually make the instruction more
  prominent (`fix`: move it up, make it a hard rule), not a new bullet.
- Was the failure in the environment (missing tool, wrong version)? → fix
  `skill-env.toml` / PEP 723 headers, not prose.
