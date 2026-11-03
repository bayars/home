# Findings and how to fix them

`check` reports three levels. An `ERROR` means the file is wrong and must be fixed. A `WARNING` is something a reader would notice. A `note` is information.

For a diagram built from a spec, fix the **spec** and rebuild. For a hand-edited file, fix the **XML**. Both are given below.

Contents: [Errors](#errors) · [Labels](#labels) · [Shapes and containers](#shapes-and-containers) · [Edges](#edges) · [Background](#background) · [Notes](#notes) · [Run problems](#run-problems)

## Errors

| Finding | What it means | Fix |
|---|---|---|
| `xml` | The file is not well-formed XML. The message gives line and column. | Usually an unescaped `&`, `<` or `"` inside a `value` or `style` attribute, or a tag that was not closed. Escape as `&amp;`, `&lt;`, `&quot;`. |
| `unknown-shape` | A `shape=` name draw.io does not have. It renders as a plain rectangle. | XML: take the style from `icons <words> --style`; never type a shape name from memory. Cannot happen from a spec. |
| `unknown-icon` | The outer shape exists but its inner icon (`resIcon`, `prIcon`, `grIcon`) does not. It renders as a blank coloured square. | Same as above. |
| `missing-image` | An `image=img/lib/...` path that is not in this draw.io release. | Same as above. |
| `dangling-edge` | An edge whose `source` or `target` is missing or points at an id that does not exist. | Point it at a real id or delete the edge. |
| `edge-no-geometry` | An edge written as a self-closing tag. draw.io will not draw it. | Give it a child: `<mxGeometry relative="1" as="geometry"/>`. |
| `vertex-no-geometry` | A shape with no `<mxGeometry>`. | Add one with `x`, `y`, `width`, `height`. |
| `duplicate-id`, `missing-id` | Two cells share an id, or one has none. | Make every id unique. |
| `missing-parent`, `parent-cycle` | `parent` is absent, points nowhere, or loops. | Top-level cells use `parent="1"`. |
| `no-root-cells`, `no-root` | The two base cells are missing. | Every page starts with `<mxCell id="0"/>` and `<mxCell id="1" parent="0"/>`. |
| `render-failed`, `render-error` | draw.io could not draw the page. | Fix the other errors first; they are usually the cause. |

## Labels

| Finding | What it means | Fix in a spec | Fix in XML |
|---|---|---|---|
| `label-overflow` | Text needs more room than its box. | Shorten the label, or move detail to `desc`. The build sizes boxes from their text, so this is rare; it can appear with very long single words. | Enlarge the shape, or add `whiteSpace=wrap;` so the text wraps. |
| `label-outside-container` | A label sticks out of the boundary its shape is in. | Shorten the label or add `\n`. | Move the shape inward or widen the container. |
| `title-wraps` | A container title wraps onto several lines. | Shorten the group label. | Widen the container. |
| `title-covered` | A child shape sits on its container's title. | Should not occur; report it. | Move the child down (titles need about 30 px). |
| `label-over-node`, `label-over-label` | A label runs over another shape or label. | Shorten labels; try `"spacing": "roomy"`. | Move the shapes apart. |
| `html-not-enabled` | The label contains tags such as `<br>` but the style lacks `html=1`, so the tags show as text. | Cannot happen. | Add `html=1;` to the style. |
| `literal-newline` | The label contains a literal `\n`. | Cannot happen. | Use `&#xa;` or `<br>` (with `html=1`). |
| `tiny-text` (note) | Text smaller than 8 px. | — | Raise `fontSize`. |
| `style-syntax` | A style that is not `key=value;` pairs (CSS-like `key: value`, or line breaks inside it). draw.io ignores what it cannot parse. | Cannot happen. | Rewrite the style as `key=value;key=value;`. |

## Shapes and containers

| Finding | What it means | Fix in a spec | Fix in XML |
|---|---|---|---|
| `overlap` | Two shapes overlap. | Should not occur; report it. | Move one. If the overlap is intended (a badge on a box), say so and use `--ignore overlap`. A plain box behind the whole diagram is its background and is not reported; see [Background](#background). |
| `child-outside-container` | A child extends past its parent's border. | Should not occur. | Child coordinates are relative to the parent: keep `x + width` and `y + height` inside the parent's size, or enlarge the parent. |
| `overlaps-container` | A shape overlaps a container it is not a child of. Readers will think it belongs there. | Should not occur. | Either set `parent` to that container and convert `x`/`y` to container-relative, or move the shape clear. |
| `container-overlap` | Two containers overlap but neither is inside the other. | Should not occur. | Nest one in the other properly, or separate them. |
| `zero-size` | A shape with no width or height. | — | Give it a size. |
| `empty-page` | The page has nothing on it. | — | — |

## Edges

| Finding | What it means | Fix in a spec | Fix in XML |
|---|---|---|---|
| `edge-through-node` | An edge passes through a shape it does not connect to. | Mark the edge `"layout": false` only if it is already against the flow; otherwise reorder nodes or move the blocking node to its proper group. | Add waypoints (`<Array as="points">`) that go around, or move the shape. |
| `edge-through-label` | An edge runs through a label. | Shorten the label; for top-down diagrams check `direction` is set to `down` in the spec. | Move the label side (`labelPosition`, `verticalLabelPosition`) or reroute. |
| `edge-overlap` | Two unrelated edges run on top of each other, so they cannot be told apart. | Usually disappears after reordering edges or nodes. | Offset one with a waypoint, or set different `exitX`/`exitY`. |
| `edge-label-over-node`, `edge-label-overlap`, `edge-label-over-title` | An edge label covers a shape, another edge label, or a container title. | Shorten the label; `"spacing": "roomy"`. | Move the label: `<mxPoint x=".." y=".." as="offset"/>` inside the edge's geometry. |
| `edge-end-inside`, `edge-end-detached` | An edge stops inside a shape or short of it. | Should not occur. | Remove wrong `exitX`/`entryX` values, or for rotated shapes add `anchorPointDirection=0;`. |
| `edge-parent` | The edge's `parent` is not the innermost container holding both ends. Layout and clipping go wrong. | Cannot happen. | Set `parent` to the id named in the message. |
| `edge-to-edge` | An edge is attached to another edge. | — | Attach it to a shape. |

The report also counts edge crossings. A few are normal. Many crossings on a small diagram mean the grouping or the order needs another look.

## Background

A diagram built by this skill sits on a white box (`backdrop`) in a locked layer, with draw.io's theme recolouring turned off, so that it looks the same in a light and a dark draw.io and exports on white. `SKILL.md` ("The white background") explains why. The check finds the box by what it is: an unlabelled, unconnected rectangle lying behind the other shapes, either in a locked layer or, when someone drew it by hand, behind at least two thirds of the shapes on the page. That box is treated as scenery: it is not counted as a shape and never reported as overlapping anything.

| Finding | What it means | Fix in a spec | Fix in XML |
|---|---|---|---|
| `outside-backdrop` | A shape, label or edge reaches beyond the background box. In a dark theme, or in an export with a transparent background, that part has nothing white behind it. | Cannot happen: the box is sized from the layout on every build. | `backdrop file.drawio -o file.drawio` grows the box to cover everything (add `--fit` to shrink it as well). Do not type new coordinates for it by hand. |
| `background` (note) | One of three things, stated in the message. (1) The page has no background box. (2) It has one, but as an ordinary shape that gets selected and dragged while editing. (3) draw.io's dark theme would recolour the page, box included; the message gives the number of drawn elements that change colour, measured by drawing the page under both themes. | Appears only with `"background": "none"`, where it is expected. Remove that field unless the user asked for a transparent or theme-following diagram. | `backdrop file.drawio -o file.drawio` fixes all three: it adds the locked layer and box (or moves the hand-drawn box into a locked layer) and sets `adaptiveColors="none"` and a white page colour. If the user wants the file left as it is, leave it and say so; `--ignore background` hides the note. |

A box is not taken for the background if it has a label, has edges attached, has children, or lies in front of the shapes it surrounds. In the last case the ordinary `overlap` warnings appear, which is right: it is covering them.

## Notes

| Finding | What it means |
|---|---|
| `external-resource` | The file refers to an image, font or other content on another host. The check never loads outside content, so it is missing from the picture. draw.io will fetch it when a person opens the file. Prefer catalogue icons, which are part of draw.io. |
| `compressed` | The page is stored compressed. Run `decompress` before editing its XML. |
| `no-description` | The page does not say what it shows, so the next `scan` can only guess from its labels. Cannot happen from a spec, where the description is required. For any other file, write one once your work on it is done: `describe file.drawio --set "..." -o file.drawio` (`--page N` when there are several pages). Say what the page shows now, as described in `references/spec.md`, "The description". |

## Run problems

| Message | What to do |
|---|---|
| `INCOMPLETE: not rendered ...` | No usable browser. Run `setup` (and `setup --install-browser` if the user agrees). Until then only structural checks ran: say so. |
| `INCOMPLETE: some draw.io files could not be obtained` | A stencil or image download failed, so "unknown icon" findings may be false. Fix the network, rerun, and do not report the diagram as checked. |
| `the draw.io viewer could not be started` | Run `setup`. |
| `checksum mismatch` | A download did not match the pinned release and was discarded. Rerun. If it repeats, stop and tell the user: something is altering downloads from GitHub. |
