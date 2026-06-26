# MCP server internals

The MCP server is the protocol-level interface between MCP clients (Gemini CLI, Codex CLI, Claude Desktop, custom integrations) and Code UX's services.

This page documents the transports, the tool registry, the request routing path, and the session model.

## Server identity

- **Name:** `code-ux` (constant `CODE_UX_SERVICE_NAME`).
- **Version:** `0.8.x`.
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

By default (disable with `--no-mcp-https` or `MCP_HTTPS_ENABLED=false`), Code UX also binds an HTTP listener using `StreamableHTTPServerTransport` for the MCP HTTPS worker gateway.

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

#### Authentication

Bearer token via `Authorization: Bearer <token>` header.

| Host class | Token required? |
| --- | --- |
| Loopback (`127.0.0.1`, `localhost`, `::1`) | Optional |
| Non-loopback | **Required** — server rejects unauthenticated requests with HTTP 401 + JSON-RPC error `-32001`. |

The Express middleware uses `express.json({ limit: "1mb" })`. Larger payloads return HTTP 400.

Source: `src/app/lifecycle/mcp-lifecycle-service.ts:108-240`.

#### Session model

Sessions are stored in an in-memory `Map<sessionId, McpHttpSessionEntry>`. Session IDs are generated via `randomUUID()`. Sessions are removed on:

- Explicit `DELETE`.
- Transport `close` event.
- Process restart (no persistence).

This is acceptable because clients are expected to re-`initialize` after restarts.

## Tool registry

The request router (`src/server/mcp-request-router.ts`) is a `name → handler` map populated at boot.
There is **one tool per management domain**, plus `search_knowledge` and the deprecated unified
`manage_code_ux`:

```ts
router
  .register("manage_code_ux",     h.handleManageCodeUx)      // deprecated
  .register("manage_projects",    h.handleManageProjects)
  .register("manage_sprints",     h.handleManageSprints)
  .register("manage_tasks",       h.handleManageTasks)
  .register("manage_quicksprints", h.handleManageQuicksprints)
  .register("manage_scheduler",   h.handleManageScheduler)
  .register("manage_agents",      h.handleManageAgents)
  .register("manage_memory",      h.handleManageMemory)
  .register("manage_settings",    h.handleManageSettings)
  .register("manage_preview",     h.handleManagePreview)
  .register("manage_telemetry",   h.handleManageTelemetry)
  .register("search_knowledge",   h.handleSearchKnowledge);
```

Every tool's input schema is declared in `TOOL_DEFINITIONS` (`src/contracts/mcp-tool-definitions.ts`).

## Request routing

Source: `src/server/mcp-request-router.ts`.

### `ListTools`

```
Server returns getEnabledToolDefinitions(settings, runtimeRole)
  ├── Filter by settings.mcpTools[].enabled
  └── Filter by tool.runtimeRoles ⊇ runtimeRole
```

### `CallTool`

```
1. Validate tool name against the enabled set.
2. AJV-validate args against TOOL_DEFINITIONS[name].inputSchema.
3. toolRegistry.dispatch(name, args).
4. Wrap handler errors via formatError().
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
  { "name": "manage_agents",       "enabled": true, "isInternal": true },
  { "name": "manage_memory",       "enabled": true, "isInternal": true },
  { "name": "search_knowledge",    "enabled": true, "isInternal": true },
  { "name": "manage_settings",     "enabled": true, "isInternal": true },
  { "name": "manage_preview",      "enabled": true, "isInternal": true },
  { "name": "manage_telemetry",    "enabled": true, "isInternal": true },
  { "name": "manage_code_ux",      "enabled": true, "isInternal": true }   // deprecated
]
```

Disabling a tool removes it from `ListTools` and rejects `CallTool`.

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

## Connection registry

The `ConnectionRegistry` tracks every MCP client that connects. Each entry records:

- `connectionKey` (stable client ID).
- `displayName`, `role`, `transport`.
- `boundProjectIds`, `activeProjectIds`.
- Last activity timestamp.

Connections are pruned during the runtime cleanup loop. The dashboard's
**Settings → Connections** panel reads from this registry.

## Runtime role

`--runtime-role` (or default `project_manager`) determines which tools are advertised. Currently all built-in tools declare `runtimeRoles: ["project_manager"]`. The framework supports `worker` and `listener` roles for future expansion (e.g. dedicated worker hosts that expose only worker tools).

## Recovery

On boot, the MCP HTTP transport runs a recovery routine that:

- Prunes stale session entries.
- Clears any in-flight transports left from a previous process.

This makes restarts safe; clients reconnect and re-`initialize` cleanly.

## Performance

- Tool dispatch is in-process; no IPC overhead.
- Input validation (AJV) runs per call but is negligible relative to the work each action performs.
- HTTP transport uses chunked streaming (Streamable HTTP); the underlying SDK handles backpressure.
