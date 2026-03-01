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

# Ensure provider CLIs are present for Docker execution mode.
npm install -g @google/gemini-cli @openai/codex
echo "[setup] gemini: $(gemini --version 2>/dev/null || true)"
echo "[setup] codex: $(codex --version 2>/dev/null || true)"

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
