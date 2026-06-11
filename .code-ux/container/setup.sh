#!/usr/bin/env bash
# Force rebuild version: 2026-05-31-002
set -euo pipefail

echo "[setup] Starting container bootstrap..."

if ! command -v npm >/dev/null 2>&1; then
  echo "[setup] npm is required but was not found in PATH."
  exit 1
fi

echo "[setup] npm: $(npm --version)"

# Refresh npm only when explicitly requested. Reinstalling npm on every cold start
# adds network-dependent latency before the actual container workload begins.
if [ "${SPRINT_OS_REFRESH_NPM:-0}" = "1" ]; then
  npm install -g npm@latest
  echo "[setup] npm (updated): $(npm --version)"
else
  echo "[setup] npm refresh skipped (set SPRINT_OS_REFRESH_NPM=1 to force an update)."
fi

# Ensure git + gh CLI exist for workflows that shell out to Git/GitHub.
if command -v apt-get >/dev/null 2>&1 && [ "$(id -u)" -eq 0 ]; then
  pkgs_needed=()
  command -v git >/dev/null 2>&1 || pkgs_needed+=(git)
  command -v gh  >/dev/null 2>&1 || pkgs_needed+=(gh)
  command -v dbus-daemon >/dev/null 2>&1 || pkgs_needed+=(dbus)
  command -v gnome-keyring-daemon >/dev/null 2>&1 || pkgs_needed+=(gnome-keyring)
  dpkg -s libsecret-1-0 >/dev/null 2>&1 || pkgs_needed+=(libsecret-1-0)
  command -v xdg-open >/dev/null 2>&1 || pkgs_needed+=(xdg-utils)
  if [ "${#pkgs_needed[@]}" -gt 0 ]; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update || true
    apt-get install -y --no-install-recommends "${pkgs_needed[@]}" || {
      echo "[setup] WARNING: collective apt-get install failed, attempting individual installs..."
      for pkg in "${pkgs_needed[@]}"; do
        apt-get install -y --no-install-recommends "$pkg" || echo "[setup] WARNING: failed to install package: $pkg"
      done
    }
    rm -rf /var/lib/apt/lists/* || true
  fi
else
  if ! command -v git >/dev/null 2>&1 || ! command -v gh >/dev/null 2>&1; then
    echo "[setup] NOTE: git/gh missing but cannot install automatically (no root/apt-get)."
  fi
fi

echo "[setup] git: $(git --version 2>/dev/null || echo missing)"
echo "[setup] gh: $(gh --version 2>/dev/null | head -n 1 || echo missing)"

# Keep pnpm available even on slim images.
if command -v corepack >/dev/null 2>&1; then
  if [ "$(id -u)" -eq 0 ]; then
    corepack enable || true
    if ! corepack prepare pnpm@latest --activate; then
      npm install -g pnpm
    fi
  else
    npm install -g pnpm
  fi
else
  npm install -g pnpm
fi

echo "[setup] pnpm: $(pnpm --version)"

# Pre-install all provider CLIs so the cached image always has them available.
# The runtime bootstrap still runs per-provider fallback installs as a safety
# net, but those will be no-ops for any CLI already present here.

# npm-distributed CLIs
if ! command -v gemini >/dev/null 2>&1; then
  echo "[setup] Installing @google/gemini-cli..."
  npm install -g @google/gemini-cli || echo "[setup] WARNING: failed to install @google/gemini-cli"
fi

if ! command -v codex >/dev/null 2>&1; then
  echo "[setup] Installing @openai/codex..."
  npm install -g @openai/codex || echo "[setup] WARNING: failed to install @openai/codex"
fi

if ! command -v qwen >/dev/null 2>&1; then
  echo "[setup] Installing @qwen-code/qwen-code..."
  npm install -g @qwen-code/qwen-code || echo "[setup] WARNING: failed to install @qwen-code/qwen-code"
fi

# Claude Code CLI (installs to ~/.local/bin as non-root, /usr/local/bin as root)
if ! command -v claude >/dev/null 2>&1; then
  if command -v curl >/dev/null 2>&1; then
    echo "[setup] Installing Claude Code CLI..."
    curl -fsSL https://claude.ai/install.sh | bash || echo "[setup] WARNING: failed to install Claude Code CLI"
    if [ -f "$HOME/.local/bin/claude" ]; then
      cp -f "$HOME/.local/bin/claude" /usr/local/bin/claude || true
    fi
    export PATH="$HOME/.local/bin:$PATH"
  else
    echo "[setup] NOTE: curl not found; skipping Claude Code CLI install."
  fi
fi

# OpenCode CLI
if ! command -v opencode >/dev/null 2>&1; then
  if command -v curl >/dev/null 2>&1; then
    echo "[setup] Installing OpenCode CLI..."
    curl -fsSL https://opencode.ai/install | bash || echo "[setup] WARNING: failed to install OpenCode CLI"
    if [ -f "$HOME/.opencode/bin/opencode" ]; then
      cp -f "$HOME/.opencode/bin/opencode" /usr/local/bin/opencode || true
    elif [ -f "$HOME/.local/bin/opencode" ]; then
      cp -f "$HOME/.local/bin/opencode" /usr/local/bin/opencode || true
    fi
    export PATH="$HOME/.opencode/bin:$HOME/.local/bin:$PATH"
  else
    echo "[setup] NOTE: curl not found; skipping OpenCode CLI install."
  fi
fi

# Antigravity CLI
if ! command -v agy >/dev/null 2>&1; then
  if command -v curl >/dev/null 2>&1; then
    echo "[setup] Installing Antigravity CLI..."
    curl -fsSL https://antigravity.google/cli/install.sh | bash || echo "[setup] WARNING: failed to install Antigravity CLI"
    if [ -f "$HOME/.local/bin/agy" ]; then
      cp -f "$HOME/.local/bin/agy" /usr/local/bin/agy || true
    fi
    export PATH="$HOME/.local/bin:$PATH"
  else
    echo "[setup] NOTE: curl not found; skipping Antigravity CLI install."
  fi
fi

echo "[setup] gemini:      $(gemini --version 2>/dev/null || echo missing; true)"
echo "[setup] codex:       $(codex --version 2>/dev/null || echo missing; true)"
echo "[setup] claude:      $(claude --version 2>/dev/null || echo missing; true)"
echo "[setup] qwen:        $(qwen --version 2>/dev/null || echo missing; true)"
echo "[setup] opencode:    $(opencode --version 2>/dev/null || echo missing; true)"
echo "[setup] antigravity: $(agy --version 2>/dev/null || echo missing; true)"

# Playwright is optional for general Docker task execution. Installing Chromium
# during every fresh bootstrap adds hundreds of MB of downloads and makes WSL
# startup look hung, so keep it opt-in for images that truly need browser bits.

if [ -z "${PLAYWRIGHT_BROWSERS_PATH:-}" ]; then
  if [ "$(id -u)" -eq 0 ]; then
    export PLAYWRIGHT_BROWSERS_PATH="/ms-playwright"
  else
    export PLAYWRIGHT_BROWSERS_PATH="$HOME/.cache/ms-playwright"
  fi
fi
mkdir -p "${PLAYWRIGHT_BROWSERS_PATH}"

if compgen -G "${PLAYWRIGHT_BROWSERS_PATH}/chromium-*" > /dev/null; then
  echo "[setup] Playwright Chromium already present in ${PLAYWRIGHT_BROWSERS_PATH}."
else
  echo "[setup] Installing Playwright Chromium + dependencies..."
  if command -v apt-get >/dev/null 2>&1 && [ "$(id -u)" -eq 0 ]; then
    npx -y playwright@latest install --with-deps chromium
  else
    npx -y playwright@latest install chromium
    echo "[setup] NOTE: Skipped OS dependency install (no root/apt-get)."
  fi
fi


echo "[setup] Bootstrap complete."
