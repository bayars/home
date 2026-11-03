#!/usr/bin/env bash
# Install kubectl krew (plugin manager) and a set of popular plugins.
# Plugin index: https://krew.sigs.k8s.io/plugins/
set -euo pipefail

PLUGINS=(
  # Context / namespace switching
  ctx                 # kubectl ctx  - switch contexts
  ns                  # kubectl ns   - switch namespaces
  konfig              # merge/split kubeconfigs

  # Inspecting resources
  neat                # strip clutter from `get -o yaml`
  tree                # show ownership tree (Deployment -> RS -> Pod)
  lineage             # show related resources
  get-all             # really get *all* resources
  images              # list container images in use
  explore             # fuzzy-find resource fields (like explain)
  view-secret         # decode secrets
  stern               # tail logs from multiple pods
  sick-pods           # find pods that aren't healthy

  # Capacity / usage
  resource-capacity   # node requests/limits/utilization
  view-allocations    # resource allocations per node/namespace
  view-utilization    # cluster utilization overview
  df-pv               # disk usage of PVs

  # RBAC / auth
  access-matrix       # what can I do on which resources
  who-can             # who can do X on Y
  rbac-tool           # RBAC lookup / visualization
  rolesum             # summarize RBAC roles for a subject
  whoami              # current authenticated subject
  oidc-login          # OIDC auth for kubectl

  # Maintenance
  outdated            # find outdated container images
  deprecations        # find deprecated API usage
  node-shell          # shell into a node
)

if ! command -v kubectl >/dev/null 2>&1; then
  echo "kubectl not found; install it first." >&2
  exit 1
fi

# --- Install krew (official instructions) ---
if ! kubectl krew version >/dev/null 2>&1 && [ ! -x "${KREW_ROOT:-$HOME/.krew}/bin/kubectl-krew" ]; then
  (
    set -x
    cd "$(mktemp -d)"
    OS="$(uname | tr '[:upper:]' '[:lower:]')"
    ARCH="$(uname -m | sed -e 's/x86_64/amd64/' -e 's/\(arm\)\(64\)\?.*/\1\2/' -e 's/aarch64$/arm64/')"
    KREW="krew-${OS}_${ARCH}"
    curl -fsSLO "https://github.com/kubernetes-sigs/krew/releases/latest/download/${KREW}.tar.gz"
    tar zxvf "${KREW}.tar.gz"
    ./"${KREW}" install krew
  )
fi

export PATH="${KREW_ROOT:-$HOME/.krew}/bin:$PATH"

# Persist PATH in shell rc files
PATH_LINE='export PATH="${KREW_ROOT:-$HOME/.krew}/bin:$PATH"'
for rc in "$HOME/.bashrc" "$HOME/.zshrc"; do
  if [ -f "$rc" ] && ! grep -qF '.krew/bin' "$rc"; then
    printf '\n# kubectl krew\n%s\n' "$PATH_LINE" >> "$rc"
    echo "Added krew to PATH in $rc"
  fi
done

# --- Install plugins ---
kubectl krew update
kubectl krew install "${PLUGINS[@]}" || true   # don't abort if one plugin fails
kubectl krew upgrade || true

# --- kubectl-aliases (sourced by .bashrc) ---
# https://github.com/ahmetb/kubectl-aliases
curl -fsSL https://raw.githubusercontent.com/ahmetb/kubectl-aliases/master/.kubectl_aliases \
  -o "$HOME/.kubectl_aliases"
echo "Downloaded ~/.kubectl_aliases"

echo
kubectl krew list
echo "Done. Restart your shell (or: source ~/.bashrc) to pick up PATH."
