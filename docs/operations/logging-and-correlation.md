# Logging and Correlation IDs

This project now uses a shared structured logger and request correlation context for dashboard HTTP requests and MCP tool calls.

## Runtime Modules

- `src/shared/logging/logger.ts`
  - Dependency-free structured logger.
  - Supports levels: `debug`, `info`, `warn`, `error`.
  - Classifies every record by a stable purpose so console output can be scanned by runtime concern.
  - Accepts metadata objects.
  - Output mode:
    - `NODE_ENV=production`: JSON log records.
    - other environments: colored human-readable single-line logs when stderr is a TTY.
  - Automatically includes active `correlationId` when available.
  - Supports separate dashboard-controlled severity thresholds for console and `.code-ux/debug.log`:
    - `consoleLogLevel`: `off`, `debug`, `info`, `warn`, or `error`.
    - `debugLogFileLevel`: `off`, `debug`, `info`, `warn`, or `error`.
    - The debug log file defaults to `error`, so only error records are persisted unless the level is lowered or set to `off`.
  - Supports dashboard-controlled console visibility:
    - `standard` is the default and keeps important lifecycle, orchestration, invocation, MCP, warning, and error logs visible.
    - `full` also prints routine dashboard HTTP request-completion logs.
  - File output uses its own severity threshold and is not hidden by console visibility filtering.

- `src/shared/logging/correlation-id.ts`
  - Correlation ID context backed by `AsyncLocalStorage`.
  - Exposes helpers to generate/resolve/get IDs and run code in a correlation scope.
  - Provides Express middleware that reads/sets `x-correlation-id`.

### Purpose Label Contract

Purpose names are part of the structured log contract and should not be renamed without a migration. Console labels are intentionally short and stable:

| Purpose | Console Label |
| --- | --- |
| `dashboard` | `DASH` |
| `general` | `GEN` |
| `integration` | `INT` |
| `invocation` | `INVK` |
| `lifecycle` | `LIFE` |
| `mcp` | `MCP` |
| `orchestration` | `ORCH` |
| `request` | `HTTP` |
| `runtime` | `RUN` |
| `settings` | `CONF` |
| `storage` | `DATA` |
| `realtime` | `LIVE` |
| `security` | `SEC` |

Callers should pass `logPurpose` when the purpose is known. An explicit `logPurpose` always wins over message/component inference. Inference exists only as a compatibility fallback for common conventions such as request metadata, provider invocation messages, MCP messages, websocket/realtime messages, settings/config messages, sprint/orchestration messages, lifecycle/startup messages, and dashboard messages.

## Dashboard API Correlation Flow

1. `src/server/dashboard-server.ts` installs `correlationIdMiddleware()` before route handlers.
2. Incoming `x-correlation-id` is reused when present, otherwise a new ID is generated.
3. Response always includes `x-correlation-id`.
4. Request-completion logs are emitted through the shared logger and include the active correlation ID.
5. Malformed dashboard JSON request bodies are rejected by the shared pre-route middleware with `400` and `{ "error": "Invalid JSON request body." }`. The response and structured logs do not include the raw body.
6. Dashboard HTTP request logs are purpose-classified as `request`/`HTTP` and only print to the server console when Console Visibility is `full`.

## Runtime Log Levels

The Dashboard General settings page stores separate system runtime settings for console and file logging.

- `runtime.consoleLogLevel` controls the minimum severity printed to stderr. `info` is the default.
- `runtime.debugLogFileLevel` controls the minimum severity written to `.code-ux/debug.log`. `error` is the default. `off` disables file logging.
- `runtime.consoleLogMode` controls console purpose filtering:
  - `standard` is the default. It is intended for day-to-day server operation and keeps high-signal events visible, including provider invocation start/finish logs.
  - `full` enables request-level HTTP visibility for dashboard/API traffic in addition to standard logs.
- `LOG_LEVEL` remains the environment fallback for console severity when a logger is created without an explicit console level.
- `DEBUG_LOG_FILE_LEVEL` can provide a file severity fallback for standalone logger construction.
- Console and debug-file thresholds are independent. For example, operators may keep `consoleLogLevel=warn` while setting `debugLogFileLevel=debug` to capture detailed file diagnostics without expanding stderr noise, or keep `consoleLogLevel=debug` while `debugLogFileLevel=error` to avoid persistent debug files.

## MCP Correlation Flow

1. `src/server/code-ux-server.ts` passes a correlation wrapper to `registerMcpRequestHandlers`.
2. For each MCP `CallTool` request:
   - correlation ID is read from request metadata/arguments when present,
   - otherwise generated.
3. Dispatch runs inside `AsyncLocalStorage`, so logs from the dispatch path include the same correlation ID.

## Dependency Injection

`src/app/dependency-factory.ts` creates the root logger once and injects scoped child loggers into runtime services (core tool handler, activity cache, task rerun, CLI workflow, and router/dashboard paths).

## Provider Telemetry Events

Provider runtime telemetry is purpose-classified as `invocation`/`INVK` and must remain metadata-only. Logs can include provider, purpose, Code UX session id, execution invocation id, provider invocation id, native provider session id, token counters, transcript character count, usage source, and active `correlationId`. Logs must not include raw provider transcript text, API keys, provider environment values, or raw usage JSON payloads.

Provider invocation usage rows preserve the operational fields needed for dashboard and recovery workflows:

- Identity and routing: `id`, `projectId`, optional sprint/task/runtime ids, `sessionId`, `nativeSessionId`, `provider`, `purpose`, `model`, `executionMode`, and `invocationSource`.
- Lifecycle: `status`, `startedAt`, `finishedAt`, `durationMs`, `createdAt`, and `updatedAt`.
- Bounded usage counters: `promptChars`, `transcriptChars`, `inputTokens`, `cachedInputTokens`, `outputTokens`, `reasoningOutputTokens`, `totalTokens`, `toolCallCount`, `julesTokens`, `usageSource`, and `costCents`.
- Raw provider usage JSON may be stored on the invocation row for later diagnostics, but structured logs only expose `rawUsageJsonPresent: true|false` plus stable counters. Logs must not serialize the raw payload.

Provider telemetry warning logs intentionally do not include raw provider read error messages. They include `errorName`, invocation identifiers, `failureCount`, and correlation context so operators can identify the failing invocation without risking transcript fragments in log metadata.

Provider invocation lifecycle logs (`Provider invocation started`, `Provider invocation finished`, `Provider invocation crashed`, and cancellation logs) carry `logPurpose: "invocation"` plus the active `correlationId` when one is present. Crash and cleanup logs include `errorName` and bounded identifiers instead of raw `Error` objects, command argv, prompts, provider env values, or subprocess/Docker failure payloads.

Expected provider telemetry event types:

- `provider_telemetry_poll_succeeded`: A watcher tick parsed reported provider usage and emitted deterministic counters.
- `provider_telemetry_poll_partial`: A watcher tick emitted estimated or otherwise partial usage while the provider run is still active.
- `provider_telemetry_poll_no_new_data`: Source metadata matched the previous successful tick, so the watcher skipped expensive transcript/database reads.
- `provider_telemetry_poll_failed`: A watcher tick failed to read or parse provider telemetry; the warning logs invocation context, `failureCount`, and `errorName` without provider transcript or usage payload text.
- `provider_invocation_usage_updated`: A provider invocation usage row was updated; logs include the update shape and summary counters, not raw usage payloads.

Docker-backed provider launches pass secret-bearing provider environment values through a temporary `0600` env-file supplied with `--env-file`. Long prompts and provider argv are mounted from a generated argv file. Host `docker run` arguments and provider activity logs should show env-file or mount paths only, never API key values, provider env assignments, raw prompts, or usage JSON.

Focused verification:

```bash
pnpm run test:backend -- tests/backend/infrastructure/providers/cli/provider-telemetry-watcher.test.ts tests/backend/infrastructure/providers/cli/docker-runner.test.ts tests/backend/repositories/execution-repository.test.ts tests/backend/shared/logging/logger.test.ts
```

Focused logging/realtime validation:

```bash
pnpm run test:backend -- tests/backend/shared/logging/logger.test.ts tests/backend/shared/logging/correlation-id.test.ts tests/backend/server/dashboard-realtime-websocket-server.test.ts tests/backend/repositories/dashboard-realtime-event-repository.test.ts tests/backend/server/dashboard-server.test.ts
pnpm run test:dashboard -- tests/dashboard/lib/dashboard-realtime-client.test.ts
```

## Operational Notes

- For cross-system tracing, pass `x-correlation-id` on dashboard requests.
- In production, parse log lines as JSON and index `correlationId` for request-level traceability.
- The CLI entrypoint installs a bootstrap warning filter before server modules load, suppressing Node's SQLite experimental warning. Dotenv is loaded in quiet mode so startup output is owned by the structured logger.

### Dashboard Realtime Telemetry

Realtime logs must use `logPurpose: "realtime"` unless they are security rejections, which use `logPurpose: "security"`. They may include event type, sequence, scope, project id, replay cursor, client id, bounded sizes, and `correlationId`. They must not include full realtime payloads, provider transcripts, raw websocket frames, request bodies, authorization headers, API keys, or provider environment values.

- `project_live_snapshot_assembled`: Logs the build time and byte size of an assembled project live snapshot.
- `realtime_snapshot_published`: Logs the published realtime snapshot event and size.
- `realtime_background_refresh`: Logs scheduled background dashboard refreshes, such as overview telemetry.
- `dashboard_realtime_event_write_failed`: Logs bounded event metadata and `errorName` when a realtime event cannot be written. The event publisher defaults event `correlationId` from the active correlation context when the caller did not provide one.
- `websocket_recovery_snapshot_required`: Emitted when a client reconnects and needs a full snapshot payload. Metadata includes the recovery reason (`non_replayable_event_missed`, `replay_window_exceeded`, or `invalid_client_message`) and the active correlation id when one was provided on the websocket upgrade.
- `repeated_unhealthy_recovery_patterns`: Emitted when a websocket client repeatedly requires recovery snapshots within a short window.
- `dashboard_realtime_websocket_backpressure_disconnect`: Emitted when a slow client is disconnected before the server buffers unbounded realtime frames.
- `dashboard_realtime_websocket_broadcast_failed`: Emitted when a websocket write fails; metadata includes event context and the sanitized error, not the event payload.

Realtime event storage is deliberately bounded:

- Replayable events are persisted and can be replayed by scope with an explicit limit.
- Live-only snapshot events are not persisted, but their in-memory scope watermarks force `snapshot_required` when a reconnecting client missed them.
- Invalid scopes return no replay rows instead of falling back to an all-history scan.

## Route Error Status Behavior

Dashboard HTTP requests handled by `syncRoute` or `asyncRoute` automatically map thrown errors to an `HttpRouteError` with the appropriate HTTP status code:
- `ValidationError` maps to `400 Bad Request`.
- Request parser exceptions (errors with messages starting with "Invalid " or "Missing ") map to `400 Bad Request`.
- `EntityNotFoundError` maps to `404 Not Found`.
- Explicit `HttpRouteError` instances preserve their status and public message.
- Unexpected or unhandled exceptions map to `500 Internal Server Error`, hiding internal details from the client response.

Malformed JSON is handled before route dispatch and uses the same correlation header and request logging path as normal dashboard API requests. Route handlers should validate body values through shared parsers or throw `HttpRouteError`/repository errors so status mapping remains centralized instead of adding one-off response formatting.

When a `500 Internal Server Error` occurs (and headers haven't already been sent), the response will be safely formatted and sent, and the original error will then be delegated to Express error handlers via `next(error)` so that it can be logged and appropriately traced.

The route status mapping is regression-tested for both synchronous and asynchronous dashboard route wrappers, including validation failures, parser-prefix failures, missing entities, explicit route errors, and unexpected exceptions. Run the focused check with:

```bash
pnpm run test:backend -- tests/backend/server/route-utils.test.ts tests/backend/server/dashboard-routes-error.test.ts
```
