# How it works

## The pipeline

```
 spec.json ──► build ──► diagram.drawio ──► check ──► findings + PNG
               │                            │
               ├ icons.json  (icon key → draw.io style)
               ├ kinds.json  (box and boundary styles)
               └ ELK         (layout engine)
                                            ├ draw.io viewer   (renders the file)
                                            ├ Playwright       (drives headless Chromium)
                                            └ local server     (serves viewer + stencils from the cache)
```

Before any of that, Claude runs `scan` on the project folder and reads what each existing diagram says it shows. If one covers the request, that diagram is updated; the pipeline above is for a new diagram, or for rebuilding one that this skill built.

Claude runs `build --check`, reads the findings, changes the spec, and repeats until the report is clean. Then it looks at the PNG.

For a file made elsewhere there is no spec: Claude reads `outline`, edits the XML, runs `backdrop` to fit the white background to the result, and runs `check`.

## Why a spec instead of XML

A `.drawio` file is XML in which every shape has pixel coordinates and a long style string. A language model writing that directly has to do layout arithmetic in its head and recall style strings exactly. Both go wrong in predictable ways: shapes overlap, containers are too small for their children, and an icon name that is off by one word renders as an empty square.

The spec removes both jobs. It has no coordinates, and icons are named by short keys that the build step looks up and rejects when they do not exist. For the bundled AWS example the spec is 2.7 KB and the generated file is 19 KB.

## Build

`scripts/lib/build.mjs`

1. **Validate.** Every problem is collected and reported together: unknown fields, unknown icon keys (with suggestions from the catalogue), bad ids, missing parents, loops.
2. **Size.** Icons are scaled to 48 px. Boxes are sized from their text using Helvetica character widths (`text.mjs`), because no browser is involved yet. Boundaries get a minimum width from their title.
3. **Lay out.** The graph goes to [ELK](https://eclipse.dev/elk/) (`elkjs`), using its layered algorithm with the whole nesting handled in one pass and right-angle edge routing. Boundary titles are reserved as top padding; labels outside icons are declared to ELK so nothing is placed over them.
4. **Parallel groups.** ELK routes an edge between two sibling boundaries out of one and into the other along the flow, which puts the boundaries one after the other. That is wrong for availability zones and regions, which are copies and belong side by side. Edges between two "parallel" siblings are therefore left out of the layout and routed afterwards by a small router (`route.mjs`) that searches a grid for the cheapest right-angle path around shapes and labels, with penalties for turns, for crossing other edges and for running on top of them.
5. **Write XML.** Positions are snapped to whole pixels in a way that keeps edge ends exactly on shape borders. Each edge is filed under the innermost boundary that holds both its ends, which is what draw.io itself does. Labels are escaped twice (HTML inside an XML attribute), so text in a spec can never become markup.
6. **White background.** The extent of everything drawn (shapes, outside labels, edge routes and their labels, the title) is taken from the layout and widened by 20 px. A white box of that size goes into a locked layer that comes first in the file, so it is drawn behind everything. The page is marked `adaptiveColors="none"` with a white page colour, every shape gets an explicit text colour, and edge labels get a white label background. `"background": "none"` in the spec skips all of this.

## What a diagram says about itself

`scripts/lib/meta.mjs`, `scripts/lib/scan.mjs`

A draw.io page can carry properties of its own. They belong to the page's root cell, which draw.io writes as `<object label="" name="value" ... id="0"><mxCell/></object>`. The build step stores four:

| Property | Holds |
|---|---|
| `description` | what the diagram shows and how the system works, written by Claude in the spec |
| `generator` | a marker that this skill built the page |
| `spec` | the spec the page was built from, as JSON |
| `fingerprint` | a hash of every shape and edge as built: id, parent, label, style, ends and geometry |

`scan` walks a folder for `.drawio`, `.dio` and `.drawio.xml` files and prints, per page, the description, or a summary taken from the labels when there is none, and one line on how the page should be updated. It recomputes the fingerprint to decide that: equal means nobody has touched the drawing, so the stored spec still describes it and the diagram can be rebuilt; different means someone has, so it has to be edited as XML. `spec` and `build -o <existing file>` apply the same test and refuse the destructive path.

`describe --set` writes or replaces the description on any page, wrapping a bare root cell in an `<object>` when needed and keeping properties it does not know.

## Background for existing files

`scripts/lib/backdrop.mjs`

`backdrop` renders the file through the check, then edits the parsed XML of each page: it inserts a locked `Background` layer directly after the root cell, puts a white box in it (or moves the user's own hand-drawn box there, keeping its id and style), sets the box to the rendered extent plus a margin, and sets `adaptiveColors="none"` and `background="#ffffff"` on the page. Nothing else is moved or restyled. Pages come back as plain XML, as with `decompress`.

## Check

`scripts/lib/check.mjs`, `assets/viewer/inspect.js`

1. **Structural checks** on the XML, with no browser (`lint.mjs`): well-formedness, duplicate ids, edges that point nowhere, edges without geometry, wrong edge parents.
2. **Render.** A web server on 127.0.0.1 serves a page that loads the official draw.io viewer script and the diagram. Stencil and image files come from the cache, or are downloaded from the pinned draw.io commit and verified on first use. Headless Chromium opens the page.
3. **Inspect.** A script in the page reads the viewer's own data structures: the real bounding box of every label as rendered, the real route of every edge, and draw.io's registry of shapes. That is how it can tell that a label is 14 px wider than its box, or that `mxgraph.aws4.lambda_function_url` does not exist.
4. **Background.** The script finds the background box (an unlabelled, unconnected rectangle behind the other shapes, in a locked layer or drawn by hand), leaves it out of the overlap checks, and reports anything that reaches beyond it. It then switches the page to the other colour scheme, reads every drawn element's computed colours again, and counts the differences: that count is how the check knows whether a file depends on the theme, instead of inferring it from attributes.
5. **Screenshot.** The diagram is captured at full size. If it is larger than about 1,500 px on its longer side, an overview and overlapping tiles are written too, because a large image is scaled down when a model looks at it and small defects vanish.

The check reads the render instead of only producing a picture for two reasons. Measured findings are exact and repeatable, where judging a picture is neither. And the most damaging defect, an invented icon name, is nearly invisible in a picture: it shows as a plain coloured square.

What the check cannot judge is whether the diagram communicates: whether the flow reads in one direction, whether related things are close. That is why the last step is still to look.

## Where files come from

| Thing | Source | When | Verified by |
|---|---|---|---|
| Skill scripts, catalogue, manifest | this folder | installed with the skill | — |
| `elkjs`, `playwright` | npm registry | `setup` | `package-lock.json` integrity hashes |
| draw.io viewer script | `raw.githubusercontent.com/jgraph/drawio/<commit>/` | `setup` | SHA-256 in `assets/drawio-manifest.json` |
| Stencil and image files | same | `setup` (six common sets) or first use | SHA-256 in the manifest |
| Chromium | already on the machine, or Playwright's download servers | `setup --install-browser` | Playwright |

Nothing from draw.io is bundled in the skill. The manifest lists 2,326 files of draw.io 31.7.0 (52 MB); only the ones a diagram needs are ever fetched.

## The icon catalogue

`assets/icons.json` maps keys to the exact style strings draw.io's own shape libraries use. It is generated by `maintenance/build-catalog.mjs` from two sources at fixed commits: draw.io's published shape index, and for Google Cloud the stencil file itself, because the index omits most of that set. Every entry is checked against the pinned release when it is generated, and the test suite renders all 2,326 to confirm none is blank.

| Prefix | Icons | What |
|---|---|---|
| `aws.` | 1,152 | AWS service squares and resource glyphs |
| `azure.` | 604 | Azure service icons |
| `gcp.` | 289 | Google Cloud hexagon product icons |
| `cisco.` | 186 | Cisco network equipment |
| `net.` | 56 | Vendor-neutral network equipment |
| `k8s.` | 39 | Kubernetes objects |

## Design decisions

**ELK in Node, not draw.io's own layout.** draw.io ships an ELK-based layout, but run with label measuring it stretches icons to the width of their labels, and run without it ignores the labels. Calling ELK directly lets the build declare icon size and label size separately.

**The draw.io viewer, not a reimplementation.** Rendering with draw.io's own code means the picture and the measurements match what the user will see when they open the file.

**A Node script, not `npx playwright screenshot`.** The screenshot command can only take a picture and exits with success even when the page failed to render. The check needs to read values back from the page.

**Download on demand, not bundle.** The viewer and stencils are 52 MB and carry their own licence terms. Pinning a commit and verifying hashes gives the same reproducibility as bundling without shipping other people's files.

**A white box and pinned colours, not one or the other.** Current draw.io recolours a diagram in the dark theme: every colour is mapped to a dark counterpart unless the page says otherwise. Three approaches were tried in the draw.io 31.7.0 editor with the dark theme on. A white box alone is inverted with everything else (white becomes `rgb(18, 18, 18)`), so the diagram ends up dark anyway. `adaptiveColors="none"` alone keeps the true colours and gives a white canvas while editing, but an export with a transparent background has nothing behind the diagram, and a draw.io release that predates the setting ignores it. Both together hold in every case tested: the editor canvas is white, the box cannot be selected or moved (it is in a locked layer, and draw.io treats a click on it as a click on empty canvas), new shapes land in the normal layer, Select All leaves the box out, PNG export is white corner to corner, PNG export with "transparent background" is still white behind the diagram, and SVG export carries `color-scheme: light` whichever appearance is chosen in the export dialog.

**The box is sized from the render when a file is edited.** `backdrop` asks the check for the rendered extent of the page, so labels that hang outside their icons and edge routes are covered. Computing it from the XML geometry alone would miss both. It grows an existing box but does not shrink one without `--fit`, because a background is sometimes sized on purpose.

**The description lives on the root cell.** A description is only useful if it survives. Attributes on `<mxfile>` are rewritten by draw.io on every save, and XML comments are dropped. Page properties on the root cell are a draw.io feature, so they are kept, and a person can read and edit them in the editor (Edit > Edit Data with nothing selected). This was checked in the draw.io 31.7.0 editor for all seven examples: the properties load, nothing is drawn for them, the dialog shows them, and they are still there after a save.

**A fingerprint instead of trusting the spec.** A stored spec invites a rebuild, and a rebuild throws away anything a person has arranged by hand. The fingerprint makes that visible. It has to ignore what draw.io changes by merely saving a file, which was measured in the same editor: cells come back grouped under their parents, attributes are reordered, zero coordinates are left out, and the parts of an edge's geometry change order. The hash therefore sorts cells and geometry parts and compares numbers by value. With that, a save leaves it unchanged for all seven examples, and moving one shape by 10 px changes it.

**Required, not optional.** A spec without a description is rejected. An optional field would be left out exactly when a diagram is made in a hurry, and those are the diagrams nobody can identify later.

**Findings as text.** The report is plain lines with stable kind names, so Claude can act on them and `references/findings.md` can say how.
