Tmux, and Vim configuration for my setups

- `vim-source.sh` – build Vim from source
- `krew-install.sh` – install kubectl krew + popular plugins

## Vim requirements

After copying `.vimrc`, open Vim and run `:PlugInstall` to install plugins
(including `vim-tmux-navigator`, which provides `Ctrl-h/j/k/l`).

Vim must be built with clipboard support (`vim --version | grep clipboard`
shows `+clipboard`). On macOS the built-in `/usr/bin/vim` doesn't have it;
use `brew install vim`.

ALE uses these external tools for linting and formatting. Any that aren't
installed are skipped silently.

| File type  | Linters                                  | Fix on save            |
|------------|------------------------------------------|------------------------|
| YAML       | `yamllint`, `yaml-language-server` (Kubernetes schema) | –        |
| Ansible    | `yamllint`                               | –                      |
| Dockerfile | `hadolint`                               | –                      |
| Terraform  | `tflint`                                 | `terraform fmt`        |
| Shell      | `shellcheck`                             | `shfmt`                |
| Python     | `flake8`, `mypy`                         | `black`                |
| Go         | `gopls`                                  | `gofmt`                |
| JavaScript | `eslint`                                 | `prettier`             |

Install the DevOps ones:

```sh
# macOS
brew install vim yamllint hadolint tflint shellcheck shfmt
npm install -g yaml-language-server

# Debian / Ubuntu
sudo apt install yamllint shellcheck shfmt
npm install -g yaml-language-server
# hadolint: https://github.com/hadolint/hadolint/releases
# tflint:   https://github.com/terraform-linters/tflint#installation
```

## macOS / Ghostty

When you SSH to a server, Ghostty's terminal type (`xterm-ghostty`) may be
unknown there. If you see `unknown terminal type`, add this to your Ghostty
config (`~/.config/ghostty/config`):

```
shell-integration-features = ssh-terminfo
```
