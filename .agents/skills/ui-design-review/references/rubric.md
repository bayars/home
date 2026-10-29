# Evaluation rubric

Score each dimension 0–4 from the screenshots and measured results.

| Score | Meaning |
|---|---|
| 4 | Exemplary — nothing to fix |
| 3 | Solid — minor polish only |
| 2 | Acceptable — several minor or one major issue |
| 1 | Weak — multiple major issues |
| 0 | Failing — critical issues, or the dimension was ignored |

Score what is on the screenshots, not what the code intends. If a dimension
could not be assessed (no dark theme captured, corporate rules not set up, a
single component with no navigation), write "not assessed" or "n/a" instead of
a number.

Where a line below conflicts with `design-system/RULES.md`, the corporate rule
wins (see SKILL.md for the accessibility exception). The reasoning behind the
checks is in `principles.md`; names in `code style` are finding IDs you will
see in `SUMMARY.md` / `SOURCE-SCAN.md`.

## Contents

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
11. Accessibility
12. Respect for the user
13. Common patterns: forms, tables, dialogs, dashboards

---

## 1. Corporate design-system compliance

The question: does this look and behave like it was built *with* the company's
system, or beside it?

- **Components** — anything the corporate library provides is used from the
  library: buttons, inputs, selects, tables, dialogs, tabs, toasts, icons.
  `SOURCE-SCAN.md` lists raw elements and banned imports; on the screenshot,
  look for controls that are "almost" the corporate one (slightly different
  height, radius, font, hover) — that is a hand-rolled copy.
- **Variants used as intended** — primary/secondary/destructive hierarchy,
  sizes, density follow the rules (`CMP-*`), not ad-hoc choices.
- **Tokens** — colors, type, spacing, radii, shadows come from tokens. Use the
  `off-token-*` findings and the "Rendered style inventory": a long tail of
  one-off values (13 px, 17 px, #e3e3e3) signals hard-coded styling.
- **No overrides** — corporate components are not restyled through `style`,
  `!important`, deep selectors or wrapper hacks.
- **Brand** — logo usage, brand color reserved for its intended purpose,
  correct typeface actually loaded (a `font-failed-to-load` finding or a
  visibly different fallback face is a brand defect).
- **Approved exceptions** — check the "intentional" list in `RULES.md` before
  flagging.

Cite the rule ID for every compliance finding. If you believe something
violates the spirit of the system but no written rule covers it, say exactly
that and suggest adding a rule.

## 2. Purpose and first glance

The question: would a hurried stranger know what this is and what to do, in
the time they will actually give it? (Principles: lens 1.)

Use the purpose brief from Step 1 as the yardstick.

- **Self-evident purpose.** From the fold screenshot alone it is clear what
  this page is and what it is for. If a welcome paragraph is needed to explain
  it, the layout is not doing its job.
- **Obvious starting point.** The primary task named in the brief has one
  visible, unmistakable entry point. If the brief says "create an order" and
  the eye lands on a chart, that is a major finding.
- **The top tasks are easy.** The two or three things most users come to do
  are reachable without hunting. Rarely used options do not sit at the same
  volume as the main ones.
- **No question marks.** List each hesitation: unclear names, things that may
  or may not be clickable, choices the user cannot answer, near-duplicate
  options, anything needing prior knowledge. Each is a finding or a deliberate
  trade-off someone should confirm.
- **Fits the scope.** Everything the brief requires is present, and nothing
  substantial is present that the brief does not call for. Extras are raised
  as scope questions, not silently kept or removed.
- **Complexity matches the task.** A demanding professional task may need a
  dense screen; judge whether it has structure (see 3), not whether it is
  simple.

## 3. Visual hierarchy and layout

- **One clear focal point per view.** Squint at the fold screenshot: what
  stands out first? It should be the page's purpose or primary action. Several
  elements competing (multiple filled buttons, many bold blocks, saturated
  colors everywhere) means no hierarchy.
- **Primary action is obvious and singular**; secondary actions are visibly
  quieter; destructive actions are distinct and not adjacent-by-accident.
- **Grouping by proximity.** Related things sit together, unrelated things are
  separated by more space than the space inside groups. Labels sit closer to
  their own field than to the previous one.
- **Alignment.** Shared left edges, consistent column starts, baselines of
  adjacent text aligned, icons optically centred with their labels. Look for
  1–3 px misalignments between neighbours — they read as carelessness.
- **Spacing rhythm.** A small set of spacing steps is repeated. Uneven gaps
  between sibling elements, or padding inside a card that differs from its
  neighbours, are defects.
- **Density fits the job.** Data-heavy tools can be dense but still need
  breathing room around groups; marketing-style whitespace in an operations
  screen wastes the fold.
- **The fold.** The first screen shows what the page is for and its main
  action without scrolling, on mobile too.
- **Nesting shows containment.** What belongs to what is visible: a section
  title spans exactly the things in that section, a card's title belongs to
  the card. A heading that visually covers things it does not own misleads.
- **Clearly defined areas.** A viewer can point at regions and name their job
  ("navigation", "filters", "the list", "actions on the selection"), so they
  can decide at once which to ignore.
- **Noise.** Check for the three kinds — *shouting* (everything emphasised),
  *disorganisation* (things placed without a grid), *clutter* (too much).
  For each element ask what would be lost if it were removed.
- **Balance and containers.** Content does not hug one edge of a wide screen
  with a vast empty area beside it; boxes are not nested three deep; borders,
  shadows and background fills are not all used at once for the same job.

## 4. Typography, color and scannable text

- **Type scale.** Few sizes, clearly different roles (title, section, body,
  caption). Sizes that differ by 1–2 px without a reason are noise.
- **Readability.** Body text ≥ the corporate minimum (commonly 14–16 px),
  line length roughly 45–90 characters, comfortable line height, no long
  passages in all caps, centred or justified text.
- **Never small *and* low-contrast.** Either alone is a risk; together it is a
  defect (`small-text` plus a contrast finding on the same element).
- **Text is formatted for scanning.** Headings are frequent and meaningful;
  levels are unmistakably different; each heading sits closer to its own
  section than to the previous one (`floating-heading`). Paragraphs are short
  (`wall-of-text`); a series becomes a list; a few key terms are highlighted —
  not many.
- **Weight and emphasis.** Emphasis is used sparingly; not everything is bold.
- **Truncation.** Clipped or ellipsised text loses information — check
  `text-clipped` / `text-truncated` findings and whether the full value is
  reachable.
- **Numbers** in tables are right-aligned with consistent decimals; tabular
  figures where the font has them.
- **Color has meaning and is consistent.** One accent for interactive
  elements; status colors only for status; the same color never means two
  things. Grey text is still readable (check contrast findings).
- **Color is never the only signal** — errors have an icon/text, chart series
  have labels, links in text are distinguishable without hue alone.
- **Dark theme** (if captured): no pure-white blocks left behind, borders and
  dividers still visible, images/logos adapted, contrast still passing.

## 5. Navigation and wayfinding

The question: dropped onto this page from a link, could someone get their
bearings? (Principles: lens 2. Use the "Wayfinding" block in `SUMMARY.md`.)
Score "n/a" for an isolated component or a Storybook story.

- **Product identity** is visible and where convention puts it, and it leads
  home.
- **Every page has a name** — prominent, framing the content unique to this
  page, and matching the words on the link or menu item that led here
  (`page-name-mismatch`). The browser tab names the page too
  (`title-heading-mismatch`, `default-document-title`).
- **Sections are visible and stable**: the same navigation, in the same place,
  working the same way on every page. Utilities (account, help, settings) are
  present but quieter than the sections.
- **"You are here" is marked, and not subtly** — in every level of navigation
  shown, using more than a faint tint (`no-current-location`,
  `current-location-not-visible`, `current-location-not-exposed`).
- **Local navigation gets the same care as global.** Second- and third-level
  pages are not improvised; tabs look like tabs with the active one clearly
  in front; breadcrumbs where the hierarchy is deep, at the top, with the
  current page last and not a link.
- **Search**, where the product has enough content to need it, is a box with
  a recognisable label or icon, with no instructions and no options up front.
- **Labels have scent.** Each navigation label and link says plainly what is
  behind it (`vague-link-text`); no two labels could mean the same thing; names
  are the user's words, not internal or marketing names.
- **There is always a way back** and a way to start over; focused flows
  (checkout, wizards) may reduce navigation but still show where the user is
  in the flow and how to leave it.

## 6. Interaction: discoverability, mapping, feedback, constraints

The question: at each step of the task, can the user tell what to do and what
happened? (Principles: lens 3. Record the task walkthrough from SKILL.md
Step 4 here.)

- **Discoverability.** Everything the user can do is perceivable without
  hovering, guessing or knowing a gesture. Clickable things look clickable and
  nothing else does (`weak-signifier`, `clickable-not-focusable`). Nothing
  essential appears only on hover (`hover-only-reveal`) — touch has no hover.
- **Signifiers survive the styling.** Borderless inputs, text-only buttons and
  icon-only actions still read as controls; icons without labels are limited
  to the truly universal ones.
- **Mapping.** Controls sit next to what they affect and behave the way their
  form suggests; the layout of controls mirrors the layout or order of the
  things controlled. Controls are grouped by what the user is trying to do,
  not by how the system stores it.
- **Knowledge in the world.** What the user needs at this step is on screen at
  this step: persistent labels (`placeholder-as-label`), units, formats and
  examples, the name of the thing being acted on, earlier choices still
  visible. Nothing must be remembered from a previous screen.
- **Feedback is immediate and informative.** Every action produces a visible
  response at once (`no-feedback-after-action`, `slow-feedback`; see "Feedback
  after actions" in `SUMMARY.md`): pressed and busy states, progress for long
  operations, a clear result. The feedback says *what* happened, appears where
  the user is looking, and is not so frequent that it gets ignored (stacked
  toasts, alerts for routine events).
- **System state is visible.** Current selection, mode, filter, sort, sync or
  save status can be read off the screen. If a control changes meaning by
  mode, the mode is unmistakable.
- **States are designed.** Empty (says what belongs here and how to add it),
  loading, error, partial, no-permission, very long content. A missing state
  that users will meet is a major finding on the scope plane.
- **Constraints guide.** Impossible actions are disabled or absent — and a
  disabled control says why. Pickers and sensible defaults replace free text
  where the set of answers is known. Order is enforced where it matters.
- **A coherent model.** Names, structure and states add up to one story of how
  this works. Watch for the same thing under two names, two things under one
  name, and controls whose effect cannot be predicted from the screen.
- **Efficiency.** The common path is short and each step is an easy choice;
  expert shortcuts exist where the task is repetitive; targets are large
  enough (`target-size`, `touch-target-small`).
- **Stability.** Content does not jump while loading (`layout-shift`).

## 7. Errors and recovery

The question: when something goes wrong — and it will — does the design help?
(Principles: lens 4.)

- **Prevention.** Look-alike controls with different consequences are made
  distinct and kept apart (`destructive-not-distinct`). Inputs accept what
  people naturally type — spaces, dashes, any case — and normalise it
  (`strict-input-format`, `paste-blocked`). Implausible values are questioned.
- **Reversible beats confirmed.** Destructive or far-reaching actions can be
  undone; where they cannot, they are harder to trigger. Confirmation dialogs
  name the action and the object and label buttons with the action
  (`generic-dialog-button`, `native-dialog`) — not "Are you sure? Yes/No".
- **Errors are visible where they happen.** Inline, next to the field, plus a
  summary on long forms; not only color; focus moves to the first problem.
- **Messages help.** They say what happened in the user's words and what to do
  next, never blame, and never expose internals (`technical-error-shown`,
  `raw-error-rendered`, `debug-value-shown`).
- **Nothing is lost.** Input survives validation failures, navigation away and
  session expiry; leaving with unsaved work is caught.
- **Interruptions are survivable.** Multi-step tasks show progress and can be
  resumed; drafts are kept.
- **Automation is honest.** Autosave, sync and background work show their
  status and announce failure.

## 8. Content and microcopy

- **Needless words are gone.** No welcome text or self-congratulation that
  conveys nothing; no instructions where the design could be self-explanatory.
  Where instructions are truly needed they are a line, not a paragraph. Try
  cutting each block in half and see what is lost.
- **Content was written, not left over.** Every message, empty state and help
  text reads as deliberate (`placeholder-content`, `untranslated-key`,
  `debug-value-shown`). Missing copy is a scope finding: someone has to own it.
- **Formats serve a purpose.** A "Help" or "FAQ" block answers questions users
  really ask, at the point they arise.
- **Front-loaded.** The distinguishing words come first in headings, links and
  buttons — scanners and screen-reader users hear only the beginning.
- Page title and headings say what the page is; headings form a sensible
  outline (see "Heading outline" in `SUMMARY.md`).
- Buttons are verbs describing the outcome ("Create order", not "OK"/"Submit").
- Labels are short nouns; help text answers the question a user would ask.
- Error messages are specific, blame-free, and actionable.
- No placeholder text, lorem ipsum, "TODO", raw keys (`orders.title`),
  `undefined`/`NaN`/`null`, or developer wording shipped to users.
- Tone, capitalisation and terminology follow the corporate content rules
  (`TXT-*`).
- Text survives translation: no text baked into images, room for ~30–40 %
  expansion in buttons and labels, no sentence built by concatenation.

## 9. Consistency and conventions

Compare across the captured views, and against the rest of the product where
you know it:

- The same thing looks and behaves the same everywhere: button heights, input
  heights, icon sizes and style, card style, heading style, link style.
- The same action has the same label and position on every screen
  ("Save" is not "Submit" next door; Cancel is not sometimes left, sometimes
  right).
- Terminology, capitalisation, date/number formats are uniform.
- Icon family is one family; no mixed outline/filled styles.
- Component states (hover, focus, selected, disabled) follow one convention.
- **Conventions are used.** Standard patterns appear where users expect them
  and behave the standard way. A custom replacement for a familiar control
  must be as obvious as the original or clearly worth learning.
- **Clarity outranks consistency.** If applying a pattern exactly makes this
  screen less clear, report the tension as a question rather than defending
  the inconsistency or the confusion.

## 10. Responsiveness and touch

Compare the same view across the captured viewports.

- No horizontal page scroll at any width (`horizontal-scroll`); at 320 px
  (`reflow` viewport) content still works in one column.
- Layout adapts rather than shrinks: columns stack, navigation collapses to an
  appropriate pattern, tables become scrollable regions/cards per corporate
  rule, dialogs become full-screen sheets if the system says so.
- Priority is preserved: the primary action and key content stay near the top
  on mobile, not pushed below decorative content.
- Text does not overflow or get clipped; images scale without distortion.
- Touch targets are comfortable on touch viewports; hover-only interactions
  have a touch equivalent.
- **No dependence on hover.** Tooltips, row actions and menus that appear on
  hover have a visible or tap-reachable equivalent.
- **Everything is still there.** The small-screen version prioritises; it does
  not drop features people expect. What is deeper is reachable by an obvious
  path.
- **Affordances are not sacrificed for space.** Shrinking the layout does not
  strip the cues that show what is tappable.
- **Zoom is allowed** (`zoom-disabled`) and input types bring up the right
  keyboard (`wrong-input-type`).
- **It feels fast.** Nothing heavy loads before the content the user came for;
  see "Load behaviour" in `SUMMARY.md`.
- Wide screens: content has a max width or uses the space purposefully; line
  lengths stay readable.

## 11. Accessibility

Start from the measured results (axe, keyboard walk, layout checks), then do
the manual checks in `references/accessibility.md`. For scoring:

- Start with clarity: a screen that confuses everyone is not accessible
  however clean its markup. Low scores in 2, 5, 6 or 7 pull this one down.
- Any critical/serious axe violation, keyboard trap, unreachable control or
  invisible focus on a core control caps this dimension at 1.
- Text must survive the user's own settings: `text-spacing-breaks`,
  `breaks-at-large-text`, `text-ignores-user-font-size`, and the `reflow`
  viewport. Open the `*__large-text.png` screenshot.
- Passing automated checks earns at most a 3; a 4 needs the manual checks
  (names make sense, focus order is logical, states are announced, zoom works)
  to hold up too.

## 12. Respect for the user

The question: does this screen behave like it is on the user's side?
(Principles: lens 6.)

- **Nothing they came for is hidden**: prices, fees, limits, contact routes,
  the status of the thing they are waiting on.
- **Only necessary questions are asked** (`long-form`); optional fields are
  marked or removed; nothing is requested "in case".
- **The system does the work**: formats are normalised, known data is
  prefilled, steps are saved, links carry their parameters.
- **Bad news is stated plainly and early**; when something cannot be done, the
  screen says so and offers the next best route.
- **No manipulation**: no pre-ticked consents, disguised ads, guilt-worded
  opt-outs, or obstacles placed in front of cancelling.
- **It looks cared for.** Alignment, finish and working details signal
  competence; sloppiness costs trust before any task begins.

## 13. Common patterns — quick checks

**Forms**
- Visible label for every field, placed per corporate rule; required/optional
  marked consistently; related fields grouped; one column unless fields are
  naturally paired.
- Field width hints at expected length; correct input types; sensible defaults.
- Errors: inline, next to the field, plus a summary for long forms; focus moves
  to the first error.
- Primary button states the outcome; its position follows the corporate rule;
  disabled submit buttons explain why, or validation runs on submit instead.
- Every question is easy to answer: the user knows the answer, the options
  are distinguishable, and help sits beside the hard ones. Global navigation
  may be reduced so nothing competes with finishing the form.

**Tables and lists**
- Column headers are clear; numeric columns right-aligned; row height and
  density per corporate rule; long cells handled deliberately.
- Sorting/filter state is visible; empty and loading states exist; pagination
  or virtualisation is clear about where the user is.
- Row actions are discoverable without hover on touch devices.

**Dialogs and overlays**
- Title states the task; one primary action whose label names the action and
  object; dismiss by button and Esc; focus
  is trapped inside while open and returns to the trigger on close; page behind
  does not scroll; size per corporate rule and not overflowing small screens.

**Dashboards and data display**
- The most important number is the most prominent; each figure has a label,
  unit and time frame; charts have titles, labelled axes and a legend that does
  not rely on color alone; nothing is truncated (a clipped KPI is critical).
