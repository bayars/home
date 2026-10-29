# Report template

Keep the report tight: a reader should know in ten seconds whether the screen
is shippable and what to do next. Lead with the verdict. Group symptoms under
their cause. Leave out dimensions' prose when there is nothing to say — the
score line is enough.

```markdown
# UI design review — <screen / component>

**Verdict:** <Ship | Ship after fixes | Needs rework> — <one sentence why>
**Reviewed:** <pages and states> · <viewports> · <themes> · <date>
**Against:** <corporate rules source and version, or "generic rubric only — corporate rules not set up">

## Purpose brief
- **User:** <who, how often>
- **Primary task:** <…> · **Secondary:** <…>
- **Must contain / do:** <requirements, or "assumed: …">

## First glance
<What the fold screenshot says this page is, what can be done, where to start —
written before reading any findings. Then the question marks, as a list.>

## Task walkthrough — <primary task>

| Step | Can the user tell what to do? | Can the user tell what happened? | Finding |
|---|---|---|---|
| 1. <open the form> | <yes / no — why> | <yes / no — why> | <F-id or —> |

## Scores

| Dimension | Score (0–4) | Note |
|---|---|---|
| Design-system compliance | | |
| Purpose & first glance | | |
| Visual hierarchy & layout | | |
| Typography, color & scannable text | | |
| Navigation & wayfinding | | |
| Interaction (discoverability, mapping, feedback, constraints) | | |
| Errors & recovery | | |
| Content & microcopy | | |
| Consistency & conventions | | |
| Responsiveness & touch | | |
| Accessibility | | |
| Respect for the user | | |

Automated findings: <critical> critical · <major> major · <minor> minor
(after triage: <n> confirmed, <n> dismissed as false positives)

## What works
- <1–3 specific strengths worth keeping — skip if none>

## Findings

### Critical
#### F1 — <short title naming the problem>
- **Where:** <page/state, viewport(s)> · `<component>` in `<file:line>` · screenshot `<shots/...png>`
- **What:** <what is visibly or measurably wrong, with the numbers>
- **Plane:** <surface | skeleton | structure | scope | strategy>
- **Breaks:** <corporate rule ID and text, and/or WCAG criterion, and/or the principle — e.g. "no feedback after action", "description-similarity slip">
- **Why it matters:** <who is affected and how>
- **Better:** <the concrete alternative, in terms of corporate components/tokens>
- **Source:** <automated ID(s) e.g. A004, S012 | visual | walkthrough step 3>

### Major
…

### Minor
- F7 — <title> (<plane>): <one line what + fix> (`file:line`)

## Questions / decisions needed
- <structure, scope and strategy findings; conflicts between a corporate rule and accessibility or clarity; anything where an unseen constraint may explain the design>

## Upstream (design-system team)
- <defects found inside corporate components or tokens — not patched locally>

## Not checked
- **No users were observed.** This is an expert inspection. Recommended: watch three people from outside the team attempt "<primary task>" while thinking aloud; fix the worst problems; repeat.
- <states, viewports, themes, flows or checks that were out of scope or skipped, and why>
```

After a fix round, add:

```markdown
## Fix round <n>

| | Before | After |
|---|---|---|
| Critical | | |
| Major | | |
| Minor | | |

- **Fixed:** F1, F2, F4 — <one line each on what changed>
- **Regressions introduced and resolved:** <or "none">
- **Remaining:** F3 (needs design decision), F6 (upstream)
```

Writing notes:

- Evidence over adjectives: sizes, colors, ratios, the screenshot file, the
  rule ID. A finding with no evidence is an opinion.
- Findings must be falsifiable, like good requirements: someone can check
  whether the fix worked. "Feels cluttered" cannot be checked; "three filled
  buttons compete in the header; rule CMP-2 allows one primary per view" can.
- One finding per root cause. List the affected places inside it.
- Every finding has a fix someone could implement without asking what you
  meant.
- Do not pad. A screen with two real problems gets two findings.
