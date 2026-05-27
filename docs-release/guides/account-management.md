# Account Management Guide

## 1. Purpose and scope

This document outlines the workflows related to Account Management in Sprint OS. Account Management allows you to connect AI provider accounts via API keys or Local Auth caching, ensuring the runtime can orchestrate tasks effectively.

## 2. Managing API Keys

Use API Keys for providers like Qwen, Codex, and Jules. The runtime dynamically routes the configured keys to active sessions.

### Prerequisites
- Access to the Sprint OS Dashboard (`http://localhost:4444`).
- An active API key from your chosen provider.

### Steps
1. Navigate to the Sprint OS Dashboard.
2. Click on the **Settings** menu.
3. Select the **Integrations** panel.
4. Locate the specific provider (e.g., `Qwen`, `Codex`, `Jules`).
5. Enter your valid API key in the provided field.
6. Click **Save Settings** to persist the changes. The provider is now connected for runtime orchestration.

## 3. Configuring Local Auth Caching (Docker Mounts)

For CLI-backed providers like Gemini and Claude, Sprint OS supports securely mounting your local desktop login session into the isolated Docker worker environment.

### Prerequisites
- The **CLI Workflow -> Execution Mode** must be set to `Docker`.
- The provider CLI (`gemini` or `claude`) must be installed on your host machine.
- You must have successfully logged into the provider on your host machine to generate the local cache files.

### Steps for Gemini
1. Open your host terminal and run `gemini login` to authenticate and generate local auth files.
2. In the Sprint OS Dashboard, navigate to **Settings** > **CLI Workflow**.
3. Under the Docker configuration section, verify that Gemini auth mounting is enabled.
4. Sprint OS will automatically sync your `~/.gemini/google_accounts.json` and `~/.gemini/settings.json` during the next task bootstrap.

### Steps for Claude
1. Open your host terminal and run `claude login` to authenticate.
2. Ensure the file `~/.claude/.credentials.json` is generated on your host system.
3. In the Sprint OS Dashboard, navigate to **Settings** > **CLI Workflow**.
4. Verify that Claude auth mounting is enabled.
5. Sprint OS will securely mount this file to authenticate the Docker worker during the next run.

## 4. Failure cases and troubleshooting notes

- **Claude Auth Stalls in Docker:** Verify that `~/.claude/.credentials.json` (and `~/.claude.json` if applicable) exists on your host machine. Ensure the mount settings correctly point to your Host home directory. If missing, re-run `claude login`.
- **Gemini Authorization Failures in Docker:** Ensure `~/.gemini/settings.json` and `~/.gemini/google_accounts.json` exist on the host. These files are required for the Docker bootstrap process to sync successfully.
- **Provider Fails to Initialize:** If you are relying on API keys, double-check the **Integrations** panel to ensure the key is correctly saved and not expired. For Local Auth, regenerate the local auth cache via the provider's CLI on the host.

## 5. Related links

- [Configuration and Storage](../settings/configuration-and-storage.md)
- [Provider Routing](../settings/provider-routing.md)
- [Operations Runbook](../operations/runbook.md)
