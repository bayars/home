<!-- TEMPLATE: this file has not been filled in yet. Delete this line once it holds the real corporate rules. -->

# Corporate UI/UX rules

The reviewing agent treats this file as the source of truth. Where a rule here
conflicts with a generic best practice in `references/rubric.md`, this file
wins — except for accessibility, where a conflict is reported rather than
silently resolved (see SKILL.md).

Give every rule a short ID so findings can cite it. Write each rule so it can
fail: positive, specific, no subjective words, numbers where they exist.
"Primary buttons: one per view, right-aligned in dialogs" beats "use buttons
well"; "approachable" is not a rule until it says what it means on screen.

## Sources of truth

- Design system docs / Storybook: <URL or path>
- Component package: <e.g. @your-company/ui>
- Token source: <e.g. node_modules/@your-company/tokens/dist/tokens.css>
- Accessibility target: <e.g. WCAG 2.2 AA>

## Who uses our products

- <Primary users, their expertise, how often they use the product, the devices
  and conditions they work in. The reviewer uses this to judge density,
  terminology and how much guidance a screen needs.>

## Brand and color

- **COL-1** Only palette tokens may be used; no hex/rgb literals in product code.
- **COL-2** <Brand primary is reserved for the primary action and active navigation.>
- **COL-3** <Status colors (error/success/warning) are never used decoratively and never the only signal.>

## Typography

- **TYP-1** <Typeface(s), and the fallback stack.>
- **TYP-2** <Type scale and which step is used for page title / section title / body / caption.>
- **TYP-3** <Sentence case for headings and buttons? Max line length?>

## Layout and spacing

- **LAY-1** <Grid: columns, gutters, max content width, page margins per breakpoint.>
- **LAY-2** <Spacing scale and the standard gaps: inside cards, between form fields, between sections.>
- **LAY-3** <Breakpoints and what must change at each.>

## Components

- **CMP-1** Use the corporate component for anything it covers; never restyle it with overrides.
- **CMP-2** <Buttons: hierarchy (primary/secondary/tertiary), one primary per view, order, placement.>
- **CMP-3** <Forms: label position, required/optional marking, help text, validation timing, error message style.>
- **CMP-4** <Tables: density, alignment of numbers, empty state, pagination vs. infinite scroll.>
- **CMP-5** <Dialogs/drawers: when to use each, sizes, dismiss behavior.>
- **CMP-6** <Icons: library, sizes, never icon-only without an accessible name/tooltip.>

## States and feedback

- **STA-1** <Every data view has loading, empty, error and partial-data states; which components to use for each.>
- **STA-2** <Toasts vs. inline messages vs. banners.>
- **STA-3** <Focus ring style; hover/pressed/disabled conventions.>

## Errors and destructive actions

- **ERR-1** <Undo vs. confirmation: which actions get which.>
- **ERR-2** <Confirmation dialogs: title names the action and object; button labels are the action ("Delete order" / "Keep order").>
- **ERR-3** <Validation: when it runs, where messages appear, wording pattern.>

## Navigation

- **NAV-1** <Global navigation pattern, how the current location is marked, when breadcrumbs are required.>
- **NAV-2** <Page title pattern, including the browser tab title.>

## Content and tone

- **TXT-1** <Voice, capitalization, terminology list, date/number/currency formats.>

## Accessibility

- **A11Y-1** <Conformance target and any stricter internal requirements.>

## Things that look wrong but are intentional

List approved exceptions here so the agent does not "fix" them.

- <e.g. Legacy admin pages still use the v1 table; migration tracked in JIRA-123.>
