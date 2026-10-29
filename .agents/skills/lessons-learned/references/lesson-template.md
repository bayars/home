# Formats

## Pitfall bullet (≤ 250 chars)
```markdown
- **<symptom or trigger>** → <why it fails> → <what to do instead> [LL-0007]
```
Example:
```markdown
- **`commit validate` passes but apply fails** → validate skips cross-device refs → run `fabric check` on the whole fabric first [LL-0007]
```

## Lesson bullet (≤ 200 chars)
```markdown
- Always <do X> / Never <do Y> — because <reason> [LL-0012]
```

## Fix
No bullet: rewrite the faulty instruction. The ledger entry (`--kind fix`)
keeps the evidence; the skill text stays clean.

## Ledger entry (written by `ledger.py add`)
```json
{"id":"LL-0007","skill":"fabric-builder","skill_dir":"/root/.claude/skills/fabric-builder",
 "kind":"pitfall","symptom":"apply fails after validate passes",
 "rule":"run fabric check first","evidence":"Error: ref leaf2/irb0 not found",
 "status":"proposed","hits":0,"created":"2026-10-29","updated":"2026-10-29"}
```
Statuses: `proposed` → `applied` | `rejected` | `rejected:gate` | `upstream` | `retired` | `rolled-back`.

## Proposal shown to the user
```
LL-0007 · fabric-builder · pitfall
Evidence: <error text / correction quote>
Verified by: <command or check that passed>
--- a/SKILL.md
+++ b/SKILL.md
@@ …
Lint: OK (0 errors, 1 warning)
```
