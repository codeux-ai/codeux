# Configuration resolution

This page documents how Code UX assembles the *effective* configuration at runtime — combining CLI flags, environment variables, on-disk JSON files, and the database settings tree.

The user-facing reference for individual options is [Configuration & CLI](../developer/configuration.md). The schema reference for settings is [Settings reference](../developer/settings-reference.md). This page describes the *order of operations*.

## Three layers

Code UX has three configuration layers, each loaded at a different time:

1. **Bootstrap config** — read once at process start. Drives port binding, transport selection, API key default.
2. **Settings tree** — stored in the database, hot-reloadable, evaluated as a cascade per project/sprint.
3. **External hints** — detected from env variables and known CLI auth directories. Surfaced in the UI as "Use detected value" suggestions; never auto-applied.

## Bootstrap config

Loaded by `loadAppConfig` (`src/config/app-config.ts`) given `process.argv` and the project root. Outputs an `AppConfig` consumed by the `JulesAgentServer` constructor.

### Resolution order (per field)

| Field | Source order |
| --- | --- |
| `apiKey` | `--api-key` CLI → `JULES_API_KEY` env → `JULES_KEY` env → `settings.json` (julesApiKey / JULES_API_KEY / julesKey / JULES_KEY) → unset |
| `dashboardPort` | `DASHBOARD_PORT` env → `config.json` (dashboardPort / DASHBOARD_PORT / dashboard.port / dashboard.dashboardPort) → `4444` |
| `mcpHttp.enabled` | `--mcp-http` CLI → `MCP_HTTP_ENABLED` env → `false` |
| `mcpHttp.port` | `--mcp-http-port` CLI → `MCP_HTTP_PORT` env → `config.json` (mcpHttpPort / MCP_HTTP_PORT / mcpHttp.port) → `dashboardPort + 1` |
| `mcpHttp.host` | `--mcp-http-host` CLI → `MCP_HTTP_HOST` env → `127.0.0.1` |
| `mcpHttp.path` | `--mcp-http-path` CLI → `MCP_HTTP_PATH` env → `/mcp` |
| `mcpHttp.authToken` | `--mcp-http-auth-token` CLI → `MCP_HTTP_AUTH_TOKEN` env → unset |
| `runtimeRole` | `--runtime-role` CLI → `project_manager` |
| `headless` | `--headless` or `--no-dashboard` CLI → `false` |

### Config search path

For `settings.json` and `config.json`, paths are tried in priority order:

1. The `repoPath` of the active project (when a project context is established).
2. Current working directory: `./.code-ux/`.
3. Project root (where `package.json` is): `<root>/.code-ux/`.
4. Home directory: `~/.code-ux/`.

> Legacy: `.jules-subagents/` is also probed at each location for backwards compatibility. New installs should use `.code-ux/`.

The first file found at each path *wins for its specific key*. There is **no merging across paths** — finding `julesApiKey` in `~/.code-ux/settings.json` ends the search for that key, even if other paths exist.

### `.env` loading

`dotenv` loads `<projectRoot>/.env` very early (before any config resolution). This means any of the above env-driven fields can be set in `.env` and behave identically.

## Settings tree

After bootstrap, Code UX loads the settings tree from the database. Three tables:

- `system_settings` (singleton).
- `project_settings_overrides` (one row per project, sparse JSON).
- `sprint_settings_overrides` (one row per sprint, sparse JSON).

### Cascade

For any field, the effective value at sprint scope is:

```
defaults  →  system  →  project  →  sprint
```

A field unspecified at higher scopes inherits from lower scopes. The merge is **deep** for object-valued fields (e.g. `aiProvider.providers.codex` only overrides the keys you set, not the whole object).

### Where defaults live

`src/repositories/settings-defaults.ts`:

- `DEFAULT_PROVIDER_SETTINGS` — per-provider defaults.
- `DEFAULT_SKILLS`, `DEFAULT_MCP_TOOL_TOGGLES`, etc.
- `DEFAULT_SPRINT_BRANCH_SCHEME`.

System settings on a fresh install are the merge of these defaults plus any external hints applied by the user during onboarding.

### Live reload

Settings changes via `manage_code_ux` → `settings` → `patch_*_setting` (or the corresponding REST endpoints) trigger:

- A WebSocket event broadcasting the change.
- Hot-reload of the relevant subscribers (e.g. the orchestrator picks up new `watchLoopIntervalSeconds` on the next cycle).

There is no need to restart the process for settings changes.

### Effective resolution endpoints

- `GET /api/projects/:projectId/settings/effective` — merged at project scope.
- `GET /api/projects/:projectId/sprints/:sprintId/settings/effective` — merged at sprint scope.
- `manage_code_ux` → `settings` → `resolve_project_effective` / `resolve_sprint_effective`.

These return the full merged tree, useful for debugging "why is this setting taking that value?".

## External hints

`src/config/external-settings.ts` inspects:

- `JULES_API_KEY`, `JULES_KEY` — Jules.
- `~/.gemini/` — Gemini CLI auth.
- `OPENAI_API_KEY`, `~/.codex/` — Codex CLI.
- `ANTHROPIC_API_KEY`, `~/.claude/` — Claude Code CLI.
- `QWEN_API_KEY`, `~/.qwen/` — Qwen Code CLI.
- `~/.local/share/opencode/`, `~/.config/opencode/` — OpenCode CLI.
- `GITHUB_TOKEN`, `GH_TOKEN`, `gh auth status` — GitHub.

Hints are exposed through `GET /api/settings/import-sources`. The Settings → AI providers panel shows a **Detected** badge when a hint is available and a one-click button to copy the value into the corresponding settings field.

Hints are *never* applied automatically — this is a deliberate design choice to avoid surprising users with credentials that may be wrong or out of date.

## Validation

All settings writes pass through:

1. **TypeScript** type checking at the call site.
2. **AJV** runtime schema validation (against `SystemSettings`, `ProjectSettingsOverride`, `SprintSettingsOverride` schemas).
3. **Custom rules** (e.g. `watchLoopIntervalSeconds` in `[1, 3600]`).

Invalid writes are rejected atomically with a precise JSON path in the error.

## Database backend

The default backend is **SQLite** at `~/.code-ux/database.sqlite`. A migration plan to Postgres exists; when shipped, it will be controlled by an env variable (`DATABASE_URL` or similar). The repository layer abstracts the backend so switching is mechanical.

## Reset semantics

- **Per-project reset** (`reset_project_settings`) clears the project's override row; effective values revert to `system → defaults`.
- **Per-sprint reset** (`reset_sprint_settings`) clears the sprint's override; effective values revert to `project → system → defaults`.
- **System reset** (no dedicated action; use `replace_system_settings` with a default tree) requires explicit replacement.
- **Database reset** (`POST /api/system/reset-database`) wipes everything; use only as a last resort.
