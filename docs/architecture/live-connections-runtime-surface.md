# Live Connections Runtime Surface

## Status
Implemented foundation

## Purpose

Code UX now exposes live MCP connections as part of the execution control plane instead of treating them as agents.

This completes the first product-correct runtime surface for:

- normal stdio listeners such as Gemini CLI and Codex
- connected workers
- project-scoped inbox visibility
- project-scoped dispatch load visibility

## Why This Exists

The v2 refactor needed a clean split between:

- `Agents` as reusable presets
- live MCP connections as runtime state
- workers as a subset of live connections

After the `Agents` page was corrected to presets only, live connections still needed a proper home in the dashboard.

That home is now the selected-project execution runtime surface.

## Execution Snapshot Shape

`/api/execution` and `/api/projects/:projectId/execution` now include:

- `connections`

Each connection summary includes:

- `id`
- `connectionKey`
- `displayName`
- `role`
- `transport`
- `status`
- `model`
- `instruction`
- `labels`
- `listenMode`
- `machineName`
- `platform`
- `arch`
- `localExecutionRuntime`
- `lastHeartbeatAt`
- `projectIds`
- `activeProjectIds`
- `tasksRunCount`
- `threadCount`
- `messageCount`
- `pendingInboxCount`
- `activeDispatchCount`

This keeps live connection observability in the same payload as:

- `sprintRuns`
- `taskDispatches`
- `recentEvents`

## Dashboard Behavior

The v2 live experience now supports a dedicated sidebar-ready live-connections card that shares the execution timeline context and renders as a standalone card in the sidebar.

The execution runtime card no longer embeds live connections, attention items, or the runtime timeline. Those surfaces now live as dedicated sidebar cards, which keeps the runtime panel focused on sprint runs and dispatches.

It shows:

- active vs offline connection state
- listening vs worker role identity
- manager/dashboard connection counts
- transport and model metadata
- worker machine metadata when available
- pending inbox count
- active dispatch count
- thread history and task-run history
- lightweight instruction and label context when present
- readable empty-state messaging when no listeners or workers are connected
- compact count tiles and status badges tuned for narrow sidebar widths

This means operators can now see:

- whether a local stdio client is still listening
- whether a worker is actually busy
- whether inbox work is queued with no active listener
- whether a project has any connected execution capacity at all

## Source Files

Backend:

- `src/contracts/app-types.ts`
- `src/contracts/connection-chat-types.ts`
- `src/app/lifecycle/dashboard-lifecycle-service.ts`
- `src/repositories/connection-chat-repository.ts`

Frontend:

- `dashboard/src/hooks/use-dashboard-runtime-data.ts`
- `dashboard/src/v2/LiveSessionPage.tsx`
- `dashboard/src/v2/components/live-session/ExecutionRuntimePanel.tsx`
- `dashboard/src/v2/components/live-session/LiveConnectionsCard.tsx`

Tests:

- `tests/backend/app/lifecycle/dashboard-lifecycle-service.test.ts`
- `tests/backend/server/dashboard-project-api.test.ts`
- `tests/backend/server/dashboard-server.test.ts`

## What This Does Not Solve Yet

This slice is observability and product-model correction only.

It does not yet add:

- a separate operations page for live connection management
- remote worker transport
- worker authentication
- connection-level manual disconnect controls
- richer claimed-listener wait visibility

## Why It Matters

The product model is now materially cleaner:

- `Agents` no longer lie about runtime state
- chat routing still works through explicit thread assignment
- runtime connection health is visible where execution is visible
- multi-connection orchestration can evolve without collapsing back into the wrong agent abstraction
