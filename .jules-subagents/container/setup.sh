#!/usr/bin/env bash
set -euo pipefail

echo "[setup] Starting container bootstrap..."

if ! command -v npm >/dev/null 2>&1; then
  echo "[setup] npm is required but was not found in PATH."
  exit 1
fi

echo "[setup] npm: $(npm --version)"

# Refresh npm so base image pinning does not leave old CLI behavior.
npm install -g npm@latest
echo "[setup] npm (updated): $(npm --version)"

# Ensure git + gh + keyring CLI exist for workflows that shell out to Git/GitHub.
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

# Ensure provider CLIs are present for Docker execution mode.
npm install -g @google/gemini-cli @openai/codex
echo "[setup] gemini: $(gemini --version 2>/dev/null || true)"
echo "[setup] codex: $(codex --version 2>/dev/null || true)"

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
echo "[setup] antigravity: $(agy --version 2>/dev/null || true)"

# Cache browsers at a stable path for image layer reuse.
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-/ms-playwright}"
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
