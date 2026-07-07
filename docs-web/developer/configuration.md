# Configuration & CLI

This page is the precise reference for every CLI flag, environment variable, and configuration file Code UX consumes.

## CLI flags

```
codeux [options]
```

| Flag | Type | Default | Description |
| --- | --- | --- | --- |
| `--api-key VALUE` | string | – | Jules API key. Highest precedence. |
| `--runtime-role VALUE` | string | `project_manager` | Role advertised to the MCP layer. `project_manager` is the main server role; `worker-host` is used by the local execution runtime started by `codeux-worker`. |
| `--headless` | flag | off | Start MCP server without binding the dashboard. |
| `--no-dashboard` | flag | off | Alias for `--headless`. |
| `--server-mode` | flag | off | Start authenticated MCP HTTP server mode without binding dashboard routes or websockets. Requires an explicit bearer token. |
| `--no-mcp-http` | flag | off | Preferred flag for disabling the MCP Streamable HTTP gateway outside server mode. |
| `--mcp-https` / `--no-mcp-https` | flag | on | MCP Streamable HTTP gateway, enabled by default; use `--no-mcp-https` to disable. |
| `--mcp-http-port N` | number | `dashboardPort + 1` | Preferred HTTP gateway port flag. |
| `--mcp-https-port N` | number | `dashboardPort + 1` | Port for the HTTP gateway. |
| `--mcp-http-host H` | string | platform dependent | Preferred HTTP gateway host/interface flag. |
| `--mcp-https-host H` | string | `127.0.0.1` | Host/interface for the HTTP gateway. |
| `--mcp-http-path P` | string | `/mcp` | Preferred HTTP gateway path flag. |
| `--mcp-https-path P` | string | `/mcp` | Path for the HTTP gateway. |
| `--mcp-http-auth-token VALUE` | string | auto-generated user token | Preferred bearer token flag. |
| `--mcp-https-auth-token VALUE` | string | auto-generated user token | Bearer token. Overrides the generated token stored in `~/.code-ux/security.json`. |
| `--mcp-http-max-sessions N` | number | `100` | Preferred active Streamable HTTP session cap flag. |
| `--mcp-http-session-timeout-ms N` | number | `3600000` | Preferred idle Streamable HTTP session timeout flag. |
| `--help`, `-h` | flag | – | Show help. |

Flags can be passed in any order. Anything after `--` is ignored.

## Environment variables

| Variable | Type | Default | Used for |
| --- | --- | --- | --- |
| `JULES_API_KEY` | string | – | Jules API key (primary). |
| `JULES_KEY` | string | – | Jules API key (fallback). |
| `JULES_API_BASE_URL` | URL | `https://jules.googleapis.com/v1alpha` | Override the Jules API endpoint. |
| `JULES_API_MAX_FAILS` | int | `5` | Emergency-stop threshold (`maxFailures`). |
| `DASHBOARD_PORT` | int | `4444` | Dashboard HTTP port. |
| `DASHBOARD_HOST` | string | `127.0.0.1` | Dashboard bind address. |
| `CODE_UX_SERVER_MODE` | bool | `false` | Enable authenticated MCP HTTP server mode and disable dashboard binding. |
| `MCP_HTTP_ENABLED` | bool | `true` | Preferred MCP HTTP gateway enablement variable. |
| `MCP_HTTPS_ENABLED` | bool | `true` | Enable the MCP HTTP gateway. |
| `MCP_HTTP_PORT` | int | – | Preferred MCP HTTP port variable. |
| `MCP_HTTPS_PORT` | int | – | MCP HTTP port. |
| `MCP_HTTP_HOST` | string | platform dependent | Preferred MCP HTTP bind variable. |
| `MCP_HTTPS_HOST` | string | `127.0.0.1` | MCP HTTP bind. |
| `MCP_HTTP_PATH` | string | `/mcp` | Preferred MCP HTTP path variable. |
| `MCP_HTTPS_PATH` | string | `/mcp` | MCP HTTP path. |
| `MCP_HTTP_AUTH_TOKEN` | string | auto-generated user token | Preferred bearer token variable. |
| `MCP_HTTPS_AUTH_TOKEN` | string | auto-generated user token | Bearer token. |
| `MCP_HTTP_MAX_SESSIONS` | int | `100` | Preferred active Streamable HTTP session cap variable. |
| `MCP_HTTP_SESSION_TIMEOUT_MS` | int | `3600000` | Preferred idle Streamable HTTP session timeout variable. |
| `CODE_UX_WORKER_SERVER_URL` | URL | – | Server-mode MCP URL consumed by `codeux-worker`. |
| `CODE_UX_WORKER_AUTH_TOKEN` | string | – | Worker bearer token, preferred over legacy MCP token env names for `codeux-worker`. |
| `GITHUB_TOKEN` / `GH_TOKEN` | string | – | GitHub PAT for `REMOTE` GitHub mode. |
| `NODE_ENV` | string | – | Affects logging verbosity. `test` enables test mode. |

`.env` files are loaded automatically from the project root if present.

## Config search path

Code UX looks for a `.code-ux/` directory at multiple locations and merges what it finds. Priority highest first:

1. `repoPath` (if a project specifies one).
2. Current working directory: `./.code-ux/`
3. Project root (where `package.json` lives): `<root>/.code-ux/`
4. Home directory: `~/.code-ux/`

> Legacy: `.jules-subagents/` is also scanned for backwards compatibility. New installations should use `.code-ux/`.

Files inside the directory:

| File | Contents |
| --- | --- |
| `settings.json` | Provider keys, override settings (read-only / informational; primary settings live in the SQLite DB `settings.db`). |
| `config.json` | Dashboard port and other runtime config. |
| `agents/<id>.md` | Agent preset markdown sources. |
| `sprints/sprint-<n>/` | Sprint markdown directory. |
| `sprints/sprint-<n>/<task>.md` | Subtask markdown files. |
| `sprints/sprint-<n>/preview.sh` | Preview container startup script. Default is `.code-ux/browser/start-preview.sh`. |

Note: `git.defaultBranch` defaults to `main` but resolves through scoped overrides (project/sprint).

## Resolution rules

### Jules API key

```
--api-key  >  JULES_API_KEY env  >  JULES_KEY env
        >  settings.json (any of julesApiKey, JULES_API_KEY, julesKey, JULES_KEY)
        >  unset
```

### Dashboard port

```
DASHBOARD_PORT env  >  config.json (dashboardPort, DASHBOARD_PORT, dashboard.port, dashboard.dashboardPort)
                    >  4444
```

If the chosen port is in use, Code UX increments and retries until it finds a free port (up to 65535) and logs the bound URL.

### MCP HTTP port

```
--mcp-http-port / --mcp-https-port  >  MCP_HTTP_PORT / MCP_HTTPS_PORT env
                                       >  config.json (mcpHttpPort, MCP_HTTP_PORT, mcpHttp.port, mcpHttps.port)
                 >  dashboardPort + 1
```

### MCP HTTP host / path / auth

```
--mcp-http-host / --mcp-https-host  >  MCP_HTTP_HOST / MCP_HTTPS_HOST env  >  platform default
--mcp-http-path / --mcp-https-path  >  MCP_HTTP_PATH / MCP_HTTPS_PATH env  >  /mcp
--mcp-http-auth-token / --mcp-https-auth-token  >  MCP_HTTP_AUTH_TOKEN / MCP_HTTPS_AUTH_TOKEN env
                                                 >  ~/.code-ux/security.json auto-generated token
```

Server mode requires the token to come from the explicit CLI/env sources and rejects startup when the token is empty.

The MCP listener is authenticated HTTP. The historical `mcp-https` option names remain supported for compatibility, but TLS requires a trusted reverse proxy/certificate in front of the listener.

## Server mode and worker configuration

`--server-mode` and `CODE_UX_SERVER_MODE=true` disable the dashboard listener and force authenticated MCP HTTP to remain available. The process serves `/health` and `/ready` on the MCP listener and requires an explicit bearer token with at least 32 bearer-safe characters.

`codeux-worker` reads `--server-url` and `--auth-token`, then falls back to `CODE_UX_WORKER_SERVER_URL` and `CODE_UX_WORKER_AUTH_TOKEN`. Legacy `MCP_HTTP_AUTH_TOKEN` and `MCP_HTTPS_AUTH_TOKEN` are also accepted for worker auth token fallback. Repeat `--project-id` for multi-project workers and use a stable `--connection-key` to update the same registered endpoint across reconnects.

See [User Guide → Connecting MCP clients](../user/mcp-clients.md#secure-headless-server-mode) for startup commands, client verification, settings synchronization, token rotation, and cluster troubleshooting.

## External settings hints

On boot, Code UX inspects:

- **Jules** — `JULES_API_KEY` env, `~/.code-ux/settings.json`.
- **Gemini** — `GEMINI_API_KEY` env, `~/.gemini/`.
- **Codex** — `OPENAI_API_KEY` env, `~/.codex/`.
- **Claude Code** — `ANTHROPIC_API_KEY` env, `~/.claude/`.
- **Qwen Code** — `QWEN_API_KEY` env, `~/.qwen/`.
- **OpenCode** — `~/.local/share/opencode/`, `~/.config/opencode/`.
- **GitHub** — `GITHUB_TOKEN` / `GH_TOKEN` env, `gh auth status`.

Detected hints surface in **Settings → AI providers** as **Use detected value** buttons. They are *never* automatically applied.

## Reset / migration

- `.code-ux/` directories are migrated automatically from any `.jules-subagents/` siblings on first run.
- `POST /api/system/reset-database` clears the DB but preserves on-disk markdown, allowing re-import.
- Manual reset: stop the server, `rm -rf ~/.code-ux/database.sqlite`, restart.

## Logging

Code UX emits structured JSON logs to stdout. Log levels respect `NODE_ENV`:

- `production` → `info` and above.
- `development` (default) → `debug` and above.
- `test` → `warn` and above.

Each log line includes a `correlationId`. Cycles, dispatches, and HTTP requests propagate their correlation IDs so you can grep across the whole pipeline.
