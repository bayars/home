# Troubleshooting

## Install

- **`Playwright is not installed`** — run `npm install --prefix "<SKILL_DIR>/scripts"`.
  If the project already has `playwright` or `@playwright/test`, the scripts
  use it; then only `axe-core` is needed (`npm i -D axe-core` in the project,
  or the prefix install above).
- **Browser download blocked (proxy/firewall)** — do not fight it. Use the
  browser already on the machine: `--channel msedge` or `--channel chrome`,
  or `--browser-path "<path to chrome/msedge executable>"` (or the
  `DESIGN_REVIEW_BROWSER` environment variable). In a config file:
  `"channel": "msedge"`.
- **Private npm registry** — the install honours the project's `.npmrc`; run
  it from the project root with `--prefix` so the corporate registry applies.
- **Node** — needs Node 18 or newer.

## Getting to the UI

- **Login required** — save a session once and reuse it:
  `npx playwright codegen --save-storage=.design-review/auth.json http://localhost:5173/login`
  (log in in the window that opens, then close it), then pass
  `--storage-state .design-review/auth.json` or set `auth.storageState` in the
  config. Keep that file out of git. If the app has a mock/demo mode or MSW
  handlers, prefer that: it also gives stable data for before/after runs.
- **A single component, no route** — use its Storybook story in iframe mode:
  `http://localhost:6006/iframe.html?id=<story-id>&viewMode=story`. The story
  id is in the Storybook URL (`?path=/story/<story-id>`). No Storybook? Review
  the smallest route that renders the component.
- **States that need interaction** — add `states` with `actions` in the
  config. Selectors are Playwright selectors: `text=Save`,
  `button:has-text('New order')`, `[data-testid=filters]`, `role=dialog`.
  If an action times out, the selector is wrong for that viewport (for example
  the button lives inside a collapsed mobile menu) — add the step that opens it.
- **Empty / error / loading states** — drive them through the app's mock layer
  or query params if available. If the state cannot be produced, list it under
  "Not checked" rather than guessing how it looks.
- **Dark theme** — `--themes light,dark` sets `prefers-color-scheme`. If the
  app switches theme by attribute/class/localStorage instead, set
  `themeSetup` in the config, e.g.
  `{"dark": {"attr": ["data-theme", "dark"]}}`, `{"dark": {"class": "dark"}}`
  or `{"dark": {"localStorage": {"theme": "dark"}}}`.
- **Next.js / Remix / Vite** — nothing special; point at the dev URL. A dev
  error overlay is reported as a critical `error-overlay` finding: fix the
  error first.
- **Monorepo** — install the skill in the app's own `.cursor/skills/` or at the
  repo root; run the scripts from the app directory so `.design-review/` and
  `--changed` are relative to it.

## Captures look wrong

- **Blank or half-rendered** — add `--wait-for "<selector that appears when
  data is in>"` (or `waitFor` per page) and/or raise `--settle 1500`.
- **Only the first screen is captured** — the app scrolls an inner container.
  The script detects the largest scroll area and adds `*__scroll-NN.png`
  shots; if it picked the wrong one, capture the lower part as a state with a
  `scroll` action.
- **Very long pages** — the first six tiles are captured. Review the rest as a
  separate state with a `scroll` action, or review the sections as stories.
- **Animations / carousels** — screenshots freeze CSS animations at their end
  state. For JS-driven motion, add a `wait` action.
- **Different results between runs** — live data. Use mock data, and keep the
  same config and label so the before/after comparison in `SUMMARY.md` means
  something. Use `--label before` / `--label after` to keep both sets of
  screenshots side by side.

## Noisy or surprising findings

- **`off-token-spacing` on browser-default margins** (e.g. 21.28 px on an
  unstyled `h4`) — the element is not using the corporate `Heading`/`Text`
  component or a reset; that is the real finding.
- **`off-token-*` from a third-party embed** (maps, chat widgets, charts) — add
  its container to `ignoreSelectors` in the config. This is the legitimate use
  of that option; do not use it on product UI.
- **`target-size` on dense corporate components** — if the design system
  defines a compact density that is below 24 px, report it upstream.
- **`text-truncated`** — informational; check there is a tooltip, expandable
  row or detail view for the full value.
- **Token names look odd** (white reported as `text.inverse`) — a color that
  appears under several token names is reported under the first match.
- **Component names are single letters** — a production build was reviewed.
  Use the dev server for readable React component names.
- **`hardcoded-color` in a token/theme file** — list that path under
  `tokenFiles` in `components.json`.

- **`no-feedback-after-action` on an action that does respond** — the response
  was not visual in the viewport (focus moved off-screen, a sound, a change
  below the fold) or took longer than ~1.3 s. Both are still worth a look.
  `slow-feedback` on a dev server can be build latency; confirm on a
  production build before reporting it as major.
- **`control-not-clickable`** — Playwright could not reach the control with a
  pointer, usually because the page is wider than a mobile viewport or
  something overlays it. The state is still captured via a scripted click.
- **`floating-heading` on a deliberate layout** — a heading followed by a
  toolbar or large media can legitimately have more space below; judge on the
  screenshot.
- **`weak-signifier` on links inside a corporate component** — report upstream
  rather than restyling locally.
- **`title-heading-mismatch` / `page-name-mismatch`** — informational prompts
  for the wayfinding check, not defects by themselves.
- **The run is slow** — the text-resize pass starts a second browser and the
  feedback check waits after each click. Use `--no-text-checks` and
  `--no-feedback` for quick iterations inside the fix loop, and run the full
  set before reporting.
- **Large-text check skipped** — the installed browser rejected the font-size
  flag (it is Chromium-specific). Everything else still runs.

## Exit codes and CI

`capture.mjs` exits 0 on a completed run, 1 on setup errors, and 2 when
`--fail-on critical|major|minor` is given and findings at or above that
severity exist — usable as a pre-merge gate once the baseline is clean.
