# Worker Endpoint Foundation

## Status
In Progress

## Purpose

`worker_endpoints` is the start of the transport-agnostic worker model for the multi-project refactor.

The current system still executes real worker traffic through MCP connections, but worker identity and capability are no longer modeled only as `mcp_connections` rows.

This gives the backend a stable worker abstraction that can later support:

- MCP-connected workers
- hosted API workers
- Ollama-backed workers

## Current Implementation

Implemented on March 12, 2026:

- added the `worker_endpoints` table to `app.db`
- added `WorkerEndpointRecord` and `WorkerEndpointCapabilities`
- added `WorkerEndpointRepository`
- synchronized MCP worker registrations into `worker_endpoints`
- made worker dispatch claims require a worker endpoint with `canExecuteTasks = true`

Primary files:

- `src/contracts/worker-types.ts`
- `src/repositories/worker-endpoint-repository.ts`
- `src/repositories/connection-chat-repository.ts`
- `src/services/worker-task-dispatch-service.ts`

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

## Current Limitation

This is not yet the full assignment model.

Still pending:

- primary vs overflow project assignments
- worker attention queues
- non-MCP endpoint creation flows
- dashboard views for worker endpoints
