# MCP server internals

The MCP server is the protocol-level interface between MCP clients (Gemini CLI, Codex CLI, Claude Desktop, custom integrations) and Code UX's services.

This page documents the transports, the tool registry, the request routing path, and the session model.

## Server identity

- **Name:** `code-ux` (constant `CODE_UX_SERVICE_NAME`).
- **Version:** `1.2.0`.
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

When `--mcp-http` (or `MCP_HTTP_ENABLED=true`) is set, Code UX additionally binds an HTTP listener using `StreamableHTTPServerTransport`.

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

`ToolRegistry` (`src/mcp/tool-registry.ts`) is a `name → handler` map populated at boot:

```ts
toolRegistry
  .register("get_session", coreToolHandler.handleGetSession)
  .register("listen", (args) => coreToolHandler.handleListenForRuntime(args, runtimeRole))
  .register("start_listen", coreToolHandler.handleStartListen)
  .register("pull_inbox", coreToolHandler.handlePullInbox)
  .register("post_listen_reply", coreToolHandler.handlePostListenReply)
  .register("generate_dashboard_reply", agentToolHandler.handleGenerateDashboardReply)
  .register("manage_code_ux", managementToolHandler.handleManageCodeUx);
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
  { "name": "get_session",              "enabled": true, "isInternal": true },
  { "name": "manage_code_ux",           "enabled": true, "isInternal": true },
  { "name": "listen",                   "enabled": true, "isInternal": true },
  { "name": "start_listen",             "enabled": true, "isInternal": true },
  { "name": "pull_inbox",               "enabled": true, "isInternal": true },
  { "name": "post_listen_reply",        "enabled": true, "isInternal": true },
  { "name": "generate_dashboard_reply", "enabled": true, "isInternal": true }
]
```

Disabling a tool removes it from `ListTools` and rejects `CallTool`.

## Approval handshake

`manage_code_ux` actions whose name starts with `delete_`, `reset_`, or `replace_` are flagged destructive. The handler short-circuits the first call with:

```jsonc
{ "approvalRequired": true, "approvalMessage": "<consequence summary>" }
```

To proceed, re-call with `approval: { confirmed: true }`. Idempotent retries that already include the confirmation are dispatched normally.

Source: `src/mcp/management-tool-handler.ts:91-98`.

## Connection registry

The `ConnectionRegistry` tracks every MCP client that has called `listen` / `start_listen`. Each entry records:

- `connectionKey` (stable client ID).
- `displayName`, `role`, `transport`.
- `boundProjectIds`, `activeProjectIds`.
- Last activity timestamp.

Connections are pruned during the runtime cleanup loop (every 15 s). The dashboard's **Settings → Connections** panel reads from this registry.

## Listener inbox

Each connection has a per-project **inbox**: an in-memory queue of dashboard messages addressed to it. The inbox is drained by:

- `listen` (long-poll: blocks until one message available).
- `start_listen` / `pull_inbox` (returns immediately).

`post_listen_reply` writes back to the source thread and emits a real-time event.

## Runtime role

`--runtime-role` (or default `project_manager`) determines which tools are advertised. Currently all built-in tools declare `runtimeRoles: ["project_manager"]`. The framework supports `worker` and `listener` roles for future expansion (e.g. dedicated worker hosts that expose only worker tools).

## Recovery

On boot, the MCP HTTP transport runs a recovery routine that:

- Prunes stale session entries.
- Clears any in-flight transports left from a previous process.

This makes restarts safe; clients reconnect and re-`initialize` cleanly.

## Performance

- Tool dispatch is in-process; no IPC overhead.
- `listen` polls the inbox at `poll_interval_ms` (default 1 s) — adjust if you need lower latency or lower CPU.
- HTTP transport uses chunked streaming (Streamable HTTP); the underlying SDK handles backpressure.
