# Configuration & CLI

This page is the precise reference for every CLI flag, environment variable, and configuration file Code UX consumes.

## CLI flags

```
codeux [options]
```

| Flag | Type | Default | Description |
| --- | --- | --- | --- |
| `--api-key VALUE` | string | – | Jules API key. Highest precedence. |
| `--runtime-role VALUE` | string | `project_manager` | Role advertised to the MCP layer. (Currently only `project_manager` is functional; `worker-host` is reserved.) |
| `--headless` | flag | off | Start MCP server without binding the dashboard. |
| `--no-dashboard` | flag | off | Alias for `--headless`. |
| `--mcp-https` / `--no-mcp-https` | flag | on | MCP HTTPS worker gateway, enabled by default; use `--no-mcp-https` to disable. |
| `--mcp-https-port N` | number | `dashboardPort + 1` | Port for the HTTP gateway. |
| `--mcp-https-host H` | string | `127.0.0.1` | Host/interface for the HTTP gateway. |
| `--mcp-https-path P` | string | `/mcp` | Path for the HTTP gateway. |
| `--mcp-https-auth-token VALUE` | string | – | Bearer token. **Required** for non-loopback hosts. |
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
| `MCP_HTTPS_ENABLED` | bool | `false` | Enable the MCP HTTP gateway. |
| `MCP_HTTPS_PORT` | int | – | MCP HTTP port. |
| `MCP_HTTPS_HOST` | string | `127.0.0.1` | MCP HTTP bind. |
| `MCP_HTTPS_PATH` | string | `/mcp` | MCP HTTP path. |
| `MCP_HTTPS_AUTH_TOKEN` | string | – | Bearer token. |
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
| `settings.json` | Provider keys, override settings (read-only / informational; primary settings live in the DB). |
| `config.json` | Dashboard port and other runtime config. |
| `agents/<id>.md` | Agent preset markdown sources. |
| `sprints/sprint-<n>/` | Sprint markdown directory. |
| `sprints/sprint-<n>/<task>.md` | Subtask markdown files. |
| `sprints/sprint-<n>/preview.sh` | Preview container startup script. |

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
--mcp-https-port  >  MCP_HTTPS_PORT env  >  config.json (mcpHttpPort, MCP_HTTPS_PORT, mcpHttp.port)
                 >  dashboardPort + 1
```

### MCP HTTP host / path / auth

```
--mcp-https-host  >  MCP_HTTPS_HOST env  >  127.0.0.1
--mcp-https-path  >  MCP_HTTPS_PATH env  >  /mcp
--mcp-https-auth-token  >  MCP_HTTPS_AUTH_TOKEN env  >  unset (loopback only)
```

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
