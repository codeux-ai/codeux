# syntax=docker/dockerfile:1.7
FROM node:26-trixie-slim@sha256:715e55e4b84e4bb0ff48e49b398a848f08e55daed8eb6a0ea1839ae53bc57583 AS base

LABEL org.opencontainers.image.source="https://github.com/codeux-ai/codeux"
LABEL org.opencontainers.image.title="Code UX managed runtime"
LABEL ai.codeux.runtime-abi="1"
LABEL ai.codeux.role="base"

ENV DEBIAN_FRONTEND=noninteractive \
    npm_config_update_notifier=false \
    npm_config_fund=false \
    npm_config_audit=false

RUN apt-get update -qy \
    && apt-get install -qy --no-install-recommends \
      bash build-essential ca-certificates cmake curl dbus file fd-find gh git \
      gnome-keyring jq less libsecret-1-0 locales lsof make nano netcat-openbsd \
      openssh-client patch pkg-config procps python3 python3-pip python3-venv \
      ripgrep rsync shellcheck sqlite3 sudo tar tree unzip wget xdg-utils xz-utils zip \
    && ln -sf /usr/bin/fdfind /usr/local/bin/fd \
    && rm -rf /var/lib/apt/lists/* /tmp/*

ARG NPM_VERSION=12.0.1
ARG PNPM_VERSION=11.13.1
ARG YARN_VERSION=1.22.22
ARG BUN_VERSION=1.3.14
ARG SERVE_VERSION=14.2.6

RUN npm install --global "npm@${NPM_VERSION}" \
    && npm install --global \
      "pnpm@${PNPM_VERSION}" \
      "bun@${BUN_VERSION}" \
      "serve@${SERVE_VERSION}" \
      --allow-scripts=bun \
    && test "$(yarn --version)" = "${YARN_VERSION}" \
    && npm cache clean --force \
    && rm -rf /tmp/*

FROM base AS browser

ARG PLAYWRIGHT_VERSION=1.61.1
ARG PLAYWRIGHT_MCP_VERSION=0.0.78

LABEL ai.codeux.role="browser" \
      ai.codeux.playwright-version="${PLAYWRIGHT_VERSION}"

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

RUN npm install --global \
      "playwright@${PLAYWRIGHT_VERSION}" \
      "@playwright/mcp@${PLAYWRIGHT_MCP_VERSION}" \
    && mkdir -p "${PLAYWRIGHT_BROWSERS_PATH}" \
    && playwright install-deps chromium \
    && apt-get install -qy --no-install-recommends xauth \
    && chmod -R a+rX "${PLAYWRIGHT_BROWSERS_PATH}" \
    && npm cache clean --force \
    && rm -rf /var/lib/apt/lists/* /tmp/*
