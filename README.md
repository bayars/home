Tmux, and Vim configuration for my setups

- `vim-source.sh` – build Vim from source
- `krew-install.sh` – install kubectl krew + popular plugins

## macOS / Ghostty

When you SSH to a server, Ghostty's terminal type (`xterm-ghostty`) may be
unknown there. If you see `unknown terminal type`, add this to your Ghostty
config (`~/.config/ghostty/config`):

```
shell-integration-features = ssh-terminfo
```
