---
name: revealjs
description: "Use this skill whenever the user wants to create, edit, or verify a reveal.js slide presentation (an HTML deck viewed in the browser). Triggers include: any mention of 'reveal.js', a browser/HTML slide deck, a talk or presentation to be delivered as a web page, arrow-key/grid slide navigation, or requests like 'build me slides about X as a webpage', 'make an HTML presentation', or 'a deck I can present in the browser'. Especially use it when the user wants organized left/right/up/down (grid) navigation, syntax-highlighted code on slides, or a good-looking, aligned deck whose content never overflows the slide. Do NOT use for PowerPoint/.pptx (use the pptx skill), Google Slides, or plain PDFs."
license: Proprietary. LICENSE.txt has complete terms.
---

# reveal.js presentations

A reveal.js deck is a single HTML file: `.reveal > .slides > <section>` elements, styled with CSS and driven by the reveal.js runtime. The three things that make a deck feel professional — **organized arrow-key navigation, tight alignment, and content that never overflows** — all come from a handful of structural rules below.

**Start from the reference deck.** `assets/template.html` (in this skill's directory) is a complete, verified deck: grid navigation, aligned scaffold, safe code blocks, capped body height. Copy it and replace the content rather than writing a deck from scratch — then run the verifier before handing it over.

| Task | Approach |
|---|---|
| **Create** a deck | Copy `assets/template.html`, edit the `<section>`s, keep the scaffold + config |
| **Edit** an existing deck | Change slide `<section>`s; leave the scaffold CSS and `Reveal.initialize` intact |
| **Verify** it | `python scripts/screenshot_deck.py deck.html shots/` — screenshots every slide + flags overflow |

Always pin a version. Use **reveal.js 5.2.1** from a CDN; never `@latest` (a silent major bump breaks decks). Base URL: `https://cdnjs.cloudflare.com/ajax/libs/reveal.js/5.2.1/`.

## Navigation model — the organized left/right/up/down grid

reveal.js has a 2-D grid. Map it to your content so the arrow keys mean something:

```
  left / right  move between TOPICS (top-level sections)
  up / down     move within a topic (its detail slides)

  Topic 1 ──▶ Topic 2 ──▶ Topic 3 ──▶ Topic 4
                 │            │
                 ▼            ▼
              detail       detail
                 │
                 ▼
              detail
```

Space / "next" **snakes**: down through a topic's stack, then right to the next topic. So `right` is "skip to the next topic," `down` is "go deeper here," and Space is "just take me forward through everything."

Structure this by **nesting** `<section>`s. A top-level `<section>` with nested `<section>`s becomes a vertical stack (up/down); a top-level `<section>` with direct content is a single slide:

```html
<div class="slides">
  <section> … Topic 1 (single slide) … </section>

  <section>                    <!-- Topic 2: a vertical stack -->
    <section> … intro …   </section>   <!-- down from here -->
    <section> … detail …  </section>
  </section>

  <section> … Topic 3 … </section>
</div>
```

Set the navigation behaviour in config:

```js
navigationMode: 'default',   // left/right between topics, up/down within a stack (recommended)
controls: true,
controlsLayout: 'edges',     // arrow affordances hug the screen edges
controlsBackArrows: 'faded',
keyboard: true,              // arrow keys on (default)
hash: true,                  // deep-linkable #/2/1 URLs
```

`navigationMode` options: `'default'` (2-D grid, best for topics-with-details), `'grid'` (left/right keep the *same* vertical row across topics — use when every topic has parallel depth), `'linear'` (flattens to one left/right track, no up/down — only if you have no sub-slides). Pick `'default'` unless the content is genuinely parallel.

## Alignment — make every slide line up

The default reveal.js look centers everything, so slides jump around as content length changes. Two rules fix it:

1. **Top-align the deck:** set `center: false` in config. Slides now start from the top, so headers align across the whole deck instead of floating.
2. **Use one scaffold for every content slide** — header / body / footer, as a flex column:

```html
<section>
  <div class="slide">
    <div class="slide-head"><p class="kicker">Topic 02</p><h2>Slide title</h2></div>
    <div class="slide-body"> … content … </div>
    <div class="slide-foot"><span>Section</span><span>note</span></div>
  </div>
</section>
```

The scaffold CSS (in the template) makes `.slide` a full-height flex column and lets `.slide-body` flex to fill the middle. Titles, kickers, and footers then sit at the same y-position on every slide. Left-align text (`text-align: left`) — centered body text reads as ragged and templated.

For the footers to actually line up, each section must be the *full* deck height — with `center: false`, reveal otherwise sizes a short slide to its content, so its footer floats up mid-screen. The template forces `.reveal .slides > section, .reveal .slides > section > section { height: 100% }`, which pins every header to the top and every footer to the bottom, and as a bonus stops a slightly-tall slide from growing past the `height` budget and being downscaled.

For horizontal alignment, use the template's helpers: `.columns` (CSS grid, equal columns), `.card`, `.metric`. reveal.js also ships `r-hstack` / `r-vstack` (flex rows/columns) and `r-stack` (centered layering, e.g. for swapping images with fragments).

## Overflow — content must never spill off the slide

This is the #1 reveal.js failure. The deck is designed at a fixed resolution (set `width: 1280, height: 720`) and scaled uniformly to the viewport; **reveal.js does not shrink content that is too tall — it just lets it overflow** onto the footer, controls, or off-screen. Defend against it in this order:

1. **One idea per slide.** If a slide is crowded, split it into vertical (up/down) slides. This is the primary fix, not a fallback.
2. **Cap the body.** The template's `.slide-body` has `overflow: auto` and flexes within the fixed height, so worst case content scrolls *inside* the body instead of colliding with other components. Keep this — it's the safety net.
3. **Auto-fit big things.** Add `r-fit-text` to a hero line to scale it to the width; wrap the one image/video that should fill leftover space in `r-stretch` (it auto-sizes to the remaining vertical room — only one direct child).
4. **Size code down** (see below).
5. **Verify** with the screenshot script — it prints an OVERFLOW WARNING with the exact pixel overrun for any slide that doesn't fit.

Do **not** try to fix overflow by disabling scaling or hard-coding tiny fonts everywhere; split the content instead.

## Code blocks

Load the highlight plugin and a code theme (Monokai reads well on light or dark slides):

```html
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/reveal.js/5.2.1/plugin/highlight/monokai.min.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/reveal.js/5.2.1/plugin/highlight/highlight.min.js"></script>
<!-- then add RevealHighlight to the plugins array -->
```

Markup:

```html
<pre><code data-trim data-line-numbers="1|4-6|8-11" class="language-javascript">
  // indentation here is stripped by data-trim
  const deck = new Reveal();
</code></pre>
```

- **`data-trim`** removes the surrounding whitespace so you can indent the code to match your HTML.
- **`class="language-xxx"`** sets the language (`language-python`, `language-bash`, …); omit to auto-detect.
- **`data-line-numbers`** turns on the gutter. A value like `"1|4-6|8-11"` creates highlight *steps* you advance with `right` — start on line 1, then lines 4-6, then 8-11.
- **Escaping:** `<code>` content is parsed as HTML, so literal `<`, `>`, `&` must be escaped (`&lt; &gt; &amp;`) — or wrap the body in `<script type="text/template">…</script>` and reveal.js unescapes it for you.
- **Sizing (anti-overflow):** the template sets code to a smaller `font-size` with `max-height` + `overflow: auto`, so a long snippet scrolls inside its own panel instead of pushing the slide. For very long code, show the relevant excerpt and split the rest across vertical slides.

## Plugins

Every plugin follows the same three-step wiring: (1) add its `<link>`/`<script>` to the page, (2) put its **global name** in the `plugins: [ … ]` array, (3) optionally pass a config object keyed by the plugin's name. Getting the global name wrong fails silently — copy them exactly from the tables below. **Pin every plugin version** (like reveal.js itself); `@latest` will eventually pull a breaking change.

**Built-in plugins** ship with reveal.js under `…/5.2.1/plugin/` on the same CDN — no extra install:

| Plugin | Global name | What it adds |
|---|---|---|
| Highlight | `RevealHighlight` | Syntax-highlighted code (needs a `highlight/<theme>.min.css`) |
| Notes | `RevealNotes` | Speaker view (press **S**) |
| Markdown | `RevealMarkdown` | Write slides in Markdown via `data-markdown` |
| Math | `RevealMath.KaTeX` | LaTeX math (load `plugin/math/math.min.js`) |
| Search | `RevealSearch` | In-deck text search (press **Ctrl/⌘-F**) |
| Zoom | `RevealZoom` | Alt-click to zoom into part of a slide |

The template already loads Highlight, Notes, and Markdown.

**Recommended community plugins** (load from jsDelivr, pinned). The template bakes in the first three:

| Plugin | Global name | CDN (pin the version) | Use it for |
|---|---|---|---|
| Mermaid | `RevealMermaid` | `reveal.js-mermaid-plugin@11.15.0/plugin/mermaid/mermaid.js` | Flowcharts, sequence/class/state/ER diagrams from text — no image files |
| Verticator | `Verticator` | `reveal.js-verticator@1.3.1/plugin/verticator/verticator.{js,css}` | Dots showing how many ↑/↓ slides are in the current stack — reinforces the grid |
| CopyCode | `CopyCode` | `reveal.js-copycode@1.3.2/plugin/copycode/copycode.{js,css}` | A "copy" button on every code block |
| Menu | `RevealMenu` | `reveal.js-menu@2.1.0/menu.{js,css}` | Slide-out menu to jump to any slide by title |
| Chalkboard | `RevealChalkboard` (+ `RevealCustomControls`) | `reveal.js-plugins@latest/chalkboard/plugin.{js}` + `…/customcontrols/…` | Draw/annotate on slides live (press **B** / **C**); needs Font Awesome |
| Chart | `RevealChart` | `reveal.js-plugins@latest/chart/plugin.js` + Chart.js | Bar/line/pie charts from inline data via Chart.js |

> The `reveal.js-plugins` collection (Chalkboard, Chart, Animate, Anything, …) is documented upstream with `@latest`; replace it with the current pinned version from its npm page before shipping.

**Mermaid** (added to the template). Put the diagram source inside `.mermaid > pre`; the plugin renders it to SVG on load:

```html
<div class="mermaid"><pre>
flowchart LR
  A[Idea] --> B{Fits the slide?}
  B -- Yes --> C[Ship it]
  B -- No  --> D[Split vertically]
</pre></div>
```

Configure it via the `mermaid` key (`theme: 'default' | 'neutral' | 'dark' | 'forest'`, plus any mermaid init option). **Overflow matters here:** a complex diagram can be huge, so the template caps it with `.reveal .mermaid svg { max-height: 430px; height: auto; }` — keep that rule so big diagrams scale down instead of spilling off the slide. One diagram per slide reads best.

## Config reference (the options that matter)

```js
Reveal.initialize({
  width: 1280, height: 720,     // 16:9 design resolution; everything must fit this box
  margin: 0.07,                 // outer gutter so content never kisses the screen edge
  minScale: 0.2, maxScale: 1.5, // scaling bounds when the viewport differs
  center: false,                // top-align → consistent alignment (see above)
  navigationMode: 'default',    // the left/right/up/down grid
  controls: true, controlsLayout: 'edges', controlsBackArrows: 'faded',
  progress: true,               // progress bar
  slideNumber: 'c/t',           // "3/12" indicator
  hash: true,                   // #/h/v deep links
  transition: 'slide',          // none | fade | slide | convex | concave | zoom
  // plugin config is keyed by plugin name. 'base' + themeVariables lets you
  // match a diagram to your palette instead of the stock mermaid look.
  mermaid: { theme: 'base', themeVariables: { primaryColor: '#EEF0FF', primaryBorderColor: '#4B3FE4', lineColor: '#8A93AD' } },
  verticator: { color: '#4B3FE4' },
  plugins: [
    RevealHighlight, RevealNotes, RevealMarkdown,   // built-in
    RevealMermaid, Verticator, CopyCode,            // community (see Plugins section)
  ],
});
```

**Speaker notes:** add `<aside class="notes">…</aside>` inside a `<section>` and load `RevealNotes`; press **S** for the presenter view (notes, timer, next-slide preview). **Fragments:** add `class="fragment"` to reveal an element on the next `right`. **Themes:** the base `theme/<name>.min.css` (black, white, league, night, solarized, dracula, moon, sky, serif, simple) is only a starting point — the template's `<style>` block is what gives the deck a real identity. For distinctive visual direction, also consult the **frontend-design** skill.

## Verify the output

Never ship a deck you haven't looked at. The script walks the deck in real navigation order (following the same grid the audience will) and flags overflow:

```bash
python scripts/screenshot_deck.py deck.html shots/          # 16:9 by default
python scripts/screenshot_deck.py deck.html shots/ --fragments   # also capture each fragment step
ls shots/    # slide-01.png, slide-02.png, …  then Read them
```

Before capturing, the script waits for webfonts to load and forces a `Reveal.layout()` — webfonts change text metrics *after* the first layout, which is a top cause of phantom overflow — and it lets each transition settle so screenshots aren't grabbed mid-scale. It then flags two distinct problems and exits non-zero if either appears:

- `slide-NN.png is bigger than the design box (…)` — the slide is taller/wider than `width×height`, so reveal has to downscale it. Trim or split it.
- `slide-NN.png clips content inside '<selector>' (…)` — a scroll container (e.g. `.slide-body`, a code block) is hiding content the audience would have to scroll to see. Shorten it or move content to a vertical slide.

Elements with `overflow: visible` (like a hero number that paints outside its box on purpose) are intentionally *not* flagged. Read the PNGs to check alignment, spacing, and that code blocks fit. Fix, re-run, repeat.

> Offline rendering: the verifier drives a headless browser. If the machine has no internet, install reveal.js locally (`npm install reveal.js@5.2.1`) and point the deck's `<link>`/`<script>` tags at `node_modules/reveal.js/dist/…` and `…/plugin/…` for the render, then switch back to the pinned CDN URLs for the deliverable.

## PDF export

reveal.js prints to PDF from Chrome: open the deck with `?print-pdf` appended to the URL, then Print → Save as PDF (Background graphics on, margins none). Or automate it with `decktape` (`npx decktape reveal deck.html deck.pdf`).

## Gotchas

- **`@latest` in a CDN URL** eventually pulls a new major and breaks the deck — always pin `5.2.1`.
- **Plugin CSS/JS paths** live under `plugin/highlight/…`, `plugin/notes/…`, etc. (post-4.0 layout). Getting the path wrong = no highlighting, silently.
- **Content taller than `height`** overflows without warning — that's what the verifier catches.
- **Unescaped `<` / `>` in a `<code>` block** disappears (parsed as tags) — escape or use `<script type="text/template">`.
- **`center: true` (the default)** makes slides jump vertically as content length changes; set `center: false` for aligned decks.
- **Only one direct child** may go inside `r-stretch`; more than one and sizing breaks.

## Dependencies

reveal.js 5.2.1 (via CDN, or `npm install reveal.js@5.2.1` for offline) · community plugins from jsDelivr, pinned (`reveal.js-mermaid-plugin@11.15.0`, `reveal.js-verticator@1.3.1`, `reveal.js-copycode@1.3.2`, and others in the Plugins section) · Python `playwright` + a chromium binary for `screenshot_deck.py` (`pip install playwright --break-system-packages && playwright install chromium`) · optional `decktape` (npm) for PDF export.
