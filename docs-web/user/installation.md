# Installation

Code UX runs entirely on your machine. You can install it as a **desktop app** or build it from
**source** — both ship the same runtime, dashboard, and MCP server. You can
install and start Code UX with **no configuration**; providers are set up later from the dashboard.

## Prerequisites

| Requirement | Needed for | Notes |
| --- | --- | --- |
| **Node.js 22+** | Source installs | Not required for the desktop app, which bundles its own runtime. |
| **Docker** | Containerized (default) execution and preview containers | Recommended. Without it, run providers in host mode. |
| **Git ≥ 2.30** | All project work | Code UX manages branches, worktrees, and merges. |
| **An agent provider** | Dispatching work | At least one of Jules, Claude Code, Codex, Gemini, Qwen Code, OpenCode, or Antigravity. See [Providers and models](./providers-and-models.md). |
| **GitHub CLI (`gh`)** | Remote merge protocol *(optional)* | Used when GitHub operations run in remote mode. |

## Option 1 — Desktop app (recommended)

Download the latest installer for your platform from
[GitHub Releases](https://github.com/codeux-ai/codeux/releases/latest):

| Platform | Artifact |
| --- | --- |
| **Windows** | `Code-UX-<version>-win-x64.exe` |
| **macOS** (Apple Silicon) | `Code-UX-<version>-mac-arm64.dmg` (or `.zip`) |
| **Linux** | `Code-UX-<version>-linux-x86_64.AppImage`, `…-linux-amd64.deb`, or `…-linux-x64.tar.gz` |

> On Windows, SmartScreen may warn that the publisher is unrecognized because the build is not yet
> code-signed. Choose **More info → Run anyway**. Only do this for builds downloaded from the official
> releases page.

The desktop app launches the runtime and opens the dashboard automatically.

## Option 2 — From source

Use a source build to develop Code UX itself or inspect the runtime. Requires Node.js 22+ and
pnpm 10.33+.

```bash
git clone https://github.com/codeux-ai/codeux.git
cd codeux
pnpm install
pnpm run build
pnpm start
```

See [Building from source](../developer/building-from-source.md) for the full developer workflow.

## First run

When Code UX starts it:

1. Serves the dashboard at `http://localhost:4444`.
2. Exposes an **MCP server** (over stdio, plus an authenticated Streamable HTTP gateway).
3. Loads any settings it finds, then waits for you to add a project and configure providers.

Nothing is required to reach this point — no API keys, no environment variables. Configure providers
when you are ready to dispatch work (see [Configuring providers](#configuring-providers)).

## CLI flags

Run `codeux --help` for the authoritative list. The current flags are:

| Flag | Description |
| --- | --- |
| `--api-key VALUE` | Set the Jules API key (overrides env and settings). |
| `--runtime-role VALUE` | Runtime role: `project_manager` (default) or `worker-host`. |
| `--headless` (alias `--no-dashboard`) | Start MCP-only without binding the dashboard. |
| `--server-mode` | Start authenticated MCP HTTP server mode without binding dashboard routes or websockets. Requires an explicit bearer token. |
| `--mcp-https` / `--no-mcp-https` | Enable/disable the MCP Streamable HTTP gateway (**enabled by default**; legacy flag name). |
| `--mcp-https-port N` | Port for the MCP HTTP gateway. |
| `--mcp-https-host H` | Host/interface for the MCP HTTP gateway. |
| `--mcp-https-path P` | Path for the MCP HTTP gateway (default `/mcp`). |
| `--mcp-https-auth-token VALUE` | Bearer token for MCP HTTP requests; overrides the generated user token. |
| `--help`, `-h` | Show help. |

## Environment variables

| Variable | Description |
| --- | --- |
| `JULES_API_KEY` | Jules API key (also accepted as `JULES_KEY`). |
| `DASHBOARD_PORT` | Dashboard port (default `4444`). |
| `CODE_UX_SERVER_MODE` | Set to `true` for authenticated MCP HTTP server mode without dashboard binding. Requires an explicit bearer token. |
| `MCP_HTTPS_ENABLED` | Enable the MCP HTTP gateway (default `true`). |
| `MCP_HTTPS_PORT` | Port for the MCP HTTP gateway. |
| `MCP_HTTPS_HOST` | Host/interface for the MCP HTTP gateway. |
| `MCP_HTTPS_PATH` | Path for the MCP HTTP gateway. |
| `MCP_HTTPS_AUTH_TOKEN` | Bearer token for MCP HTTP requests; if unset, Code UX creates `~/.code-ux/security.json`. |

In server mode, `MCP_HTTPS_AUTH_TOKEN`, `MCP_HTTP_AUTH_TOKEN`, `--mcp-https-auth-token`, or `--mcp-http-auth-token` must be non-empty. Server mode does not fall back to the generated user token.

A project-local `.env` file is read on startup, so you can keep settings per repository:

```bash
# .env
DASHBOARD_PORT=4444
JULES_API_KEY=...        # only if you use the hosted Jules provider
```

## Configuring providers

Code UX needs at least one provider to dispatch work. Configure them from **Settings → Providers** in
the dashboard:

- **Jules** (hosted) uses an API key. Set it in the dashboard, via `--api-key`, or via
  `JULES_API_KEY`.
- **Local CLI providers** (Claude Code, Codex, Gemini, Qwen Code, OpenCode, Antigravity) use their own
  CLI login. Install and authenticate the provider's CLI, and Code UX detects local auth at:

| Provider | Detected at |
| --- | --- |
| Gemini CLI | `~/.gemini/` |
| Codex CLI | `~/.codex/` |
| Claude Code CLI | `~/.claude/` |
| Qwen Code CLI | `~/.qwen/` |
| OpenCode CLI | `~/.local/share/opencode/` or `~/.config/opencode/` |

When running providers in Docker, enable auth mounting per provider so the worker container can use
your local credentials. See [Providers and models](./providers-and-models.md) for routing and model
configuration.

## Settings files

Beyond the dashboard, Code UX reads JSON settings from a `.code-ux/` directory in the config search
path (project and home directory). For example:

```jsonc
// ~/.code-ux/settings.json
{
  "julesApiKey": "..."
}
```

See [Configuration](../developer/configuration.md) for the full search path and precedence rules.

## Updating

```bash
# source
git pull
pnpm install
pnpm run build

# desktop app
# download and run the latest installer from GitHub Releases
```

## Uninstall

```bash
# source
rm -rf ~/.code-ux
```

This removes the home-directory settings. Project-local `.code-ux/` directories are
left in place — remove them per project if you no longer need them.
