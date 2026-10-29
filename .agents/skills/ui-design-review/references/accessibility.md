# Accessibility checks

Target WCAG 2.2 AA unless `design-system/RULES.md` sets a different bar.

## Reading the automated output

| Source in `SUMMARY.md` | What it is | How far to trust it |
|---|---|---|
| `axe:*` | axe-core rules (WCAG A/AA + best practice) | Violations are reliable. A clean result does not prove conformance. |
| `axe:contrast-needs-visual-check` | Text over images/gradients/translucent layers | Not measured — look at the screenshot and judge legibility. |
| `focus:focus-not-visible` | Pixel comparison of each tab stop focused vs. not | Reliable: nothing changed on screen. Confirm on `*__focus-order.png` (red box). |
| `focus:focus-indicator-weak` | The change exists but is thin or low-contrast | Heuristic. Compare with the corporate focus ring. |
| `focus:focus-obscured` | Focused element's centre is covered (sticky header, cookie bar) | Usually right; verify on the screenshot. |
| `focus:keyboard-trap` | Tab did not move focus | Verify by hand: rich text editors and grids may handle Tab on purpose. |
| `focus:focus-order-jump` | Focus moved upward on the page | Informational. Fine between columns; wrong if it contradicts reading order. |
| `layout:clickable-not-focusable` | Pointer cursor on a non-interactive element | Usually a `div` with `onClick`. Confirm in source. |
| `layout:target-size` | Target under 24×24 px | WCAG 2.5.8 has a spacing exception; small targets with ≥24 px clear space around them pass. |
| `layout:placeholder-as-label` | Input named only by its placeholder | Reliable. |
| `resize:text-spacing-breaks` | Text or a container clips once WCAG 1.4.12 spacing is applied | Reliable; open `*__text-spacing.png`. |
| `resize:breaks-at-large-text` | Same, with the browser's default font size doubled (1.4.4) | Reliable; open `*__large-text.png`. |
| `resize:text-ignores-user-font-size` | Share of text sized in fixed pixels | Not a WCAG failure (zoom still works) but people who enlarge text in settings get nothing. |
| `ux:current-location-not-exposed` | Current nav item is styled but lacks `aria-current` | Usually right; check the component. |
| `ux:vague-link-text` | "Click here", "Read more" | Reliable. Screen-reader users list links out of context. |
| `ux:wrong-input-type` | Email/phone field typed as text | Heuristic from name/label. |
| `feedback:*` | Whether scripted clicks produced a visible change | Visual only — says nothing about whether the change is announced to assistive technology. |

The keyboard walk runs on one viewport (desktop by default) and stops after
`--max-tabs` stops; raise it for long pages. It walks the page as loaded for
that state — overlays need their own state in the config so their focus
behaviour is captured.

## Clarity comes first

What confuses everyone confuses people using assistive technology more, and
they have fewer ways to recover: picture meeting a puzzling error message
without being able to see the page. A screen that scores badly on first glance,
wayfinding, interaction or errors in the rubric is not accessible however clean
its markup, so fix those before fine-tuning ARIA. People using screen readers
scan too — by ear, jumping between headings and links and hearing only the
first words of each. That is why headings must be real headings in a sensible
outline, and why links, buttons and headings should lead with their
distinguishing words.

## Manual checks the tools cannot do

Do the ones that apply to the UI in scope. Read the component source alongside
the screenshots.

**Keyboard**
- Tab order in `*__focus-order.png` follows the visual/reading order.
- Every action available by mouse is available by keyboard, including
  hover-revealed row actions, drag-and-drop alternatives, custom dropdowns.
- Composite widgets follow expected keys: arrows within tabs/menus/radio
  groups/listboxes, Esc closes overlays, Enter/Space activate.
- Dialogs/drawers/menus: focus moves in on open, stays in while open, returns
  to the trigger on close. Capture the open state and check its tab order.
- A skip link or landmarks let users bypass repeated navigation.

**Names, roles, states**
- Accessible names say what the control does. Icon-only buttons have a name
  ("Delete order 1042", not "button" or "icon"). Several "Edit"/"More" buttons
  in a list are distinguishable.
- Images: informative ones have meaningful alt text; decorative ones have
  `alt=""`. Alt text that repeats the file name is a failure even though axe
  passes it.
- Custom controls expose the right role and state (`aria-expanded`,
  `aria-selected`, `aria-checked`, `aria-current`, `aria-invalid`,
  `aria-busy`). Prefer the corporate component, which should already do this.
- Form errors are tied to their field (`aria-describedby`) and announced
  (`role="alert"` or a live region); required fields are marked in code, not
  only with an asterisk.
- Dynamic updates (toasts, async results, counts, loading finished) are
  announced through a live region.
- Headings describe the sections and nest logically; landmarks (`header`,
  `nav`, `main`, `footer`) exist and `main` is unique. Page `<title>` is
  specific and `<html lang>` is set.

**Perception**
- Information is not carried by color alone (status, required, errors, chart
  series, selected state).
- Non-text contrast: borders of inputs, icons that convey meaning, and focus
  indicators reach 3:1 against their background (axe does not check this —
  judge from the screenshot and token values).
- Text over images or gradients remains legible in every viewport capture.
- At the 320 px `reflow` viewport nothing requires two-directional scrolling
  and nothing is lost; text scales when the browser zoom is 200 %.
- Text spacing: containers with fixed heights will clip when users increase
  line/letter spacing — `text-clipped-vertical` findings point at these.

**Motion and time**
- Animation respects `prefers-reduced-motion`; nothing flashes; auto-rotating
  or auto-updating content can be paused; session timeouts warn first.

**Input**
- Inputs use correct `type`/`inputmode`/`autocomplete` so mobile keyboards and
  password managers work.
- Actions fire on pointer up/click, not pointer down; drag has a single-pointer
  alternative (WCAG 2.5.7).
- Authentication and forms do not force users to re-enter information already
  given in the same flow (3.3.7) or rely on a memory test (3.3.8).

## Reporting

For each accessibility finding give the WCAG success criterion, the element
and component, who is affected (keyboard users, screen-reader users, low
vision, motor, cognitive), and the fix expressed in terms of the corporate
component or token where one exists.

State clearly that this is an automated-plus-heuristic review, not a
conformance audit: it does not replace testing with a screen reader and with
people who use assistive technology.
