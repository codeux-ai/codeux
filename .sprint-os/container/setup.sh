#!/usr/bin/env bash
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
if ! command -v git >/dev/null 2>&1 || ! command -v gh >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1 && [ "$(id -u)" -eq 0 ]; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update
    apt-get install -y --no-install-recommends git gh
    rm -rf /var/lib/apt/lists/*
  else
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

# Provider CLIs are installed lazily by the runtime bootstrap only when the
# selected command is missing. Avoid eager global installs here so fresh
# containers can start real work quickly.
echo "[setup] gemini: $(gemini --version 2>/dev/null || echo missing; true)"
echo "[setup] codex: $(codex --version 2>/dev/null || echo missing; true)"

# Playwright is optional for general Docker task execution. Installing Chromium
# during every fresh bootstrap adds hundreds of MB of downloads and makes WSL
# startup look hung, so keep it opt-in for images that truly need browser bits.
if [ "${SPRINT_OS_INSTALL_PLAYWRIGHT:-0}" = "1" ]; then
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
else
  echo "[setup] Playwright bootstrap skipped (set SPRINT_OS_INSTALL_PLAYWRIGHT=1 to preinstall Chromium)."
fi

echo "[setup] Bootstrap complete."
