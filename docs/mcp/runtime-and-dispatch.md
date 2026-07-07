# MCP Runtime and Dispatch

This document explains how MCP requests flow through the server.

## Server Startup

Startup sequence:

1. `src/index.ts` loads environment and app config.
2. `src/index.ts` constructs `CodeUxServer`.
3. `src/server/code-ux-server.ts` constructs repositories/services/handlers/orchestrator.
4. `src/server/code-ux-server.ts` registers MCP request handlers.
5. `src/server/code-ux-server.ts` loads settings and prunes disconnected MCP connection rows.
6. `src/server/code-ux-server.ts` starts dashboard server.
   - Dashboard API routes (such as project, sprint, task, conversation, and planning endpoints) are broken out into modular route files for maintainability.
   - Route wrappers and body request parsers are maintained as separate server-layer boundaries.
7. `src/server/code-ux-server.ts` connects MCP stdio transport only when stdin is an MCP pipe/socket or `CODE_UX_ENABLE_MCP_STDIO=1` is set. TTY stdin and daemon-style character-device stdin such as `/dev/null` leave stdio disabled so the dashboard/backend stays alive without an attached client.
8. `src/server/code-ux-server.ts` optionally starts the MCP HTTP transport with the same project-manager tool surface.
9. `src/server/code-ux-server.ts` starts runtime intervals and schedules deferred startup work.

Long-running startup work is intentionally off the synchronous boot path:

- Startup recovery runs shortly after transports bind and resumes recoverable sprint runs.
- Stale preview/file-browser container cleanup and Docker asset pruning run after the dashboard is available.
- Branch reaping and database maintenance run later as background maintenance.
- The first runtime cleanup and preview reconciliation interval passes are delayed so they do not compete with initial dashboard load.

This keeps `/health`, `/ready`, the dashboard, and MCP transports responsive before Docker, git, and SQLite maintenance complete.

## Runtime Modes

Code UX exposes these MCP runtime roles:

- `project_manager`: The default human-facing and remote-client surface.
- `worker-host`: A headless execution role used by the local worker client.

The legacy `worker_gateway` and `code-ux-worker` roles have been removed.

## MCP Request Handlers

Registered schemas:
- `ListToolsRequestSchema`
- `CallToolRequestSchema`

### Tool list handler
Returns enabled tool definitions from `src/contracts/mcp-tool-definitions.ts`, filtered by dashboard `mcpTools` settings.

### Tool call handler
- Resolves tool name.
- Verifies tool is enabled in `mcpTools`.
- Dispatches through typed `ToolRegistry` registration in `src/api/mcp/tool-registry.ts`.
- Wraps unknown tool as MCP `MethodNotFound`.
- Normalizes runtime/API errors into `isError` response.

## Correlation Context

MCP tool calls are wrapped in a correlation scope before dispatch.

- `src/server/code-ux-server.ts` derives a correlation ID from request metadata when available.
- If no correlation ID is provided, one is generated.
- `src/shared/logging/correlation-id.ts` stores the ID in `AsyncLocalStorage`.
- `src/server/mcp-request-router.ts` logs request lifecycle events with the shared logger.

This allows all log lines emitted during a tool call to share a single `correlationId`.

## Dispatch Layers

- Typed registry layer: `src/api/mcp/tool-registry.ts`
  - Defines strict argument interfaces for every MCP tool.
  - Provides `register` and `dispatch` APIs with compile-time tool/argument matching.
- Core dispatch target: `CoreToolHandler`
- Agent dispatch target: `AgentToolHandler`

This split keeps tool contracts stable while allowing orchestration internals to evolve independently.

## Custom MCP Defaults

Dashboard settings include custom MCP servers that local CLI providers may receive at execution time.

Code UX seeds Playwright MCP as a default custom MCP server:

- stable id and name: `playwright`
- transport: stdio
- command: `npx`
- args: `@playwright/mcp@latest`

The built-in `code_ux` MCP tool surface is controlled separately from custom MCP servers. Agent presets store MCP access in `mcp_access_json`: `codeUxEnabled` controls the built-in Code UX tools, while `linkedServerIds` selects custom MCP servers such as `playwright`.

By default, the built-in `Worker` and `Project manager` agents link the `playwright` server and keep `code_ux` enabled. Generated task-coding roster agents created by Project Setup use the same default link when they are first created. Existing agents keep user-edited MCP access selections, so setup and sync do not overwrite custom server choices after creation.

## Transport Model

Code UX now uses two MCP transport classes:

- stdio
- Streamable HTTP

### Stdio

Stdio remains the default MCP transport.

### HTTP

The main Code UX server can also expose an authenticated MCP HTTP endpoint.

That endpoint:

- is configured through `MCP_HTTP_*` env vars or `--mcp-http*` flags
- exposes the same project-manager tool surface as stdio
- no longer exposes a separate worker-control-plane runtime

## Dashboard Settings Path

The Settings > MCP panel explains both runtime connection modes in place:

- Code UX exposes the built-in MCP server over stdio by default.
- Authenticated Streamable HTTP for external MCP clients is enabled at startup with `MCP_HTTP_*` environment variables or `--mcp-http*` flags.
- Custom remote MCP servers are added from system scope by choosing `HTTP / SSE`, pasting the server URL, and optionally entering auth headers as a JSON object of header names to string values.
- HTTP custom server previews use `{ type: "http", url, headers }`; stdio custom server previews use command, args, and env.
- Custom server changes are injected into MCP-capable CLI containers on the next CLI run. Project scope can enable, disable, or override inherited system servers, but new custom servers are created at system scope.

## Error Handling

- Axios errors are unwrapped for user-friendly API messages.
- Generic errors are returned as text with `isError: true`.
- Server-level uncaught MCP errors are logged via `server.onerror`.

## Shutdown Behavior

On `SIGINT`, `SIGTERM`, or `SIGHUP`, and when the Electron shell quits:
- Server stops scheduler and virtual-worker loops so no new local work is claimed.
- Server requests every registered active dispatch to stop through its normal abort hook.
- Server scans running Docker containers for `code-ux.*` labels and kills any remaining Code UX-managed containers directly.
- Server preserves Docker workspace/runtime volumes and leaves shutdown-interrupted Docker-backed task rows retryable. Startup recovery closes the interrupted local CLI invocation/dispatch/QA telemetry as `cancelled`, not `failed`, and can resume from the same workspace volume when that retry mode is enabled.
- Server closes any active MCP stdio transport and the MCP HTTP transport. The dashboard and MCP HTTP listeners track open sockets and destroy them during shutdown, including upgraded dashboard WebSocket sockets, so an open browser tab does not hold the process in the HTTP close path.
- Process exits cleanly.
