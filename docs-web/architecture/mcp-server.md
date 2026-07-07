# MCP server internals

The MCP server is the protocol-level interface between MCP clients (Gemini CLI, Codex CLI, Claude Desktop, custom integrations) and Code UX's services.

This page documents the transports, the tool registry, the request routing path, and the session model.

## Server identity

- **Name:** `code-ux` (constant `CODE_UX_SERVICE_NAME`).
- **Version:** The current installed package version.
- **Capabilities:** `tools`, `resources`, `prompts`.

The capabilities object is empty (no specific tool/resource caps); it merely advertises that the categories exist.

Source: `src/server/code-ux-server.ts:295-311`.

## Transports

### Stdio

```
StdioServerTransport (from @modelcontextprotocol/sdk)
```

Activates when stdin is **not** a TTY. The Node process expects JSON-RPC frames on stdin and writes responses to stdout. All other logging is routed to stderr (so it doesn't corrupt the JSON-RPC stream).

If launched interactively (TTY), stdio binding is skipped; this is what allows `codeux` to act as a normal CLI without garbling the terminal.

Source: `src/app/lifecycle/mcp-lifecycle-service.ts:92-106`.

### Streamable HTTP

By default (disable with `--no-mcp-http`, `--no-mcp-https`, `MCP_HTTP_ENABLED=false`, or `MCP_HTTPS_ENABLED=false`), Code UX also binds an HTTP listener using `StreamableHTTPServerTransport`. The `mcp-https` flag/env names are retained for compatibility, but the Node listener itself is HTTP.

| Default | Value |
| --- | --- |
| Port | `dashboardPort + 1` |
| Host | `127.0.0.1` |
| Path | `/mcp` |

#### Endpoints

- `POST {path}` — JSON-RPC main endpoint.
  - First request on a new session **must** be `{"method": "initialize"}`.
  - Server returns `mcp-session-id` header; client must echo it on subsequent calls.
  - `DELETE` against the path with `mcp-session-id` closes the session.
- `GET /health` — `{ "status": "UP" }`.
- `GET /ready` — readiness from the Code UX runtime, available on the MCP HTTP listener for headless server processes.

#### Authentication

Bearer token via `Authorization: Bearer <token>` header.

Server mode requires an explicit bearer token from CLI or environment even when binding to loopback. It also disables dashboard routes and websockets while preserving `/health` and `/ready` on the MCP HTTP listener.

| Host class | Token required? |
| --- | --- |
| Normal Code UX startup | Generated user token from `~/.code-ux/security.json` unless an explicit token is configured |
| Server mode | Explicit `MCP_HTTP_AUTH_TOKEN`, `MCP_HTTPS_AUTH_TOKEN`, `--mcp-http-auth-token`, or `--mcp-https-auth-token`; generated fallback is rejected |
| Embedded/low-level transport use | Loopback may be unauthenticated; non-loopback requires a token |

Invalid or missing bearer credentials are rejected with HTTP 401 + JSON-RPC error `-32001`.

The Express middleware uses `express.json({ limit: "1mb" })`. Larger payloads return HTTP 400.

Source: `src/app/lifecycle/mcp-lifecycle-service.ts:108-240`.

#### Session limits

The listener defaults to 100 active Streamable HTTP sessions and a one-hour idle timeout. Operators can raise the cap with `MCP_HTTP_MAX_SESSIONS` / `MCP_HTTPS_MAX_SESSIONS` or the matching CLI flags for large worker clusters. These are transport protections for runaway clients and stale workers, not a license limit on registered workers.

#### Session model

Sessions are stored in an in-memory `Map<sessionId, McpHttpSessionEntry>`. Session IDs are generated via `randomUUID()`. Sessions are removed on:

- Explicit `DELETE`.
- Transport `close` event.
- Process restart (no persistence).

This is acceptable because clients are expected to re-`initialize` after restarts.

## Tool registry

The request router (`src/server/mcp-request-router.ts`) is a `name → handler` map populated at boot.
There is **one tool per management domain**, plus retrieval tools such as `search_knowledge` and
`search_skills`, and the deprecated unified `manage_code_ux`:

```ts
router
  .register("manage_code_ux",     h.handleManageCodeUx)      // deprecated
  .register("manage_projects",    h.handleManageProjects)
  .register("manage_sprints",     h.handleManageSprints)
  .register("manage_tasks",       h.handleManageTasks)
  .register("manage_quicksprints", h.handleManageQuicksprints)
  .register("manage_scheduler",   h.handleManageScheduler)
  .register("scheduler_code_ux",          h.handleScheduler)
  .register("manage_agents",      h.handleManageAgents)
  .register("manage_memory",      h.handleManageMemory)
  .register("manage_skills",      h.handleManageSkills)
  .register("manage_settings",    h.handleManageSettings)
  .register("manage_preview",     h.handleManagePreview)
  .register("manage_chat_providers", h.handleManageChatProviders)
  .register("manage_telemetry",   h.handleManageTelemetry)
  .register("search_knowledge",   h.handleSearchKnowledge)
  .register("search_skills",      h.handleSearchSkills);
```

Every tool's input schema is declared in `TOOL_DEFINITIONS` (`src/contracts/mcp-tool-definitions.ts`).

## Request routing

Source: `src/server/mcp-request-router.ts`.

### `ListTools`

```
Server returns getEnabledToolDefinitions(settings, runtimeRole)
  ├── Filter by settings.mcpTools[].enabled
  ├── Filter by advertised agent Code UX policy, when present
  └── Filter by tool.runtimeRoles ⊇ runtimeRole
```

Advertised agent identities fail closed when malformed, unknown, or missing an explicit MCP access
policy. This prevents an unknown worker agent from inheriting broad project-manager tools.
Agent-scoped provider runs use the same default-deny posture for built-in Code UX tools. Default
custom MCP links such as `playwright` are stored separately and do not imply `code_ux` access.
Dashboard chat replies are the only route-local default exception: unconfigured reply agents receive
the restricted `scheduler_code_ux` tool only, with broad tools such as `manage_scheduler`, `manage_tasks`,
`manage_sprints`, `manage_settings`, and `manage_code_ux` disabled.

### `CallTool`

```
1. Validate tool name against the enabled set.
2. Apply the same per-agent enabled-set filtering used by `ListTools`.
3. AJV-validate args against TOOL_DEFINITIONS[name].inputSchema.
4. toolRegistry.dispatch(name, args).
5. Wrap handler errors via formatError().
```

Errors:

- `InvalidParams` for schema-validation failures.
- `MethodNotFound` for unknown or disabled tools.
- `InternalError` for handler exceptions.

## Tool toggling

Each tool has an entry in `settings.mcpTools` (`McpToolToggle[]`). Defaults:

```jsonc
[
  { "name": "manage_projects",     "enabled": true, "isInternal": true },
  { "name": "manage_sprints",      "enabled": true, "isInternal": true },
  { "name": "manage_tasks",        "enabled": true, "isInternal": true },
  { "name": "manage_quicksprints", "enabled": true, "isInternal": true },
  { "name": "manage_scheduler",    "enabled": true, "isInternal": true },
  { "name": "scheduler_code_ux",           "enabled": true, "isInternal": true },
  { "name": "manage_agents",       "enabled": true, "isInternal": true },
  { "name": "manage_memory",       "enabled": true, "isInternal": true },
  { "name": "manage_skills",       "enabled": true, "isInternal": true },
  { "name": "search_knowledge",    "enabled": true, "isInternal": true },
  { "name": "search_skills",       "enabled": true, "isInternal": true },
  { "name": "manage_settings",     "enabled": true, "isInternal": true },
  { "name": "manage_preview",      "enabled": true, "isInternal": true },
  { "name": "manage_chat_providers", "enabled": true, "isInternal": true },
  { "name": "manage_telemetry",    "enabled": true, "isInternal": true },
  { "name": "manage_code_ux",      "enabled": true, "isInternal": true }   // deprecated
]
```

Disabling a tool removes it from `ListTools` and rejects `CallTool`.

Per-agent overrides are layered over these system toggles. A project can expose `search_skills` to an
agent while disabling `manage_skills`, which gives the agent persistent skill retrieval without
storage mutation, markdown export, delete, or reset authority.

## Approval handshake

Destructive and mutating actions (deletes, resets, settings replacements/patches) are flagged across
the `manage_*` tools. The handler short-circuits the first call with:

```jsonc
{ "approvalRequired": true, "approvalMessage": "<consequence summary>" }
```

To proceed, re-call the same action with the same payload and `approval: { confirmed: true }`.
Settings mutations record the exact action/payload for up to 15 minutes and the confirmation is
single-use.

Source: `src/mcp/management-tool-handler.ts`.

## Persistent skill dispatch

Persistent skills use `SkillService` as the backend boundary. `manage_skills` routes storage CRUD,
skill markdown import/export, agent storage attachment management, and the authoring prompt through
`SkillActions`. `search_skills` is registered separately as a retrieval tool and returns concise
ranked summaries with IDs and metadata. Full markdown retrieval stays behind `manage_skills`.

## Connection registry

The `ConnectionRegistry` tracks every MCP client that connects. Each entry records:

- `connectionKey` (stable client ID).
- `displayName`, `role`, `transport`.
- `boundProjectIds`, `activeProjectIds`.
- Last activity timestamp.

Connections are pruned during the runtime cleanup loop. The dashboard's
**Settings → Connections** panel reads from this registry.

## Runtime role

`--runtime-role` (or default `project_manager`) determines which tools are advertised. The main server uses `project_manager`. External workers connect to that server over Streamable HTTP for the control plane and start a local `worker-host` runtime over stdio for execution tools such as worker dispatch execution and local cancellation.

Worker endpoint registration and project assignment are database-backed. Registered workers are unlimited; active HTTP sessions are bounded by the session cap. Dispatch claims update `task_dispatches` and create `execution_leases` in the same safety path, and a worker must not execute a claimed dispatch unless the server returns a lease token.

For operator procedures, see [User Guide → Connecting MCP clients](../user/mcp-clients.md#secure-headless-server-mode).

## Recovery

On boot, the MCP HTTP transport runs a recovery routine that:

- Prunes stale session entries.
- Clears any in-flight transports left from a previous process.

This makes restarts safe; clients reconnect and re-`initialize` cleanly.

## Performance

- Tool dispatch is in-process; no IPC overhead.
- Input validation (AJV) runs per call but is negligible relative to the work each action performs.
- HTTP transport uses chunked streaming (Streamable HTTP); the underlying SDK handles backpressure.
