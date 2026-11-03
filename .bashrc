# ~/.bashrc - portable (Linux + macOS)

# Only for interactive shells
case $- in *i*) ;; *) return ;; esac

# ------------------------------
# History / shell options
# ------------------------------
HISTCONTROL=ignoreboth
HISTSIZE=10000
HISTFILESIZE=20000
shopt -s histappend checkwinsize

# ------------------------------
# PATH
# ------------------------------
for d in "$HOME/.local/bin" "$HOME/go/bin" "${KREW_ROOT:-$HOME/.krew}/bin"; do
  [ -d "$d" ] && case ":$PATH:" in *":$d:"*) ;; *) PATH="$d:$PATH" ;; esac
done
export PATH

export EDITOR=vim VISUAL=vim

# ------------------------------
# ls colors (GNU vs BSD/macOS)
# ------------------------------
if ls --color=auto / >/dev/null 2>&1; then
  alias ls='ls --color=auto'
else
  export CLICOLOR=1
fi
alias ll='ls -lh'
alias la='ls -lAh'

# ------------------------------
# Bash completion
# ------------------------------
if [ -r /usr/share/bash-completion/bash_completion ]; then
  . /usr/share/bash-completion/bash_completion
elif command -v brew >/dev/null 2>&1 && [ -r "$(brew --prefix)/etc/profile.d/bash_completion.sh" ]; then
  . "$(brew --prefix)/etc/profile.d/bash_completion.sh"
fi

# ------------------------------
# kubectl
# ------------------------------
if command -v kubectl >/dev/null 2>&1; then
  source <(kubectl completion bash)

  # https://github.com/ahmetb/kubectl-aliases (k, kgpo, kgdep, krm, ...)
  # Downloaded to ~/.kubectl_aliases by krew-install.sh
  [ -f ~/.kubectl_aliases ] && source ~/.kubectl_aliases
  alias k='kubectl'
  complete -o default -F __start_kubectl k

  # Shortcuts for krew plugins (see krew-install.sh)
  alias kctx='kubectl ctx'
  alias kns='kubectl ns'
  alias kneat='kubectl neat'
  alias ktree='kubectl tree'
  alias klogs='kubectl stern'
  alias ksecret='kubectl view-secret'
  alias kcap='kubectl resource-capacity'
  alias kwho='kubectl whoami'
fi

# ------------------------------
# Machine-specific overrides (not in git)
# ------------------------------
[ -f ~/.bashrc.local ] && . ~/.bashrc.local
