# Worker Endpoint Foundation

## Status
In Progress

## Purpose

`worker_endpoints` is the start of the transport-agnostic worker model for the multi-project refactor.

The current system still executes real worker traffic through MCP connections, but worker identity and capability are no longer modeled only as `mcp_connections` rows.

This gives the backend a stable worker abstraction that can later support:

- MCP-connected workers
- server-managed virtual CLI workers
- hosted API workers
- Ollama-backed workers

## Current Implementation

Implemented on March 12, 2026:

- added the `worker_endpoints` table to `app.db`
- added `WorkerEndpointRecord` and `WorkerEndpointCapabilities`
- added `WorkerEndpointRepository`
- synchronized MCP worker registrations into `worker_endpoints`
- made worker dispatch claims require a worker endpoint with `canExecuteTasks = true`

Extended on March 15, 2026:

- added ephemeral `virtual_cli` worker endpoints
- added create/update/delete lifecycle helpers for non-MCP endpoints
- virtual worker startup now prunes orphaned `virtual_cli` endpoints from previous runs

## Provider Run Lifecycle

To ensure consistent workspace preparation and deterministic cleanup, CLI provider execution follows a shared lifecycle boundary implemented in `src/infrastructure/providers/cli/provider-runner-lifecycle.ts`.

Both `runProvider` and `runProviderForText` use the `runProviderWithLifecycle` helper which:
1. Prepares the execution workspace (isolated Docker volume or local directory).
2. Sets up provider-specific output paths (e.g., for Codex last message capture).
3. Executes the provider-specific logic.
4. Ensures all resources (Docker volumes, temporary files) are cleaned up regardless of success or failure.

This boundary separates environment orchestration from the specific CLI command generation and output parsing logic found in `ProviderRunner`.

## Data Model

Each worker endpoint stores:

- `endpointType`
- `displayName`
- `status`
- backing MCP connection identity when applicable
- capability flags:
  - `canSuperviseProjects`
  - `canExecuteTasks`

For MCP-backed workers:

- `connection_id` points at the live transport record in `mcp_connections`
- deleting the MCP connection cascades and removes the worker endpoint row
- connection heartbeat/status changes resync the worker endpoint status

## Sync Rules

When `ConnectionChatRepository` upserts or updates a connection:

- `role = worker` creates or updates an MCP-backed worker endpoint
- any non-worker role removes the synced worker endpoint
- connection heartbeats and lifecycle cleanup resync endpoint status

Current status mapping:

- `listening` and `connected` map to worker endpoint status `connected`
- `idle`, `paused`, `stale`, and `offline` keep the same semantic status

## Capability Rules

Current MCP worker defaults:

- `canSuperviseProjects = true`
- `canExecuteTasks = true`

Current MCP capability overrides:

- `workerCanSuperviseProjects: false`
- `workerCanExecuteTasks: false`

This allows the system to distinguish supervision-only workers from workers that may claim `mcp_worker` task dispatches.

Virtual worker defaults:

- `endpointType = virtual_cli`
- `transport = internal`
- `canSuperviseProjects = true`
- `canExecuteTasks = true`
- endpoints are deleted when the one-shot virtual cycle completes

## Current Limitation

This is not yet the full assignment model.

Still pending:

- primary vs overflow project assignments
- worker attention queues
- non-MCP endpoint creation flows
- dashboard views for worker endpoints
