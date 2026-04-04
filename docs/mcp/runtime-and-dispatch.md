# MCP Runtime and Dispatch

This document explains how MCP requests flow through the server.

## Server Startup

Startup sequence:

1. `src/index.ts` loads environment and app config.
2. `src/index.ts` constructs `JulesAgentServer`.
3. `src/server/jules-agent-server.ts` constructs repositories/services/handlers/orchestrator.
4. `src/server/jules-agent-server.ts` registers MCP request handlers.
5. `src/server/jules-agent-server.ts` starts dashboard server.
   - Dashboard API routes (such as project, sprint, task, conversation, and planning endpoints) are broken out into modular route files for maintainability.
6. `src/server/jules-agent-server.ts` connects MCP stdio transport.
7. `src/server/jules-agent-server.ts` optionally starts the MCP HTTP worker gateway.

## Runtime Modes

Sprint OS now has multiple MCP runtime modes.

`--runtime-role worker-host` changes startup behavior:

- dashboard bind is skipped
- MCP stdio transport still starts
- the same sqlite app state is still used

This is the runtime mode used by the in-repo `sprint-os-worker` CLI.

The main server also creates `worker_gateway` MCP server instances for the Streamable HTTP worker endpoint. That role is not a direct process startup mode; it is used internally so the HTTP gateway can expose a different MCP tool surface than the normal stdio server.

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

- `src/server/jules-agent-server.ts` derives a correlation ID from request metadata when available.
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

Sprint OS now uses two MCP transport classes:

- stdio
- Streamable HTTP

### Stdio

Stdio remains the default transport for:

- normal local Gemini CLI and Codex connections
- local worker-host execution runtimes

### Streamable HTTP worker gateway

The main Sprint OS server can now expose a dedicated authenticated MCP HTTP endpoint for remote workers.

That endpoint:

- is configured through `MCP_HTTP_*` env vars or `--mcp-http*` flags
- creates `worker_gateway` MCP server instances per session
- exposes the remote worker control-plane tool surface
- does not expose the full project-manager tool surface

### Remote worker flow

The current remote-capable worker model is:

1. the main Sprint OS server exposes the Streamable HTTP worker gateway
2. `sprint-os-worker` connects to that HTTP endpoint as its control plane
3. `sprint-os-worker` also starts a local `worker_host` Sprint OS runtime on the worker machine
4. remote control-plane tools are called against the main server
5. local execution tools are called against the local worker-host runtime

This preserves zero-setup local stdio use while allowing workers to run on other machines.

## Error Handling

- Axios errors are unwrapped for user-friendly API messages.
- Generic errors are returned as text with `isError: true`.
- Server-level uncaught MCP errors are logged via `server.onerror`.

## Shutdown Behavior

On `SIGINT`:
- Server closes MCP transport.
- Server closes the MCP HTTP worker gateway when enabled.
- Process exits cleanly.
