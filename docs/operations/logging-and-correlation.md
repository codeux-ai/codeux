# Logging and Correlation IDs

This project now uses a shared structured logger and request correlation context for dashboard HTTP requests and MCP tool calls.

## Runtime Modules

- `src/shared/logging/logger.ts`
  - Dependency-free structured logger.
  - Supports levels: `debug`, `info`, `warn`, `error`.
  - Classifies records by purpose (`HTTP`, `INVK`, `ORCH`, `MCP`, `LIVE`, `CONF`, etc.) so console output can be scanned by runtime concern.
  - Accepts metadata objects.
  - Output mode:
    - `NODE_ENV=production`: JSON log records.
    - other environments: colored human-readable single-line logs when stderr is a TTY.
  - Automatically includes active `correlationId` when available.
  - Supports dashboard-controlled console verbosity:
    - `standard` is the default and keeps important lifecycle, orchestration, invocation, MCP, warning, and error logs visible.
    - `full` also prints routine dashboard HTTP request-completion logs.
  - When the debug log file is enabled, records that pass severity filtering are still written to disk even if the console verbosity hides them.

- `src/shared/logging/correlation-id.ts`
  - Correlation ID context backed by `AsyncLocalStorage`.
  - Exposes helpers to generate/resolve/get IDs and run code in a correlation scope.
  - Provides Express middleware that reads/sets `x-correlation-id`.

## Dashboard API Correlation Flow

1. `src/server/dashboard-server.ts` installs `correlationIdMiddleware()` before route handlers.
2. Incoming `x-correlation-id` is reused when present, otherwise a new ID is generated.
3. Response always includes `x-correlation-id`.
4. Request-completion logs are emitted through the shared logger and include the active correlation ID.
5. Dashboard HTTP request logs are purpose-classified as `request`/`HTTP` and only print to the server console when Console Log Level is `full`.

## Console Log Level

The Dashboard General settings page stores `runtime.consoleLogLevel` in system settings.

- `standard` is the default. It is intended for day-to-day server operation and keeps high-signal events visible, including provider invocation start/finish logs.
- `full` enables request-level HTTP visibility for dashboard/API traffic in addition to standard logs.
- `LOG_LEVEL` still controls severity (`debug`, `info`, `warn`, `error`); Console Log Level controls console purpose filtering.

## MCP Correlation Flow

1. `src/server/code-ux-server.ts` passes a correlation wrapper to `registerMcpRequestHandlers`.
2. For each MCP `CallTool` request:
   - correlation ID is read from request metadata/arguments when present,
   - otherwise generated.
3. Dispatch runs inside `AsyncLocalStorage`, so logs from the dispatch path include the same correlation ID.

## Dependency Injection

`src/app/dependency-factory.ts` creates the root logger once and injects scoped child loggers into runtime services (core tool handler, activity cache, task rerun, CLI workflow, and router/dashboard paths).

## Operational Notes

- For cross-system tracing, pass `x-correlation-id` on dashboard requests.
- In production, parse log lines as JSON and index `correlationId` for request-level traceability.
- The CLI entrypoint installs a bootstrap warning filter before server modules load, suppressing Node's SQLite experimental warning. Dotenv is loaded in quiet mode so startup output is owned by the structured logger.

### Dashboard Realtime Telemetry
- `project_live_snapshot_assembled`: Logs the build time and byte size of an assembled project live snapshot.
- `realtime_snapshot_published`: Logs the published realtime snapshot event and size.
- `realtime_background_refresh`: Logs scheduled background dashboard refreshes (like overview telemetry).
- `websocket_recovery_snapshot_required`: Emitted when a client reconnects and needs a full snapshot payload.
