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
7. `src/server/code-ux-server.ts` connects MCP stdio transport.
8. `src/server/code-ux-server.ts` optionally starts the MCP HTTP transport with the same project-manager tool surface.
9. `src/server/code-ux-server.ts` starts runtime intervals and schedules deferred startup work.

Long-running startup work is intentionally off the synchronous boot path:

- Startup recovery runs shortly after transports bind and resumes recoverable sprint runs.
- Stale preview/file-browser container cleanup and Docker asset pruning run after the dashboard is available.
- Branch reaping and database maintenance run later as background maintenance.
- The first runtime cleanup and preview reconciliation interval passes are delayed so they do not compete with initial dashboard load.

This keeps `/health`, `/ready`, the dashboard, and MCP transports responsive before Docker, git, and SQLite maintenance complete.

## Runtime Modes

Code UX now exposes a single MCP runtime role:

- `project_manager`

The legacy `worker_host`, `worker_gateway`, and in-repo `code-ux-worker` runtime have been removed.

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
- Server closes MCP stdio and HTTP transports. The dashboard and MCP HTTP listeners track open sockets and destroy them during shutdown, including upgraded dashboard WebSocket sockets, so an open browser tab does not hold the process in the HTTP close path.
- Process exits cleanly.
