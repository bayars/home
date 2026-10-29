---
name: ui-design-review
description: Review and fix the UI/UX quality of React screens and components by actually looking at them. Takes Playwright screenshots of the running app across viewports, themes and states, runs automated accessibility, keyboard, layout and design-token checks, scans the source for design-system violations, then evaluates look and feel, usability, accessibility and compliance with the corporate UI design rules and component library, and fixes what it finds. Use this skill whenever you build, change or restyle any React UI (a page, form, table, dialog, component, layout or CSS), before calling UI work done, and whenever the user asks to review, audit, critique, polish, QA or check a screen, a design, the "look and feel", usability, accessibility/WCAG/a11y, responsiveness, consistency, or adherence to the design system, brand or corporate UI guidelines — even if they do not say "design review".
---

# UI design review

You cannot judge an interface from JSX. A component can be perfectly reasonable
code and still render as a cramped, misaligned, low-contrast screen that
ignores the company's design system. This skill gives you eyes: it renders the
real UI, measures what a script can measure, and then asks you to look at the
screenshots and judge the rest the way a senior product designer would, against
the corporate rules.

The work has two halves, and both are required:

- **Measured** (scripts): contrast, missing labels, keyboard reachability,
  focus indicators, tap-target size, clipped text, horizontal scroll, whether
  each action gets visible feedback, whether the layout survives larger text,
  "you are here" marking, vague or leftover wording, off-token colors/sizes,
  raw HTML where a corporate component exists.
- **Judged** (you, looking at screenshots): whether the screen is obvious at a
  glance, hierarchy, whether each step of the task can be worked out and
  confirmed, how errors are handled, consistency, and whether it follows the
  corporate rules and feels like the rest of the product.

Automated checks catch only a minority of real UX and accessibility problems. A
clean script run is not a pass; it means the measurable floor is met. And the
whole review is an expert inspection, not a test with users — it finds
violations of known principles, not what only a confused newcomer reveals.

`SKILL_DIR` below means the folder that contains this file.

## Step 0 — One-time setup

**Dependencies.** If `SKILL_DIR/scripts/node_modules` is missing:

```bash
npm install --prefix "SKILL_DIR/scripts"
npx --prefix "SKILL_DIR/scripts" playwright install chromium
```

If the browser download is blocked (common on corporate networks), skip the
second command and pass `--channel msedge` or `--channel chrome` to
`capture.mjs` to use the installed browser. If the project already depends on
Playwright, the scripts pick that up; only `axe-core` is then needed. More in
`references/troubleshooting.md`.

**Corporate design rules.** Read `SKILL_DIR/design-system/RULES.md`,
`tokens.json` and `components.json`. If any still carries its template marker
(first-line `TEMPLATE` comment / `"_template": true`), the corporate rules have
not been captured yet:

1. Look for the real sources: the component package in `package.json`
   (and its docs/README/tokens in `node_modules`), token files (CSS variables,
   theme objects, Tailwind config, Style Dictionary), Storybook, design docs in
   the repo, and existing `.cursor/rules`.
2. Draft the three files from what you find (`scripts/extract-tokens.mjs`
   bootstraps `tokens.json` from CSS custom properties). Record only rules you
   can point to a source for; mark gaps as open questions instead of inventing
   corporate policy.
3. Show the user the draft and the open questions, and remove the template
   markers once they confirm.

If the user wants a review right now and the rules are not set up, do the
review against the generic rubric and say prominently in the report that
corporate compliance was **not** assessed and why. Do not present generic
best practice as if it were the company's rule.

## Step 1 — Decide what to look at

**Write the purpose brief first.** A screen can only be judged against what it
is for. In three or four lines, from the ticket, spec, PRD, route name and
surrounding code:

- Who uses this screen, and how often (first-timer, occasional, all-day expert)?
- What are they trying to get done here — the one primary task, then up to two
  secondary ones?
- What must the screen contain and do for that (the requirements, if written)?
- What would they do next?

If this cannot be established, ask the user; if they are not available, state
your assumption at the top of the report. Do not skip this: without it there is
no way to tell an important element from a distracting one, or a missing
feature from an extra one.

Then work out the smallest set of views that shows the UI in question:

- **What changed or what was asked about** — the files in the diff, or the
  screen the user named.
- **Where it renders** — a route in the running app, or a Storybook story
  (`http://localhost:6006/iframe.html?id=<story-id>&viewMode=story`) for an
  isolated component. Prefer Storybook for single components when it exists;
  use the real route for anything where layout context matters.
- **Which states matter** — most design defects hide outside the happy path.
  For the views in scope, plan to capture whichever of these exist: default
  with realistic data, empty, loading, error/validation, long content
  (long names, big numbers, many rows), open overlays (dialog, menu, drawer),
  disabled/read-only.
- **The primary task as a sequence** — define states that step through the
  task from the brief (open the form → submit it empty → fill it → submit).
  Each `click`/`press` in a state is also measured for feedback, so the
  capture doubles as evidence for the task walkthrough in Step 4.

Make sure the app is running. Check for an already-running dev server before
starting one (look at `package.json` scripts for the command and port); if you
start it, run it in the background and leave it running for the fix loop.
`capture.mjs` waits up to 60 s for the URL to answer. For pages behind login,
use a saved session (`--storage-state`, see troubleshooting) or mock mode.

## Step 2 — Capture and measure

Single view:

```bash
node "SKILL_DIR/scripts/capture.mjs" --url http://localhost:5173/orders --name orders
```

Several views, states that need interaction, dark theme: write a config (copy
`SKILL_DIR/design-review.config.example.json` to the project root as
`design-review.config.json`, keep it for re-runs) and run:

```bash
node "SKILL_DIR/scripts/capture.mjs" --config design-review.config.json
```

States are reached with small action lists (`click`, `fill`, `hover`, `focus`,
`press`, `select`, `scroll`, `waitFor`, `wait`) using Playwright selectors.
On the desktop viewport each `click`/`press` is timed for visible feedback, and
each state is re-rendered with user text spacing and with the browser's default
font size doubled.
Defaults: viewports `mobile,tablet,desktop`, theme `light`. Add
`--viewports all` to include 1920 wide and the 320 px reflow check, and
`--themes light,dark` when the product supports dark mode.
`node capture.mjs --help` lists every option.

Then scan the source of the UI in scope (design-system violations a screenshot
cannot show):

```bash
node "SKILL_DIR/scripts/scan-source.mjs" src/features/orders      # or: --changed
```

Output lands in `.design-review/latest/` (add `.design-review/` to
`.gitignore`): `SUMMARY.md`, `SOURCE-SCAN.md`, `report.json`,
`source-scan.json`, and `shots/*.png`.

## Step 3 — Look

1. **First glance, before anything else.** Open the default-state
   `*__fold.png` for desktop and for mobile and, before reading any findings,
   write down: what is this page; what can I do here; where do I start; what
   are the areas of the page for. Then list every "question mark" — each place
   a newcomer would hesitate. You know the code, which makes you a poor judge
   of what is obvious: answer only from what the pixels literally say, and
   compare with the purpose brief. This note goes in the report unedited.
2. Read `SUMMARY.md` and `SOURCE-SCAN.md`. Check the "Checks run" line and the
   notes: if tokens or axe were skipped, say so in the report. The
   "Wayfinding", "Feedback after actions" and "Load behaviour" blocks are
   inputs for Step 4.
3. **Open every screenshot listed in `SUMMARY.md`** with your file-reading
   tool and actually study it. `*__fold.png` is the first screen; `*__full-NN`
   are tiles down the page; `*__focus-order.png` shows the numbered tab order
   with a box per stop (red = no focus indicator, amber = weak, green = ok);
   `*__large-text.png` is the view with the default font size doubled;
   `*__text-spacing.png` exists only when wider text spacing broke something.
4. If a capture failed or shows an error overlay/blank page, fix that first
   (wrong URL, missing `waitFor`, app error) and re-run; do not review a broken
   render.

If you cannot view images in this session, say so plainly and deliver only the
measured half, labelled as partial. Never describe or score visual qualities
of a screenshot you have not seen.

## Step 4 — Evaluate

Read `references/principles.md` (how to think) and `references/rubric.md`
(what to check), then work in this order, with `design-system/RULES.md` open
beside you.

**a. Walk the primary task.** For each step of the task in the purpose brief,
answer the seven questions a user has, from the screenshots of that step:

| Before acting | After acting |
|---|---|
| Can I see what my options are? | Did something visibly happen, at once? |
| Is it clear which control does what I want (signifier, label)? | Does it tell me *what* happened, in my terms? |
| Is the control where I would look, next to what it affects? | Can I tell whether I am done, and what is next? |
| Is the wrong action prevented or hard? | If it went wrong: do I know why, and how to fix it without losing work? |

Record it as a short table (step → where it breaks → finding). A step you
cannot answer from the screenshots is either a finding or a state to capture.

**b. Score the dimensions** in `rubric.md`:

1. Corporate design-system compliance
2. Purpose and first glance
3. Visual hierarchy and layout
4. Typography, color and scannable text
5. Navigation and wayfinding
6. Interaction: discoverability, mapping, feedback, constraints
7. Errors and recovery
8. Content and microcopy
9. Consistency and conventions
10. Responsiveness and touch
11. Accessibility (measured results plus `references/accessibility.md`)
12. Respect for the user

**c. Place each finding on a plane** — surface, skeleton, structure, scope or
strategy (`principles.md`, lens 5). Look for the lowest plane the problem
really lives on: a cramped form may be a spacing problem (surface), a layout
problem (skeleton), or twelve fields that should be four (scope).

How to treat what you find:

- **Corporate rules outrank generic heuristics.** If `RULES.md` says buttons
  are left-aligned in forms, that is correct here even if you would do
  otherwise. Cite the rule ID.
- **A rule too vague to fail cannot be scored.** If a corporate rule cannot be
  checked ("keep it clean"), do not pass or fail the screen on it; list it
  under Questions as a rule that needs sharpening.
- **Accessibility is the exception.** If a corporate rule produces an
  accessibility failure (say, a brand color that fails contrast as text), do
  not quietly pick a side: report the conflict, propose the closest compliant
  option, and let the user take it to the design-system owners.
- **Verify automated findings before repeating them.** Each has an element,
  its React component chain and the viewports it was seen in — find it on the
  screenshot. Drop false positives with a one-line reason rather than padding
  the report (for example a deliberate ellipsis with a tooltip, or an upward
  focus jump between two columns).
- **Trace problems to their cause.** Ten off-token paddings usually mean one
  hand-rolled layout that should have been the corporate `Stack`/`Card`.
  Report the cause once, not ten symptoms.
- **Defects inside the corporate components themselves** (a library button
  that fails contrast) are not yours to patch locally. Report them as
  "upstream" so the user can raise them with the design-system team.
- **Complexity is not a defect; confusion is.** Do not mark a dense expert
  screen down for being dense. Mark it down if it lacks structure a user could
  learn.
- **Clarity outranks consistency.** If following a pattern makes this screen
  harder to understand, raise it as a question for the design-system owners;
  neither hide the confusion nor quietly break the pattern.
- **Scope cuts both ways.** Something the brief requires but the screen lacks
  is a finding. So is something on the screen the brief never asked for —
  including anything you added yourself while building it.
- **No criticism without an alternative.** Every finding carries a concrete
  better option. Assume the current design had a reason; where a constraint
  you cannot see may explain it, phrase the finding as a question.
- **Be specific and visual.** "Spacing feels off" is useless. "Card padding is
  17 px but the gap between cards is 16 px and the form inside uses 10 px —
  three unrelated values; rule LAY-2 says 16 inside cards, 24 between
  sections" can be fixed.

Severity, used consistently:

| Severity | Meaning |
|---|---|
| Critical | Blocks a task or a group of users: unusable control, keyboard trap, unreadable text, broken layout, data loss risk |
| Major | Clear violation of a corporate rule or WCAG AA, or a real usability problem most users will hit |
| Minor | Polish: small inconsistency, slightly off spacing, weak but present affordance |
| Info | Observation or question; needs a human decision |

## Step 5 — Report

Use the structure in `references/report-template.md`: verdict, purpose brief,
first-glance note, task walkthrough, scores per dimension, findings ordered by
severity (each with evidence, plane, the rule or principle it breaks, and the
concrete fix), what was not checked. Always state that no users were observed
and recommend a quick test with three people from outside the team — it is the
one thing that would find what this review cannot. Keep it in
the chat unless the user asks for a file; then write
`.design-review/latest/REVIEW.md`.

## Step 6 — Fix and verify

If the user asked for a review only, stop at the report and offer to fix.
If you are reviewing UI you just built or changed, or the user asked you to
fix things, carry on:

1. Fix critical and major findings first, then minor ones that are cheap.
   Leave `Info` items and anything needing a product/design decision as
   questions.
   - **Surface and skeleton** findings within the corporate rules: fix them.
   - **Structure** findings (flows, states, organisation, naming): propose the
     change and get agreement before restructuring, unless you were asked to
     build that flow.
   - **Scope and strategy** findings: never resolve these yourself by adding
     or deleting features. Report them to the user as questions.
   - Start from the lowest plane. Polishing a screen whose structure is wrong
     wastes the polish.
2. Fix at the source, using the system: swap raw elements for corporate
   components, replace literals with tokens, use documented props/variants.
   Overriding a corporate component's styles to make a number match is a new
   violation, not a fix.
3. Re-run the **same** capture and scan commands. `SUMMARY.md` compares
   against the previous run (resolved vs. new) — new findings are regressions
   you introduced; deal with them.
4. Open the new screenshots and confirm the change looks right and nothing
   nearby broke. A finding is closed when the screenshot shows it is, not when
   the code was edited.
5. Repeat up to three rounds. If something still fails, stop and report what
   remains and why, instead of looping.

Never make findings disappear by editing `design-system/*`, adding
`ignoreSelectors`, lowering thresholds, hiding elements, or using `aria-hidden`
/ `eslint-disable` style suppressions. Those files change only when the
corporate rules themselves change, and the user decides that.

Finish with: what you fixed (before → after counts), what is left and who needs
to decide, and anything upstream for the design-system team.

## Reference files

- `references/principles.md` — the reasoning: how people use screens, the seven questions, error design, the five planes, goodwill. Read before evaluating.
- `references/rubric.md` — what to look for in each of the twelve dimensions, with the finding IDs that feed it.
- `references/accessibility.md` — manual accessibility checks beyond the automated audit, and how to read the tool output.
- `references/report-template.md` — the report format.
- `references/troubleshooting.md` — install problems, auth, Storybook, Next.js, monorepos, flaky captures, false positives.
- `design-system/README.md` — how the corporate rules files work.
