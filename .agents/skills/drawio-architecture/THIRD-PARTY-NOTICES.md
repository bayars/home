# Third-party notices

This skill bundles no third-party code. It bundles two data files derived from draw.io, and it downloads third-party software during setup. Licence identifiers below are quoted from each project's own metadata as found on 2 October 2026.

## Bundled data derived from other projects

### `assets/icons.json`

A catalogue that maps short keys to draw.io style strings (shape names, colours, default sizes). It contains names and style text only; it does not contain icon artwork.

- Derived from `shape-search/search-index.json` in [jgraph/drawio-mcp](https://github.com/jgraph/drawio-mcp) at commit `a8079ba42475d45e9d78ff803a73d05d72eebeb3`, licensed under Apache-2.0, Copyright JGraph Ltd.
- Google Cloud entries are derived from shape names in `src/main/webapp/stencils/gcp2.xml` in [jgraph/drawio](https://github.com/jgraph/drawio) at commit `24b76c2cbd55d88e354042e8d329a2e4708972bc` (draw.io 31.7.0), licensed under Apache-2.0, Copyright JGraph Ltd and draw.io AG.
- Changes made: entries were filtered to cloud and network libraries, given keys, and checked against that draw.io release. See `maintenance/build-catalog.mjs`.

### `assets/drawio-manifest.json`

A list of file paths, sizes and SHA-256 hashes computed from [jgraph/drawio](https://github.com/jgraph/drawio) at the same commit. It contains no file contents.

### `assets/kinds.json`

Written for this skill. The style strings for AWS boundary kinds were copied from draw.io's AWS shape library (Apache-2.0, as above).

The Apache License 2.0 is available at <https://www.apache.org/licenses/LICENSE-2.0>.

## Downloaded during setup, not bundled

### npm packages

Installed into the cache folder from the npm registry, at the versions pinned in `scripts/package-lock.json`.

| Package | Version | Licence | Note |
|---|---|---|---|
| `elkjs` | 0.12.0 | EPL-2.0 OR GPL-3.0-or-later |  |
| `fsevents` | 2.3.2 | MIT | optional, macOS only; its build script is not run |
| `playwright` | 1.56.0 | Apache-2.0 |  |
| `playwright-core` | 1.56.0 | Apache-2.0 |  |

`elkjs` is the Eclipse Layout Kernel compiled to JavaScript; its source is at <https://github.com/kieler/elkjs>. Playwright's source is at <https://github.com/microsoft/playwright>.

### draw.io viewer, stencils and images

Fetched from [jgraph/drawio](https://github.com/jgraph/drawio) at commit `24b76c2cbd55d88e354042e8d329a2e4708972bc` into the cache folder. Licensed under Apache-2.0.

draw.io's `stencils/LICENSE`, `shapes/LICENSE` and `img/LICENSE` files add a condition for the icon sets and stencil libraries: they may not be used as software assets in, distributed for use with, or incorporated into Atlassian products or products distributed through the Atlassian marketplace or plugin ecosystem without explicit written permission. The same files state that the restriction does not apply to end-user diagram output such as exported images or documents. Read those files in the draw.io repository for the exact wording.

### Chromium

Used through Playwright, from an existing installation or downloaded by Playwright when `setup --install-browser` is run. Chromium is open-source software under a BSD-style licence with components under other licences; see <https://www.chromium.org/>.

## Trademarks and vendor icons

Amazon Web Services, Microsoft Azure, Google Cloud, Kubernetes and Cisco names and icons are the property of their respective owners. The icon artwork is part of draw.io's shape libraries and is used by reference: the skill's data files name the icons and do not contain them. Each vendor publishes terms for using its icons in architecture diagrams; follow them when you publish a diagram.

The pictures in `docs/img/` are the exception. They are rendered example diagrams, so they show a handful of AWS icons as they appear in a finished diagram, and `dark-theme-before.png`, `dark-theme-after.png` and `edit-data.png` are screenshots of the draw.io 31.7.0 editor (Apache-2.0) with those diagrams open. The draw.io name and logo belong to its developers. Remove the folder if you would prefer to redistribute the skill without them; nothing in the skill depends on it except the image links in `README.md`.

## This skill's own files

Everything else in this folder was written for this skill and carries no licence statement. Add one before distributing the skill outside your organisation.
