# MCP Runtime and Dispatch

This document explains how MCP requests flow through the server.

## Server Startup

Startup sequence:

1. `src/index.ts` loads environment and app config.
2. `src/index.ts` constructs `JulesAgentServer`.
3. `src/server/jules-agent-server.ts` constructs repositories/services/handlers/orchestrator.
4. `src/server/jules-agent-server.ts` registers MCP request handlers.
5. `src/server/jules-agent-server.ts` starts dashboard server.
6. `src/server/jules-agent-server.ts` connects MCP stdio transport.

## MCP Request Handlers

Registered schemas:
- `ListToolsRequestSchema`
- `CallToolRequestSchema`

### Tool list handler
Returns enabled tool definitions from `src/contracts/mcp-tool-definitions.ts`, filtered by dashboard `mcpTools` settings.

### Tool call handler
- Resolves tool name.
- Verifies tool is enabled in `mcpTools`.
- Dispatches through handler map.
- Executes tool handling inside request-scoped correlation ID context.
- Wraps unknown tool as MCP `MethodNotFound`.
- Normalizes runtime/API errors into `isError` response.

## Dispatch Layers

- Core dispatch target: `CoreToolHandler`
- Agent dispatch target: `AgentToolHandler`

This split keeps tool contracts stable while allowing orchestration internals to evolve independently.

## Error Handling

- Axios errors are unwrapped for user-friendly API messages.
- Generic errors are returned as text with `isError: true`.
- Server-level uncaught MCP errors are logged via `server.onerror`.
- Request-path MCP logs include correlation IDs (`mcp-<request-id>` when available).

## Shutdown Behavior

On `SIGINT`:
- Server closes MCP transport.
- Process exits cleanly.
