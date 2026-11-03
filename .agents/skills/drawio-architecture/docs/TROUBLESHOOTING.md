# Troubleshooting

Start with `node scripts/drawio-arch.mjs doctor`. It shows which part is not ready.

## Setup

**`npm packages: ... missing`**
Setup runs `npm ci` in the cache folder. It needs `npm` on the PATH and access to `registry.npmjs.org`. Behind a proxy, configure npm (`npm config set https-proxy ...`) and run `setup` again.

**`draw.io ... viewer and stencils: ... HTTP 4xx` or a timeout**
The files come from `raw.githubusercontent.com`. Check that host is reachable. Behind a proxy, set `HTTPS_PROXY=http://host:port` (only `http://` proxies are supported). If your proxy inspects TLS, Node.js must trust its certificate: set `NODE_EXTRA_CA_CERTS=/path/to/ca.pem`.

**`checksum mismatch`**
The downloaded file is not the one that was pinned. It was discarded. Run setup again; a truncated download is the usual cause. If it repeats for the same file, something between you and GitHub is altering the response: do not work around it.

**`Chromium for rendering: FAILED`**
No Playwright on the machine could start a browser. Options:

- `setup --install-browser` downloads Chromium for the pinned Playwright (about 150 MB).
- Already have Playwright with browsers elsewhere? `DRAWIO_ARCH_PLAYWRIGHT=/path/to/project` (the folder that contains `node_modules/playwright`).
- Have Chrome or Chromium installed? `DRAWIO_ARCH_CHROMIUM=/path/to/chrome`.
- On Linux, missing system libraries stop Chromium from starting. `npx playwright install-deps chromium` installs them (needs administrator rights).
- In a container, the sandbox may be unavailable: `DRAWIO_ARCH_NO_SANDBOX=1`.

Without a browser the skill still builds diagrams. `check --no-render` runs the structural checks only.

**The cache is in the wrong place, or the home folder is read-only**
Set `DRAWIO_ARCH_CACHE=/some/writable/folder`.

**Starting over**
Delete the cache folder and run `setup`. Nothing else is stored anywhere.

## Building

**`Spec problems:` followed by a list**
The spec was rejected before any layout. Fix every line; each says which node, group or edge it is about. For an unknown icon the message suggests close matches; `icons <words>` searches further.

**`the layout library (elkjs) is not installed`**
Run `setup`.

**The diagram is very wide or very tall**
See "Steering the layout" in `references/spec.md`. The usual causes are an edge that runs against the flow (mark it `"layout": false`), the wrong `direction`, or too much in one diagram.

**Two zones or regions are placed one after the other instead of side by side**
They are not marked parallel. Zone and region kinds are parallel by default; for other groups add `"parallel": true` to both.

## Checking

**`INCOMPLETE: some draw.io files could not be obtained`** (exit code 2)
A stencil or image needed by this diagram is not in the cache and could not be downloaded. Findings such as `unknown-icon` may be false in that state. Restore network access and rerun. `setup --prefetch icons` (or `--prefetch all`, 52 MB) downloads everything ahead of time for offline use.

**`label-overflow` on text that fits when I open the file**
The check measures with the fonts installed where it runs. If that machine lacks a Helvetica- or Arial-compatible font (Liberation Sans on Linux is one), the fallback font is wider. Install such a font, or treat those findings as approximate.

**A finding is intentional**
For example a badge deliberately placed on a box reports `overlap`. Pass `--ignore overlap` and note why.

**The PNG is blank or tiny**
Run `check` without `--png` and read the findings; a `render-failed` or `xml` error explains it. An empty page is reported as `empty-page`.

**The check is slow**
A normal check takes two to five seconds. The first diagram that uses Azure icons fetches each icon file once. `setup --prefetch icons` does that up front.

## Existing diagrams and descriptions

**Claude drew a new diagram although one already existed**
Check what `scan <folder>` prints for the existing file. If it says `no description`, the only clue was its labels: give it one with `describe file.drawio --set "..." -o file.drawio`, or ask Claude to describe your existing diagrams. If the file is in a folder the scan skips (hidden, `dist`, `build`, `out`, `target`, `vendor`, `node_modules`), name that folder or the file itself.

**`Spec problems: "description" is missing`**
Every spec needs a `description` now. Add a few sentences on what the diagram shows. This also applies to specs written for the previous version of the skill.

**`... was drawn by hand, with another tool, or by an older version of this skill. Building over it would replace the whole drawing.`**
`build` is protecting an existing diagram. To change that diagram, have its XML edited. To replace it with the freshly built one, add `--overwrite`.

**`... was changed by hand after it was built`**
Someone moved, added, removed or relabelled something in draw.io after the build, so rebuilding would lose that. The diagram is now edited as XML. If you would prefer the automatic layout back and do not mind losing the manual changes: `spec file.drawio -o file.arch.json --force`, then `build file.arch.json -o file.drawio --overwrite`.

**I only opened the file in draw.io and saved it. Does that count as a change?**
No. The comparison ignores what draw.io rewrites on a plain save.

**Where do I see or change the description myself?**
In draw.io, click an empty part of the canvas so nothing is selected, then Edit > Edit Data (Ctrl+M, or Cmd+M on a Mac). Change `description` and leave `spec`, `fingerprint` and `generator` alone. From the command line: `describe file.drawio`.

**I do not want the spec stored in the file**
Delete the `spec`, `fingerprint` and `generator` properties in the same dialog. The diagram is then treated as hand-made and is edited as XML from then on.

## Background and dark theme

**A diagram is dark, inverted or washed out when I open it in draw.io**
Your draw.io uses the dark theme and the file is not pinned to white. Files built by this version of the skill are; older ones, and files from elsewhere, are fixed with `node scripts/drawio-arch.mjs backdrop file.drawio -o file.drawio`. `check` reports the condition as a `background` note.

**I drew a white box behind the diagram and it turns dark anyway**
Current draw.io recolours the box along with everything else. The box needs the page to turn recolouring off as well; `backdrop` does that and keeps your box.

**I cannot select or resize the white box**
That is intended: it sits in a locked layer so it does not get in the way. To change it by hand, open View > Layers, click the lock beside `Background`, make the change, and lock the layer again. To refit it to the diagram automatically, run `backdrop` (add `--fit` to shrink it as well as grow it).

**`outside-backdrop`: something extends beyond the background box**
Shapes were added or moved past the edge of the box after it was made. Run `backdrop` on the file.

**An export has a dark or transparent area around the diagram**
Inside the box an export is always white. Around it, the export uses the page colour, which the skill also sets to white, unless "transparent background" is ticked in the export dialog. Either untick it or give the box a larger margin: `backdrop file.drawio -o file.drawio --margin 60`.

**I want a transparent diagram that follows the theme**
Put `"background": "none"` in the spec and rebuild. The check then adds a `background` note to say so; `--ignore background` hides it.

**How do I see what a dark-theme user sees?**
`check file.drawio --theme dark --png dark.png`.

## Looking at a file yourself

`node scripts/drawio-arch.mjs serve file.drawio` prints a local address. Open it in a browser on the same machine to see exactly what the check renders. In the browser console, `drawioArch.inspect()` returns the findings as data. The same page works with the Playwright command-line tool (`playwright-cli open <address>`, then `playwright-cli eval "() => drawioArch.inspect()"`).

## Reporting a problem

Include the output of `doctor`, the command you ran, its full output, and the spec or `.drawio` file if you can share it.
