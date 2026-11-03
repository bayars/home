# Security and licensing

This skill runs scripts on your machine, downloads files, and starts a browser. This page says exactly what it does, what it is prevented from doing, and how to verify that yourself.

## Summary

- The skill contains no compiled or minified code. Everything in `scripts/` and `assets/viewer/` is readable source written for this skill.
- It downloads from two places during setup: the npm registry (two pinned packages) and the official draw.io repository on GitHub (viewer and stencil files at one pinned commit). Every draw.io file is checked against a SHA-256 list that ships with the skill; a file that does not match is discarded.
- While checking a diagram, the browser cannot reach any host other than your own machine. Three independent layers enforce that.
- It sends nothing anywhere: no telemetry, no analytics, no uploads.
- It writes only to the output paths you name and to its cache folder.

## What is downloaded

| What | From | When | Integrity |
|---|---|---|---|
| `elkjs` 0.12.0, `playwright` 1.56.0 and `playwright-core` 1.56.0 | `registry.npmjs.org` | `setup` | `scripts/package-lock.json` pins exact versions and SHA-512 hashes. Installed with `npm ci --ignore-scripts`, so no package install script runs. |
| draw.io viewer script and stencil files | `https://raw.githubusercontent.com/jgraph/drawio/24b76c2cbd55d88e354042e8d329a2e4708972bc/src/main/webapp/...` | `setup` for seven core files; others on first use | `assets/drawio-manifest.json` lists the SHA-256 and size of all 2,326 files the skill may fetch. Anything not on the list is refused. |
| Chromium | Playwright's download servers | only with `setup --install-browser` | handled by Playwright |

`fsevents` appears in the lockfile as an optional macOS-only dependency of Playwright. Its build script does not run, because of `--ignore-scripts`.

The only code in the skill that opens an outbound connection is `scripts/lib/net.mjs` (83 lines). It refuses any URL that is not `https://raw.githubusercontent.com`, keeps TLS verification on, does not follow redirects, and caps responses at 32 MB. `scripts/lib/assets.mjs` then verifies the hash before the file is written to the cache, and again every time a cached file is read, so a cache file that was altered later is discarded and fetched again.

## What runs

| Code | Where it runs | Notes |
|---|---|---|
| The skill's scripts | Node.js, as you | `npm` is the only program they launch (plus Playwright's own installer with `--install-browser`), with fixed arguments. No shell is started on Linux or macOS; on Windows `npm` is a `.cmd` file and needs one. |
| `elkjs` | Node.js, as you | Pure layout computation. Receives the graph, returns coordinates. |
| draw.io viewer script | inside the headless browser page only | A 4 MB minified third-party script, pinned by hash. It is never evaluated in Node.js. |
| Chromium | a separate process | Fresh temporary profile each run, downloads and service workers disabled. Uses Chromium's sandbox unless you run as root or the sandbox is unavailable; the report says `sandbox off` in that case. |

## What the browser can reach

A `.drawio` file can contain image links, web fonts and HTML labels. A file from someone else could use those to make a viewer fetch a tracking URL. During a check that cannot happen:

1. **Content-Security-Policy.** The local server sends `default-src 'self' data: blob: ...` with every response, so the page may load only from itself.
2. **Request filter.** Playwright aborts every request whose host is not the local server.
3. **Dead-end proxy.** Chromium is started with the local server as its proxy. Any request for another host arrives there and is answered with 403.

Blocked requests are listed in the report as an `external-resource` note. The test suite includes a file that tries all of these (`tests/run.mjs`, "nothing outside this machine is contacted").

draw.io itself sanitises HTML labels before displaying them, so a `<script>` tag or an `onerror` handler in a label does not run (the test suite checks this too). The layers above do not depend on that.

## The local server

- listens on `127.0.0.1` only, on a random free port, for the duration of one check
- serves the diagram under a path containing a random 128-bit token
- serves draw.io files only if they are on the manifest; no directory listing, no path traversal
- rejects requests whose `Host` header is not the server's own address
- `serve` keeps it running until you press Ctrl+C; nothing else does

## Files written

| Path | By |
|---|---|
| the `-o` and `--png` paths you give (and `.overview.png` / `.tile-*.png` beside the PNG) | `build`, `check`, `backdrop`, `describe --set`, `spec`, `decompress` |
| the cache folder | `setup`, and `check` when it fetches a stencil |
| a temporary folder, removed afterwards | `setup`'s end-to-end test, the test suite |

The skill folder is never written to in normal use. `maintenance/` scripts write to `assets/` and call `git rev-parse` to read a commit id; they are for maintainers and are not run by Claude.

## What `scan` reads

`scan` reads files named `*.drawio`, `*.dio` and `*.drawio.xml` under the folder you give it, and nothing else. It does not follow symbolic links, does not enter hidden folders or dependency and build folders (`node_modules`, `vendor`, `dist`, `build`, `out`, `target`, `coverage`, `venv`), goes at most eight levels deep, and stops after 200 files. It writes nothing and sends nothing anywhere. A file you name directly is read whatever its name is.

## What is stored inside a diagram

A file built by this skill holds, as page properties that are not drawn: the description, the spec it was built from, a marker, and a 16-character hash of the drawing. The spec contains only what is on the diagram (labels, icon keys, connections). All of it is plain text that anyone with the file can read, in draw.io under Edit > Edit Data, so `SKILL.md` tells Claude to keep credentials and connection strings out of descriptions as well as labels. Nothing identifies the machine or the user.

`build` will not write over an existing diagram that was drawn or rearranged by hand unless `--overwrite` is given, so a spec cannot silently replace someone's work.

## Handling of untrusted input

- `.drawio` files are parsed by a small strict XML reader (`scripts/lib/xml.mjs`) that rejects `DOCTYPE` declarations and unknown entities. Files over 30 MB are refused, and compressed pages are limited to 64 MB when unpacked.
- Text in a spec is escaped before it is written, so a label cannot inject markup or attributes into the file.
- `SKILL.md` tells Claude to treat text inside a diagram as content, not as instructions, and never to copy secrets from infrastructure code into labels. That covers descriptions too: `scan` prints descriptions from files of any origin, cut to a fixed length, and they are data about a diagram, never commands.
- A stored spec is used only if the page says this skill built it, and it goes through the same validation as any other spec when it is built again.

## Verifying it yourself

```
# the pinned packages have no known advisories
cd scripts && npm audit --package-lock-only

# every line of the skill's code that names a host or builds a URL
grep -rnE "https?://|ALLOWED_HOST =" scripts/lib scripts/drawio-arch.mjs assets/viewer

# run the tests, including the download-verification and blocked-network tests
node tests/run.mjs --network
```

The `grep` shows one outside host, `raw.githubusercontent.com`, defined once in `net.mjs`. The other matches are `127.0.0.1` (the local server) and a placeholder used only to parse URLs.

`npm audit` reported no vulnerabilities for the lockfile on 5 October 2026. Advisories appear over time, so run it again before relying on that.

## What this does not protect against

- **The pinned draw.io viewer and Chromium are trusted.** The hash pin guarantees you get the same viewer that was tested, not that the viewer is free of bugs. Playwright 1.56.0 brings Chromium 141, which is not the newest. Because the browser can load only local content, exposure is small, but if you prefer a newer browser, point `DRAWIO_ARCH_PLAYWRIGHT` at your own Playwright install.
- **Your own machine.** Other programs running as you can read the cache folder and the files the skill writes.
- **What Claude is asked to draw.** The skill renders whatever is in the spec or file.

## Licences

The skill bundles no third-party code. It does bundle two data files derived from draw.io, and it downloads third-party software at setup. Details and attributions are in [THIRD-PARTY-NOTICES.md](../THIRD-PARTY-NOTICES.md). The points that matter in practice:

- **Vendor icons.** The AWS, Azure, Google Cloud, Kubernetes and Cisco icons belong to their owners and are subject to each vendor's terms for architecture diagrams. Using them in your own architecture diagrams is their intended purpose.
- **draw.io's icon restriction.** draw.io's stencil and icon files carry an added condition: they may not be used as software assets in, or distributed for use with, Atlassian products or Atlassian marketplace apps without permission. Diagrams you create are explicitly exempt. This matters only if you plan to redistribute the downloaded icon files themselves.
- **The skill's own files** carry no licence statement. Choose one before you publish or share the skill outside your organisation.

This is a description of the terms as found in the sources on 2 October 2026, not legal advice.
