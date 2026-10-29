# design-system/ — your corporate rules live here

The skill is generic until these three files describe *your* design system.
Each ships as a template with a marker; while the marker is present the related
checks are skipped (so placeholder values never produce bogus findings).

| File | What it holds | Used by | Template marker to delete |
|---|---|---|---|
| `RULES.md` | The written rules: brand, type, layout, component usage, states, tone, approved exceptions | The agent, when judging screenshots and code | first line (`<!-- TEMPLATE ... -->`) |
| `tokens.json` | Allowed colors, font families, type scale, weights, spacing scale, radii | `capture.mjs` (rendered values) and `scan-source.mjs` (hard-coded values) | `"_template": true` |
| `components.json` | Component package name, raw-HTML → component map, banned libraries, deprecated components | `scan-source.mjs` | `"_template": true` |

## Filling them in

Ask the agent: *"Set up the ui-design-review skill for our design system"*. It
will look for the corporate package, token files, Storybook/docs and existing
`.cursor/rules`, draft all three files, and ask you to confirm anything it had
to guess. To do it by hand:

1. **Tokens** — if the design system ships CSS custom properties:
   `node scripts/extract-tokens.mjs node_modules/@your-company/ui/dist/tokens.css > tokens.draft.json`
   then review the categories and save as `tokens.json`. Colors accept any CSS
   color syntax and may be nested (`{"brand": {"primary": "#0057B8"}}`) or in
   Style Dictionary / W3C form (`{"value": ...}` / `{"$value": ...}`). Lengths
   accept numbers (px), `"8px"` or `"0.5rem"`.
2. **Components** — list the raw elements your library replaces and the UI
   libraries that must not be imported.
3. **Rules** — paste or summarise the corporate guidelines into `RULES.md` with
   IDs. If the guidelines live in a PDF or wiki, summarise the checkable rules
   here and link the original.

### Write rules that can fail

A rule is only useful to a reviewer if it is possible to show it was broken.
For every rule in `RULES.md`:

- **State what to do, not what to avoid.** "Destructive actions use the
  `danger` variant and sit left of Cancel" rather than "don't make delete
  buttons confusing".
- **Be specific.** "One primary button per view" rather than "use primary
  buttons sparingly".
- **No subjective words** — clean, modern, intuitive, friendly. If the brand
  book says "approachable", translate it into what that means on screen, or
  point to the guideline document that defines it.
- **Use numbers where there are numbers**: sizes, counts, limits, contrast.

Vague rules are left out of compliance scoring and listed for you as rules
that need sharpening.

Already have the rules elsewhere in the repo (for example
`docs/design-system.md` or `.cursor/rules/ui.mdc`)? Keep one source of truth:
make `RULES.md` a short pointer to that file instead of copying it.

Commit this folder so every teammate's agent reviews against the same rules.
