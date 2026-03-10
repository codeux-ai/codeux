# Dashboard Realtime Foundation

## Status
Implemented foundation

## Purpose

Sprint OS now has the first shipped dashboard realtime transport layer.

This foundation improves browser freshness for:

- project collection and selected-project changes
- sprint and task list invalidation for the selected project
- selected-project execution state
- sprint run and dispatch status changes
- live project connection state through the execution snapshot
- cross-project overview telemetry
- chat thread assignment and thread message flow

It does not replace:

- sqlite as the source of truth
- REST snapshot and mutation endpoints
- MCP `listen` for stdio clients and workers

## What Shipped

### Durable realtime event log

Sprint OS now persists dashboard realtime events in:

- `dashboard_realtime_events`

This creates sequence-backed replay for reconnecting browser clients.

### Coalescing realtime publisher

Sprint OS now coalesces runtime writes before broadcasting them.

The current publisher schedules:

- `projects.updated`
- `project.structure.updated`
- `project.execution.updated`
- `overview.telemetry.updated`

This avoids emitting one websocket message for every low-level DB mutation while still keeping the dashboard near realtime.

### Dashboard websocket endpoint

The dashboard server now exposes:

- `GET /api/realtime`

The protocol is intentionally small:

- browser opens websocket
- browser sends `set_subscriptions`
- server replays events after `lastSequence`
- server pushes new events as they are committed

Current subscription scopes:

- `projects`
- `overview`
- `project:<projectId>`
- `thread:<threadId>`

### Websocket-first dashboard consumers

The first dashboard consumers now use websocket-first updates with polling fallback:

- `dashboard/src/hooks/use-dashboard-runtime-data.ts`
- `dashboard/src/hooks/use-overview-telemetry.ts`
- `dashboard/src/v2/hooks/use-project-execution.ts`
- `dashboard/src/v2/ChatPage.tsx`

Behavior:

- initial snapshot still comes from REST
- websocket updates replace stale wait time for execution and overview telemetry
- project collection and selected-project context now refresh over websocket too
- sprint and task pages now react to project-structure invalidation events
- polling remains as recovery fallback, now on a slower `30s` default cadence for websocket-backed dashboard surfaces

## Current Backend Integration Points

Realtime refresh scheduling is currently wired from:

- `src/repositories/execution-repository.ts`
- `src/repositories/connection-chat-repository.ts`

That means the browser is refreshed when execution state or live connection state changes in the DB-native runtime path.

The publisher intentionally ignores heartbeat-only execution writes where possible to avoid noisy event spam.

## What This Improves

Compared with pure polling, the dashboard now updates much faster for:

- sprint start
- sprint pause
- sprint cancel
- project list and project selection freshness
- sprint/task structure changes across open dashboard tabs
- dispatch queue and run-state changes
- overview telemetry activation and deactivation
- live connection state changes inside the selected-project execution snapshot
- chat thread assignment, thread creation, and message arrival

This reduces the visible lag that previously made sprint cards and live panels feel stale.

## What Is Not Realtime Yet

This is the first slice, not the final transport rollout.

Still pending:

- degraded-mode dashboard banners and richer reconnect diagnostics
- broader polling reduction once websocket behavior has been hardened longer

## Relationship To MCP Listen

The MCP listener model is unchanged.

Sprint OS still uses:

- blocking `listen`
- one actionable item at a time
- explicit continuation guidance for stdio clients and workers

WebSockets are browser transport only.

## Main Files

Backend:

- `src/repositories/dashboard-realtime-event-repository.ts`
- `src/services/dashboard-realtime-service.ts`
- `src/server/dashboard-realtime-websocket-server.ts`
- `src/server/dashboard-server.ts`

Frontend:

- `dashboard/src/lib/realtime/dashboard-realtime-client.ts`
- `dashboard/src/v2/context/project-data.tsx`
- `dashboard/src/hooks/use-dashboard-runtime-data.ts`
- `dashboard/src/hooks/use-overview-telemetry.ts`
- `dashboard/src/v2/hooks/use-project-sprints.ts`
- `dashboard/src/v2/hooks/use-project-tasks.ts`
- `dashboard/src/v2/hooks/use-project-execution.ts`
- `dashboard/src/v2/ChatPage.tsx`
