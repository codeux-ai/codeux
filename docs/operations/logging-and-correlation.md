# Logging and Correlation IDs

## Purpose and Scope

This page documents runtime structured logging and correlation ID behavior for MCP tool calls and dashboard API requests.

## Source Files Involved

- `src/shared/logging/logger.ts`
- `src/shared/logging/correlation-id.ts`
- `src/server/dashboard-server.ts`
- `src/server/jules-agent-server.ts`
- `src/server/mcp-request-router.ts`
- `src/app/dependency-factory.ts`

## Behavior Summary

### Structured Logger

A dependency-free logger is created in `createRuntimeDependencies` and injected into runtime services/handlers.

Supported levels:
- `debug`
- `info`
- `warn`
- `error`

Metadata behavior:
- Logs accept structured metadata objects.
- Error values are serialized into `{ name, message, stack }`.
- Child loggers merge static bindings (`service`, `component`) with per-call metadata.

Output format:
- `NODE_ENV=production`: JSON log lines.
- Non-production: human-readable single-line logs.

### Correlation ID Context

Correlation IDs are stored in `AsyncLocalStorage`.

Dashboard API flow:
1. Middleware reads `x-correlation-id` if provided and valid.
2. If missing/invalid, server generates a UUID.
3. ID is attached to response header `x-correlation-id`.
4. All request-path logger calls include that ID automatically.

MCP tool flow:
1. Each `CallToolRequestSchema` execution is wrapped in correlation context.
2. If MCP request ID is available, correlation ID becomes `mcp-<request-id>`.
3. Otherwise server generates `mcp-<uuid>`.
4. Handler/service logger calls during that execution carry the same correlation ID.

## Configuration and Defaults

- `NODE_ENV` controls log output format.
- Logger default level:
  - `production`: `info`
  - non-production: `debug`
- Correlation header name: `x-correlation-id`
- Incoming correlation ID validation:
  - max length `128`
  - allowed chars: `[a-zA-Z0-9._:-]`

## Failure Cases and Troubleshooting Notes

- Missing correlation IDs in logs:
  - Ensure code path uses injected logger (not raw `console`).
  - Ensure calls run inside Express middleware or MCP correlation wrapper.
- Multiple port attempts for dashboard startup:
  - Logger emits `warn` with `currentPort` and `nextPort`.
- Tool-call errors:
  - Router logs a warning with `toolName` and error message before returning MCP-formatted error payload.

## Related Links

- [MCP Runtime and Dispatch](../mcp/runtime-and-dispatch.md)
- [Dashboard Guide](../dashboard/dashboard-guide.md)
- [Operations Runbook](./runbook.md)
- [System Overview](../architecture/system-overview.md)
