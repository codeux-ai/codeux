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

Production refinement shipped on March 15, 2026:

- large snapshot events such as `project.live.updated`, `project.execution.updated`, `project.runtime_status.updated`, `projects.updated`, `project.structure.updated`, and `overview.telemetry.updated` now persist as lightweight sequence markers with `is_replayable = 0`
- reconnecting websocket clients still get correct gap detection, but missed heavy snapshots now trigger `snapshot_required` instead of replaying bulky payloads from sqlite
- replay decisions are now scope-aware instead of comparing against the global event sequence, which avoids false snapshot reloads when unrelated projects are active

### Coalescing realtime publisher

Sprint OS now coalesces runtime writes before broadcasting them.

The current publisher schedules:

- `project.live.updated`
- `projects.updated`
- `project.structure.updated`
- `project.execution.updated`
- `overview.telemetry.updated`

This avoids emitting one websocket message for every low-level DB mutation while still keeping the dashboard near realtime.

Production refinement shipped on March 15, 2026:

- project execution snapshots are now throttled per project instead of being rebuilt on every task-run event burst
- runtime-status, structure, projects, and overview snapshots each have their own cadence limits
- project execution refresh no longer implies a `projects.updated` snapshot by default, which removes a major source of redundant dashboard work during active sprints

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

Reconnect behavior:

- replay uses only replayable events for the subscribed scopes
- if a client missed a non-replayable live snapshot or the replay window is incomplete for that scope, the server returns `snapshot_required`
- the browser then falls back to the REST snapshot for that surface

### Websocket-first dashboard consumers

The first dashboard consumers now use websocket-first updates:

- `dashboard/src/hooks/use-dashboard-runtime-data.ts`
- `dashboard/src/hooks/use-overview-telemetry.ts`
- `dashboard/src/v2/hooks/use-project-execution.ts`
- `dashboard/src/v2/ChatPage.tsx`
- Chat subscriptions now also react to `conversation.thread.deleted`, so thread removal propagates across open dashboard tabs without a manual refresh.

Behavior:

- initial snapshot still comes from REST
- the v2 Live page now hydrates from one combined `/api/live` snapshot
- after hydration, the v2 Live page treats `project.live.updated` as the only authoritative websocket payload for selected-project runtime state
- websocket updates replace stale wait time for execution and overview telemetry
- project collection and selected-project context now refresh over websocket too
- sprint and task pages now react to project-structure invalidation events
- sprint and task hooks now treat realtime invalidation as silent background refresh, which avoids foreground loading flicker while the browser is already showing current data
- execution snapshot consumers now diff snapshots semantically instead of treating every fetch-time `updatedAt` stamp as a meaningful change
- git status is now folded into that same `/api/live` contract and refreshed server-side so the browser no longer polls git independently on the Live page
- reconnect recovery for the Live page now means re-fetching `/api/live` on `snapshot_required`, not running parallel status/execution repair logic in the browser
- polling remains a recovery tool for other websocket-backed dashboard surfaces, but the Live page no longer keeps its own steady-state poll loop

## Current Backend Integration Points

Realtime refresh scheduling is currently wired from:

- `src/repositories/execution-repository.ts`
- `src/repositories/connection-chat-repository.ts`
- `src/repositories/project-attention-repository.ts`

That means the browser is refreshed when execution state or live connection state changes in the DB-native runtime path.

The publisher intentionally ignores heartbeat-only execution writes where possible to avoid noisy event spam.

Additional March 15, 2026 tuning:

- noisy task-run updates and task-run event appends no longer force overview telemetry refresh on every mutation
- lease updates still refresh the project execution surface, but they no longer churn overview telemetry
- attention queue open/claim/resolve mutations now notify the live execution snapshot directly instead of waiting for a nearby side-effect refresh

Production refinement shipped on March 30, 2026:

- project execution, runtime-status, and structure refresh scheduling now also fan into `project.live.updated`, so the Live page always receives a fresh combined snapshot after any committed runtime mutation
- the server now performs a periodic background live-snapshot refresh for the selected project so git status and other slower-changing runtime metadata continue to stream even when no new task event is being written

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
- broader polling reduction for non-Live dashboard surfaces once websocket behavior has been hardened longer

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
