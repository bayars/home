# Maintenance

For whoever looks after this skill. Claude does not need this file to draw diagrams.

## Running the tests

```
node scripts/drawio-arch.mjs setup          # once
node tests/run.mjs                          # about 40 seconds
node tests/run.mjs --all-icons --network    # about a minute; downloads ~5 MB of icon files the first time
```

| Group | What it covers |
|---|---|
| fast tests | XML reader, text measurement, catalogue and manifest consistency, spec validation messages, escaping, structural lint, exit codes, every example builds to valid XML |
| render tests | every example renders with no findings; every deliberate defect in `tests/fixtures/defects.drawio` is reported; outside content is blocked; compressed multi-page files work |
| description tests | every example carries its description and its own spec; the description survives quotes, tags and line breaks; the fingerprint is unchanged by what draw.io rewrites on save and changed by real edits; `scan` finds and summarises diagrams and stays out of dependency, hidden and linked folders; `describe`, `spec` and the guard in `build` behave as documented |
| background tests | built diagrams have the locked white box and draw identically under the dark theme; a diagram built without it is measurably recoloured; `backdrop` adopts the hand-drawn box in `tests/fixtures/handmade-backdrop.drawio`, adds one to compressed and multi-page files, and avoids ids already in use |
| `--all-icons` | all catalogue icons and every box and boundary kind render without an error |
| `--network` | a download is verified, and a cache file that was tampered with is discarded and replaced |

Render tests are skipped, and say so, when no browser is available.

Run the full set after any change to `scripts/`, `assets/` or `examples/`.

## Moving to a newer draw.io release

The pin lives in `assets/drawio-manifest.json` (commit, version, and a hash for every file). To move it:

```
git clone --depth 1 --branch v<NEW> --filter=blob:none --sparse https://github.com/jgraph/drawio.git
cd drawio
git sparse-checkout set --no-cone /VERSION /src/main/webapp/js/viewer-static.min.js \
    /src/main/webapp/stencils/ /src/main/webapp/img/ /src/main/webapp/mxgraph/images/ \
    /src/main/webapp/styles/ /src/main/webapp/shapes/
cd ..
git clone --depth 1 https://github.com/jgraph/drawio-mcp.git

node maintenance/build-manifest.mjs ./drawio
node maintenance/build-catalog.mjs ./drawio ./drawio-mcp
node tests/run.mjs --all-icons --network
```

Then:

1. Read what `build-catalog.mjs` prints. "left out" counts entries of the shape index that are not in the release; "aliases without a target" lists aliases to repair in the script.
2. Compare the old and new `assets/icons.json` key lists. A key that disappeared breaks specs that use it: add an alias from the old key to its replacement.
3. Update the version numbers quoted in `README.md`, `docs/SECURITY.md` and `docs/HOW-IT-WORKS.md`, and the icon counts.
4. Open one built example in the new release's editor with the dark theme on and confirm what the README shows: white canvas, true colours, a box that cannot be selected, white PNG and SVG exports. The test suite covers the viewer; the editor is a separate code path. draw.io's handling of diagram colours in the dark theme has changed between releases, so this is the step most likely to need attention. Replace `docs/img/dark-theme-*.png` if the editor looks different.
5. In the same editor, confirm that page properties still work as the skill assumes: with nothing selected, Edit > Edit Data shows `description`; after File > Save the properties are still in the file; and `describe` on the saved file still says "not changed since". If a new release changes what it rewrites on save, the fingerprint in `scripts/lib/meta.mjs` is the place to adjust, and the test "fingerprint: unchanged by what draw.io rewrites on save" should be extended to mimic the new behaviour.
6. Look at the PNGs of the examples once. Styles in `assets/kinds.json` for AWS boundaries were copied from draw.io's AWS library; if that library changed its group styles, update them (the `--all-icons` test fails if a boundary's icon no longer exists).

Both maintenance scripts only read the checkouts and write to `assets/`.

## Updating the npm packages

Edit the versions in `scripts/package.json`, then:

```
cd scripts
npm install --package-lock-only --ignore-scripts
npm audit --package-lock-only
```

Delete the `node` folder in the cache, run `setup`, and run the tests. A new Playwright version needs its matching Chromium (`setup --install-browser`). A new `elkjs` can change layouts: look at the example PNGs.

## Adding or changing kinds

`assets/kinds.json` holds box kinds, boundary kinds and the colour palette.

- A box kind needs `label` (`inside` or `below`), a style `s` ending in `;`, a `desc`, and either `minW`/`minH` (inside) or `w`/`h` (below). `padX`/`padY` reserve room for shapes whose outline eats into the text area (cylinder, cloud).
- A boundary kind needs `s`, `desc`, `top` (pixels reserved for the title), `inset` (where the title text starts) and `align`. Add `"parallel": true` for kinds that are replicas of each other.
- Add the kind to the tables in `references/spec.md`.

The `--all-icons` test builds one of every kind and fails on any finding.

## Adding icon sets

Add a block to `maintenance/build-catalog.mjs` that reads entries from the shape index (or names from a stencil file), gives them a key prefix, and validates each against the release. Add the stencil file to `CORE` in `scripts/lib/setup.mjs` if the set should work offline after setup, and the prefix to the test that checks key format.

## Layout experiments

`DRAWIO_ARCH_ELK_OPTIONS` takes a JSON object of ELK options that override the defaults for one run:

```
DRAWIO_ARCH_ELK_OPTIONS='{"elk.layered.nodePlacement.strategy":"NETWORK_SIMPLEX"}' \
  node scripts/drawio-arch.mjs build examples/aws-web-app.json -o /tmp/x.drawio --check
```

Compare size, crossings and findings across all seven examples before changing a default in `scripts/lib/build.mjs`.

## Evaluating the skill with Claude

`evals/evals.json` holds test prompts. The scripts are tested by `tests/run.mjs`; the evals test the instructions, by having Claude carry out a request with the skill and looking at what it produces. Use them after changing `SKILL.md` or the references.

## Before sharing a new version

- [ ] `node tests/run.mjs --all-icons --network` passes
- [ ] `cd scripts && npm audit --package-lock-only` is clean
- [ ] `doctor` and `setup` work from an empty cache (`DRAWIO_ARCH_CACHE=$(mktemp -d)`)
- [ ] numbers quoted in the docs match (`assets/drawio-manifest.json`, `assets/icons.json`)
- [ ] the zip contains one top-level folder named `drawio-architecture` and no `node_modules`
