# ui-design-review

An agent skill for Cursor (it follows the open Agent Skills format, so it also
works in other agents that read `SKILL.md`). It lets the agent *see* the React
UI it is working on and review it like a designer would, against your
corporate design system:

- Playwright screenshots across viewports, themes and interaction states
- Automated checks: WCAG (axe-core), keyboard order and focus indicators,
  layout defects, feedback after each action, survival at larger text and
  spacing, wayfinding, leftover or vague wording, design-token compliance
- Source scan: raw HTML instead of corporate components, banned UI libraries,
  hard-coded colors/sizes, accessibility anti-patterns
- A rubric for the judgment calls: hierarchy, typography, consistency,
  usability, content, responsiveness
- A fix-and-verify loop with before/after comparison

The review method was checked against three books and their principles are
built into the rubric and checks: Steve Krug's *Don't Make Me Think,
Revisited*, Don Norman's *The Design of Everyday Things*, and Jesse James
Garrett's *The Elements of User Experience*. See `references/principles.md`.

## Install

1. Copy this folder to `<your-repo>/.cursor/skills/ui-design-review/`
   (project-wide, shared through git) or `~/.cursor/skills/ui-design-review/`
   (just you). Reload the Cursor window, then type `/` in Agent chat and check that
   `ui-design-review` is listed.
2. Install the script dependencies once:
   ```bash
   npm install --prefix .cursor/skills/ui-design-review/scripts
   npx --prefix .cursor/skills/ui-design-review/scripts playwright install chromium
   ```
   Browser download blocked? Skip the second line; the agent can use Edge or
   Chrome with `--channel msedge` / `--channel chrome`.
3. Teach it your design system — ask the agent
   *"Set up the ui-design-review skill for our design system"*, or fill in
   `design-system/` by hand (see `design-system/README.md`). Until you do, the
   review uses generic best practice only and says so.
4. Optional: copy `assets/ui-design-review.mdc` to `.cursor/rules/` so the
   agent reviews its own UI work automatically.
5. Add `.design-review/` to `.gitignore`.

## Use

- "Review the orders page design" / "Is this form accessible?" /
  "Check the new dashboard against our design system and fix what you find."
- Use a model that can read images, otherwise only the measured half runs.

## Layout

```
SKILL.md                    workflow the agent follows
scripts/capture.mjs         screenshots + automated audits
scripts/scan-source.mjs     static design-system scan
scripts/extract-tokens.mjs  bootstrap tokens.json from CSS variables
design-system/              YOUR corporate rules, tokens, component map
references/                 principles, rubric, accessibility checks, report template, troubleshooting
assets/ui-design-review.mdc optional Cursor rule
design-review.config.example.json
```
