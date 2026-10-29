# Consolidation

Run when a draft hits a cap (LS001, PF001, PF004, SZ002) or on `consolidate <skill>`.
The result is **one** diff, proposed for approval like any other edit.

Apply in order until the skill is within budget:

1. **Merge** bullets with the same root cause into one, keeping the strongest
   wording. Merge their ledger entries: keep the oldest id, add the hits up,
   mark the others `retired` with a note pointing at the survivor.
2. **Promote** recurring entries (`hits ≥ 3`) into the workflow text so the
   trap disappears (a step, a hard rule, a better command), then delete the
   bullet and mark it `retired` ("promoted into workflow").
3. **Retire** stale entries: `applied`, `hits = 0`, older than 90 days
   (`ledger.py status` lists them).
4. **Move** detailed but still useful *lessons* to `references/lessons.md`.
   Pitfalls may move to `references/pitfalls.md` only while that file stays
   at 10 or fewer — the cap is 20 pitfalls per skill in total.

If the skill is still over budget after all four, it is doing too much:
propose splitting it into two skills instead of adding anything.

Get the data with:

```bash
uv run --script ~/.claude/skills/lessons-learned/scripts/ledger.py list --skill <name>
```
