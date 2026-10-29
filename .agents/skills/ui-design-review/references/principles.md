# How to think about a screen

The rubric lists what to check. This file is the reasoning behind it, distilled
from three books the skill was reviewed against. Read it once per review; it
changes what you notice.

- Steve Krug, *Don't Make Me Think, Revisited* — how people actually use
  screens, and what makes one obvious.
- Don Norman, *The Design of Everyday Things* (revised edition) — how people
  act, why they err, and what a design must supply at each step.
- Jesse James Garrett, *The Elements of User Experience* (2nd edition) — the
  layers a product is built in, and why requirements must be checkable.
  (Only the front matter and the Scope chapter were available when this was
  written; the five-plane structure below comes from its contents listing.)

## Contents

1. Three facts about users
2. Lens 1 — First glance (Krug)
3. Lens 2 — The trunk test (Krug)
4. Lens 3 — Seven questions for every action (Norman)
5. Lens 4 — Design for error (Norman)
6. Lens 5 — Which plane is the problem on? (Garrett)
7. Lens 6 — Goodwill (Krug)
8. Judgment calls the books settle
9. What a review like this cannot do

---

## 1. Three facts about users

People do not use screens the way their builders imagine.

- **They scan, they don't read.** They are on a mission and look for the few
  words that match it. Most of the page is never looked at.
- **They take the first reasonable option**, not the best one. Guessing wrong
  usually costs a click, so weighing choices is not worth it to them.
- **They muddle through.** They rarely understand how the thing works and do
  not read instructions; they form a plausible story and stick with whatever
  worked once.

And when it goes wrong, they blame themselves, not the design. So a screen has
to work at a glance, for someone in a hurry who will not study it. You, having
read the code, are the least representative viewer there is: you know what
every control does. Judge only what the pixels say.

## 2. Lens 1 — First glance

Krug's first law: every question the screen puts in a user's head is a cost.
The screen should be self-evident; where that is impossible, self-explanatory
with a little reading.

Look at the fold screenshot for a few seconds, then answer without scrolling
or consulting the code:

1. What is this? (product, and this page within it)
2. What can I do here?
3. Where do I start? What is the main thing?
4. Why is it laid out this way — what are the areas of the page for?

Then list the **question marks**: every place a user would hesitate. Typical
sources — a clever, internal or technical name where a plain one exists;
something that might or might not be clickable; two options that seem to mean
the same thing; a choice the user cannot answer without knowing things they do
not know ("am I a 'member' or a 'subscriber'?"); a label that does not match
what they clicked to arrive.

Number of clicks matters less than how hard each click is. Several effortless,
unambiguous choices beat one that needs thought. When a hard choice is
unavoidable, give guidance that is brief, placed exactly where it is needed,
and impossible to miss.

Three ways a page gets noisy: **shouting** (everything is emphasised, so
nothing is), **disorganisation** (no grid, no alignment), **clutter** (too
much, low signal-to-noise). Treat every element as noise until it proves it
helps the task.

## 3. Lens 2 — The trunk test

Users often arrive in the middle of a product from a link, with no context.
Imagine being dropped on this page with blurred vision. Can you still find:

1. What site/product is this? (identity, top of page)
2. What page am I on? (a page name that frames the unique content, prominent,
   and matching the link that led here)
3. What are the major sections? (primary navigation)
4. What are my options at this level? (local navigation)
5. Where am I in the scheme of things? ("you are here" marking — and it must
   be obvious; designers reliably make it too subtle)
6. How can I search?

`SUMMARY.md` has a "Wayfinding" block with the raw material. Navigation is not
only for getting around: it tells people what the product contains, how to use
it, and whether its makers know what they are doing. Check that lower levels
get the same care as the top level; they are where users spend their time.
Forms mid-task are the legitimate exception — a pared-down frame keeps people
on the task.

## 4. Lens 3 — Seven questions for every action

Norman's action cycle: a person has a goal, plans, specifies, performs; then
perceives the result, interprets it, compares it with the goal. Two gulfs sit
in the way — **execution** (how do I work this?) and **evaluation** (what
happened? did it work?). At every step the user must be able to answer:

| # | The user's question | The design must supply |
|---|---|---|
| 1 | What do I want to accomplish? | A screen that matches a real task |
| 2 | What are my options? | Visible alternatives (discoverability) |
| 3 | What can I do now? | Signifiers; constraints that rule out the rest |
| 4 | How do I do it? | Natural mapping between control and effect |
| 5 | What happened? | Feedback — immediate |
| 6 | What does it mean? | Feedback that is informative, in the user's terms |
| 7 | Is this okay? Am I done? | A visible end state; a coherent conceptual model |

Walk the screen's primary task through this table (SKILL.md, Step 4). The
vocabulary, in screen terms:

- **Signifier** — the perceivable cue that says "act here, like this": button
  shape, underline, field border, drag handle, chevron. An ability with no
  signifier does not exist for the user. Flat, borderless styling and
  hover-only reveals remove signifiers; touch has no hover at all.
- **Mapping** — a control sits with, and moves like, the thing it affects.
  Filters next to the list they filter; a toggle whose position shows the
  state; steps laid out in the order they happen. Group controls by the
  user's **activity**, not by the system's internals or data tables.
- **Constraint** — make the wrong action impossible or unlikely: disable what
  cannot apply (and say why), offer a picker instead of free text, enforce
  order when order matters (*interlock*), stop people leaving with unsaved
  work (*lock-in*), put a deliberate obstacle before the dangerous
  (*lockout*).
- **Feedback** — must be immediate (around a tenth of a second is already
  noticeable), must say what happened rather than merely that something did,
  and must appear where the user is looking. Too much feedback is as bad as
  too little: stacked toasts and constant alerts get tuned out, and then the
  important one is missed.
- **Conceptual model** — the user's simplified story of how this works, built
  only from what the interface shows. If the screen's structure, names and
  states do not add up to one coherent story, people form a wrong one and
  every later step goes astray.
- **Knowledge in the world vs. in the head** — whatever the user needs at this
  step should be on screen at this step: labels that persist, units and
  formats shown, the thing being edited named, earlier answers visible. Do not
  make people carry information from one screen to another. The cost is
  clutter; resolving that trade-off is the designer's job, and hiding needed
  information is not a resolution.

## 5. Lens 4 — Design for error

There is no "user error", only designs that did not anticipate people. Assume
every possible mishap will happen.

Two kinds of error need different defences:

- **Slips** — right intention, wrong action. Experts make them, on autopilot.
  - *Capture*: a frequent routine takes over a rare one that starts the same
    way → make the rare path look different from its first step.
  - *Description similarity*: acting on the wrong one of several look-alikes →
    make different actions look different and keep the dangerous one apart.
  - *Mode error*: the same control means different things in different states
    → avoid modes, or make the current mode unmistakable.
  - *Memory lapse*: a step forgotten, often after an interruption → show
    progress and remaining steps; keep state so a task can be resumed.
- **Mistakes** — wrong goal or plan, usually from unclear state or a wrong
  conceptual model. Novices make them. Defence: better information before the
  action, not a warning after it.

What good error design looks like:

- **Prevent** with constraints and sensible checks ("this amount is 1,000× your
  usual — did you mean it?").
- **Undo beats "Are you sure?"** People confirm on reflex, because by the time
  the dialog appears they are sure. Where confirmation is used, show the action
  *and the object* prominently, and label the buttons with the action — never
  Yes/No/OK.
- **Treat input as an approximation of what was meant** and help complete it:
  accept the phone number with or without spaces; fix what can be fixed.
- **Make errors easy to see and to repair**: say what happened in the user's
  language, where it happened, and what to do; keep everything they typed.
- **Never scold.** The message is the product explaining itself, not the user
  being corrected.
- **Survive interruption**: drafts, saved progress, a clear "you were here".
- When the system acts on its own (autosave, sync, background jobs), **show
  what it is doing and when it stops working** — silent automation fails
  silently.

## 6. Lens 5 — Which plane is the problem on?

Garrett's model: a product is built in five planes, each resting on the one
below. A decision on a lower plane constrains everything above it.

| Plane | What is decided there | Example of a problem on this plane |
|---|---|---|
| **Surface** | Sensory design: color, type, imagery, polish | Low contrast; inconsistent radii |
| **Skeleton** | Interface, navigation and information design: which controls, where, in what arrangement | Primary action buried; label far from field |
| **Structure** | Interaction design and information architecture: flows, states, how things are organised and named | Task needs three screens that should be one; modes; no way back |
| **Scope** | Functional specifications and content requirements: what the screen must contain and do | Missing empty/error state; feature nobody asked for; error text nobody wrote |
| **Strategy** | User needs and product objectives: why this exists, for whom | Screen solves a problem its users do not have |

Tag every finding with its plane. It tells you two things:

- **How to fix it.** A surface fix cannot cure a structure problem. Polishing a
  screen whose flow is wrong produces a well-polished wrong screen. Find the
  lowest plane on which the problem really sits.
- **Who decides.** Surface and skeleton findings inside the corporate rules are
  yours to fix. Structure findings need agreement before you restructure.
  Scope and strategy findings are questions for the product owner — raise them,
  do not resolve them by inventing or removing features.

From the Scope chapter, three things that bear directly on a review:

- **Requirements must be checkable.** State them positively, specifically, and
  without subjective words. "The page should feel modern" cannot fail;
  "follows the brand guidelines document" and "videos with the most views this
  week appear first" can. The same standard applies to the corporate rules in
  `design-system/RULES.md` and to every finding you write.
- **Content is a requirement, and someone must write it.** Error messages,
  empty states, help text, confirmation wording are part of the scope. A
  placeholder or raw technical message on screen means the requirement was
  never assigned. Know the real size of content (longest name, largest number,
  number of rows) before judging a layout.
- **Scope cuts both ways.** Compare the screen with what was asked for.
  Something required but absent is a finding; so is something present that
  nobody required. Each extra control taxes every user of the screen.

## 7. Lens 6 — Goodwill

Krug: users arrive with a limited reservoir of goodwill; every obstacle drains
it, and it can be refilled.

Drains: hiding what people came for (prices, fees, contact details, the
status of the thing they are waiting on); punishing them for not entering data
the system's way; asking for information the task does not need; insincere
warmth; decoration in the way of the task; a sloppy, unfinished look.

Refills: the three things most people come to do are obvious and easy; the
uncomfortable facts are stated up front; steps are saved for them; likely
questions are answered where they arise; recovery from error is graceful; and
when the product cannot do what they want, it says so and apologises.

## 8. Judgment calls the books settle

- **Conventions first.** A familiar pattern needs no explanation. Depart from
  one only if the replacement is as obvious, or valuable enough to be worth
  learning. The corporate design system is the local convention.
- **Clarity over consistency.** Consistency serves clarity. If following a
  pattern exactly makes this screen harder to understand, say so and raise it;
  do not hide a clarity problem behind "it's consistent".
- **Complexity is not the enemy; confusion is.** A dense professional tool
  that mirrors a complex task is fine if it has structure a user can learn.
  Do not flag density itself — flag missing structure, grouping and model.
- **Visual hierarchy has three jobs:** more important is more prominent;
  logically related is visually related; containment is shown by nesting. A
  heading that sits closer to the previous section than to its own is a
  hierarchy bug.
- **Usable before delightful.** Polish and delight are extra credit once the
  task is easy.
- **No criticism without an alternative.** Every flaw had a plausible reason.
  Say what would be better, and expect that a constraint you cannot see may
  have forced the trade-off — which is why some findings are questions.
- **Accessibility starts with clarity.** What confuses everyone confuses
  people using assistive technology more, with fewer ways to recover. Fix the
  general usability problems first; code-level fixes on a confusing screen do
  not make it accessible.
- A short list with no "it depends": no small low-contrast text; no labels
  inside fields; no floating headings; never hide the signifier.

## 9. What a review like this cannot do

All three books agree on the limit of expert review: you find out whether a
design works by watching people who did not build it try to use it. This skill
is a careful inspection by a viewer who already knows the answers. It reliably
finds violations of known principles. It cannot find what only a confused
stranger reveals: the concept people do not get, the word they were looking
for that is not there, the thing in plain sight they do not see.

Say this in every report, and recommend the cheap remedy: three people from
outside the team, one realistic task each, think aloud, watch quietly, fix the
worst problems, repeat.
