# Encapsulated skill environments

A skill that ships code runs it only through its declared isolated runtime,
never the host interpreter or globally installed packages. The declaration is
`skill-env.toml` at the skill root.

```toml
runtime = "uv"              # "none" | "uv" | "docker"
python  = ">=3.11"          # uv only (informational; each script's PEP 723 header is authoritative)
network = "none"            # docker only: "none" | "bridge"
network_reason = ""         # required when network != "none"
writable = ["$CWD"]         # docker only: host paths mounted read-write

[entrypoints]               # name = path relative to the skill root
lint = "scripts/lint_skill.py"

[smoke]                     # optional: args for `lint_skill.py --exec`; default "--help"
lint = "--help"
```

## Runtimes

### `none`
Instructions and references only. No `scripts/`, no code files.

### `uv` — default for Python
- Every `.py` script starts with PEP 723 inline metadata:
  ```python
  # /// script
  # requires-python = ">=3.11"
  # dependencies = ["httpx==0.27.2"]
  # ///
  ```
- Run as `uv run --script <path> [args]` — uv builds a cached, per-script
  virtualenv from the header. Never `pip install`, never a shared venv.
- Scripts with third-party deps are locked: `uv lock --script <path>` →
  `<path>.lock`, committed next to the script.
- Pass data as path arguments; never execute or import from a data directory.
- Stdlib-only scripts (`dependencies = []`) start fastest — use them for hooks.

### `docker` — system binaries, other languages, untrusted inputs, heavy tooling
- `env/Dockerfile` with a pinned base (`FROM python:3.12.7-slim`, ideally `@sha256:…`).
- `scripts/run.sh` is the single entrypoint:
  ```bash
  #!/usr/bin/env bash
  set -euo pipefail
  here="$(cd "$(dirname "$0")/.." && pwd)"
  tag="skill-$(basename "$here"):$(sha256sum "$here/env/Dockerfile" | cut -c1-12)"
  docker image inspect "$tag" >/dev/null 2>&1 || docker build -q -t "$tag" "$here/env" >/dev/null
  exec docker run --rm --network none --read-only --tmpfs /tmp \
    --user "$(id -u):$(id -g)" -v "$PWD:/work" -w /work "$tag" "$@"
  ```
- Network is off unless the manifest sets `network = "bridge"` with a reason.

### Node and other ecosystems
Prefer `docker`. A Node-only skill may instead keep `env/package.json` +
`env/package-lock.json`, install with `npm ci --prefix env` (never `-g`), and
run via a wrapper in `scripts/` that uses `env/node_modules/.bin`. Declare it
as `runtime = "docker"` if it needs browsers or system libraries.

## Availability
`lint_skill.py --exec` checks the runner exists and smoke-tests each
entrypoint. A missing runner is an error — skills never fall back to the host.
