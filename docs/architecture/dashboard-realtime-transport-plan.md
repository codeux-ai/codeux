# Dashboard Realtime Transport Plan

## Status
Accepted implementation plan

## Decision

Code UX should add WebSockets for the dashboard control plane.

This is the right fit for:

- live sprint-run state
- task dispatch and task-run updates
- project live view updates
- cross-project overview telemetry
- chat thread and message updates
- live connection heartbeat and worker status

This is not the right fit for:

- MCP stdio clients
- the blocking MCP `listen` loop
- execution source of truth
- durable orchestration state

The database remains authoritative. WebSockets are only a delivery layer for committed runtime changes.

## Why We Need This

The current dashboard still relies heavily on polling:

- selected-project runtime and git status poll every `10s`
- overview telemetry polls every `10s`
- action feedback on sprint start/stop depends on the next refresh window
- live timelines can feel stale even when the backend already committed the new state

This causes real product issues:

- delayed sprint-card state transitions
- visible start/stop race windows
- live view showing stale running state
- telemetry that looks inactive or late even though execution is moving
- unnecessary repeated reads of the same execution snapshot

The DB-native execution model is already strong enough. The missing piece is push delivery to the dashboard.

## Why WebSockets Instead Of Replacing MCP Listen

The browser dashboard and MCP clients have different needs.

Dashboard browser:

- long-lived UI session
- needs many small updates
- benefits from push transport
- can reconnect automatically

MCP client:

- request/response tool contract
- needs one actionable item at a time
- must keep the model in a controlled loop
- already has the correct blocking `listen` behavior

So the architecture should be:

- WebSockets for dashboard realtime
- blocking `listen` for MCP listeners and workers

Do not merge those models together.

## Why WebSockets Instead Of SSE

SSE would work for simple one-way event streaming, but WebSockets are the better foundation here because Code UX needs:

- multiple runtime subscription scopes
- richer connection lifecycle handling
- future client acknowledgements and presence
- eventual fine-grained subscribe and unsubscribe behavior without opening many separate HTTP streams

We should still keep the wire protocol simple and mostly server-to-client at first. Choosing WebSockets now avoids a second transport migration later.

## Non-Negotiable Design Rules

### 1. DB write first, realtime emit second

Every state mutation must commit to sqlite before any websocket event is emitted.

Never let websocket state become authoritative.

### 2. REST remains the snapshot and mutation API

WebSockets should not replace:

- initial page loads
- create/update/delete actions
- control actions like start, stop, pause, retry, cancel

REST stays responsible for snapshots and commands.

WebSockets only push committed changes.

### 3. Realtime must be replay-safe

A reconnecting browser must be able to recover cleanly.

That means Code UX needs:

- event sequence ids
- resumable subscriptions or full snapshot fallback
- explicit snapshot refresh on sequence gaps

### 4. MCP listen remains unchanged

Do not redesign the MCP `listen` loop around websockets.

The normal stdio client and worker listener model stays:

- blocking
- one actionable item at a time
- explicit continuation guidance

### 5. Dashboard inactive states must stay explicit

If no sprint is running for the selected project:

- project live view stays inactive
- it must not animate like a live system

If no projects are active globally:

- overview telemetry stays inactive
- it must not imply background activity

Realtime improves freshness. It does not change those product rules.

## Recommended Transport Shape

Add one websocket endpoint on the dashboard server:

- `GET /api/realtime`

This endpoint should support scoped subscriptions after connect.

Initial subscription scopes:

- `overview`
- `project:<projectId>`
- `thread:<threadId>`

The browser should usually subscribe to:

- `overview` on the dashboard page
- `project:<selectedProjectId>` on live, sprints, tasks, and chat pages
- `thread:<threadId>` only when an active thread is open

## Event Envelope

Every websocket message should use one envelope shape.

Required fields:

- `sequence`
- `emittedAt`
- `scope`
- `eventType`
- `entityType`
- `entityId`
- `projectId`
- `sprintId`
- `payload`

Recommended optional fields:

- `threadId`
- `taskId`
- `dispatchId`
- `sprintRunId`
- `taskRunId`
- `connectionId`
- `correlationId`

Example event types:

- `snapshot_required`
- `project.execution.updated`
- `project.live_timeline.appended`
- `overview.telemetry.updated`
- `conversation.thread.updated`
- `conversation.message.created`
- `connection.updated`

## Event Source Model

Code UX should not emit websocket events ad hoc from random controllers.

Use a small internal realtime publisher layer with two responsibilities:

1. accept domain-level publish calls after successful writes
2. fan out normalized event envelopes to websocket subscribers

The publisher should be called from service and repository integration points that already define committed state boundaries, especially:

- sprint run creation and status changes
- task dispatch lifecycle changes
- task-run and sprint-run event insertion
- conversation thread assignment and message creation
- connection heartbeat and status transitions

## Durability Strategy

For a rock-solid foundation, Code UX should add a small durable replay log:

- table: `dashboard_realtime_events`

Suggested columns:

- `sequence INTEGER PRIMARY KEY AUTOINCREMENT`
- `scope_type`
- `scope_id`
- `event_type`
- `entity_type`
- `entity_id`
- `project_id`
- `sprint_id`
- `thread_id`
- `payload_json`
- `created_at`

Why this is worth it:

- reconnect recovery is deterministic
- sequence gaps are easy to detect
- telemetry rebuilds are auditable
- browser reconnect can replay from `lastSequence`
- websocket delivery bugs do not lose state history immediately

This is better than relying only on in-memory broadcasting.

## Subscription Model

### Overview scope

Used by:

- dashboard home telemetry

Streams:

- active project summary changes
- consolidated runtime timeline entries
- high-level connection and worker changes for active projects

### Project scope

Used by:

- live page
- sprints page
- tasks page
- chat page

Streams:

- sprint-run lifecycle
- dispatch lifecycle
- runtime timeline append
- connection status changes for that project
- thread and message updates for that project

### Thread scope

Used by:

- active open chat thread

Streams:

- new dashboard messages
- listener replies
- thread assignment changes
- unread and pending state changes

## Frontend Architecture Plan

### 1. Add one shared realtime client

Create one dashboard-side client module responsible for:

- opening the websocket
- reconnecting with backoff
- sending subscribe and unsubscribe messages
- tracking `lastSequence`
- notifying consumers
- filtering out stale socket events via strict identity checks
- completely cleaning up timers and cleanly resetting state on disconnect

This should be shared across dashboard pages instead of each page opening its own socket.

### 2. Keep fetch-first rendering

Every page still loads its initial snapshot via REST.

Then the websocket layer applies incremental updates on top.

This avoids blank screens during reconnect and keeps deep links stable.

### 3. Use websocket for freshness, polling for recovery fallback

Phase rollout should keep lightweight fallback polling while websocket matures.

Recommended rollout:

- execution and telemetry pages switch to websocket-first
- keep a slower fallback poll, for example `30-60s`
- if a sequence gap or reconnect failure occurs, force a REST snapshot refresh

### 4. Update local optimistic actions to reconcile with events

Start/stop/retry/cancel buttons should:

- keep local pending animations immediately
- reconcile to authoritative backend state from websocket events
- clear pending state when the matching event arrives

This removes current “wait for next poll” lag without inventing fake final states.

## Backend Rollout Phases

## Phase 1: Realtime foundation

Goal:

- add websocket endpoint
- add publisher abstraction
- add durable replay log
- add subscribe and resume protocol

Deliverables:

- `dashboard_realtime_events` schema
- websocket server wiring in `src/server/dashboard-server.ts`
- internal publisher service
- replay from `lastSequence`
- `snapshot_required` event on unrecoverable gap

Definition of done:

- browser can connect, subscribe, resume, and receive heartbeat-safe events
- reconnect does not require page reload

## Phase 2: Project execution live updates

Goal:

- eliminate 10-second lag on selected-project live state

Streams:

- `sprint_runs`
- `task_dispatches`
- `task_run_events`
- `sprint_run_events`
- connection summaries for the selected project

Frontend targets:

- `dashboard/src/hooks/use-dashboard-runtime-data.ts`
- `dashboard/src/v2/LiveSessionPage.tsx`
- `dashboard/src/v2/SprintsPage.tsx`

Definition of done:

- sprint cards and live runtime reflect start/stop/cancel nearly immediately
- live page falls back to waiting state immediately after stop or cancel commits

## Phase 3: Overview telemetry realtime

Goal:

- replace polling-driven overview telemetry with push updates

Streams:

- active project summaries
- consolidated recent runtime events

Frontend targets:

- `dashboard/src/hooks/use-overview-telemetry.ts`
- `dashboard/src/v2/components/OverviewTelemetry.tsx`

Definition of done:

- dashboard overview only animates when there are real active projects
- no active projects means stable inactive telemetry state

## Phase 4: Chat and connections realtime

Goal:

- make thread assignment, replies, and connection heartbeats live

Streams:

- conversation thread updates
- conversation message creation
- connection state changes

Frontend targets:

- `dashboard/src/v2/ChatPage.tsx`
- live connections panel in `dashboard/src/v2/LiveSessionPage.tsx`

Definition of done:

- assignment changes appear without refresh
- replies stream into the active thread without manual reload
- stale/offline transitions are visible promptly

## Phase 5: Polling reduction and hardening

Goal:

- reduce unnecessary snapshot polling while keeping safe fallback behavior

Deliverables:

- longer fallback poll intervals
- reconnect and backoff metrics
- sequence-gap monitoring
- explicit dashboard banner for degraded realtime mode

Definition of done:

- dashboard remains usable when websocket drops
- normal runtime operation no longer depends on frequent polling

## Message Flow Examples

### Sprint start

1. dashboard sends REST start command
2. backend creates `sprint_run`
3. backend commits DB write
4. backend publishes `project.execution.updated`
5. sprints page and live page receive event
6. pending start animation resolves into authoritative running state

### Sprint stop

1. dashboard sends REST cancel or pause command
2. backend updates `sprint_run` and dispatch state
3. backend commits DB write
4. backend publishes updated execution and runtime timeline events
5. live page immediately leaves active-running state when no run remains active

### Dashboard message reply

1. dashboard posts message via REST
2. DB stores message as pending
3. listener receives it through MCP `listen`
4. listener replies
5. backend stores reply
6. websocket pushes `conversation.message.created`
7. open thread updates immediately in browser

## Operational Concerns

### Resource control

Add server-side limits for:

- max websocket clients
- max subscriptions per client
- max replay window size per reconnect
- max websocket accumulated buffer size (1MB): closes socket on violation to prevent OOM
- max websocket frame payload size (512KB): closes socket on violation to prevent OOM

### Observability

Track:

- active websocket connection count
- subscribe and unsubscribe counts
- reconnect rate
- replay success and replay gap rate
- average event fanout size
- queue delay from DB commit to emit

### Security

Dashboard realtime should inherit the same local access model as the dashboard server.

If dashboard auth is strengthened later, websocket auth must follow the same mechanism.

Do not introduce a separate weak auth model for realtime.

## What We Should Not Do

- Do not replace REST mutations with websocket commands first.
- Do not replace MCP `listen` with websockets.
- Do not emit directly from UI-only handlers without a committed DB write.
- Do not use in-memory-only broadcasting as the final architecture.
- Do not animate telemetry or live views when no project or sprint is active.

## Recommended Next Implementation Order

1. add the durable realtime event table and publisher abstraction
2. add websocket endpoint and subscription protocol on the dashboard server
3. switch project execution live updates to websocket-first with polling fallback
4. switch overview telemetry to websocket-first
5. switch chat and live connection surfaces to websocket-first
6. then reduce background polling intervals

## Expected Outcome

If implemented this way, Code UX gets:

- much faster dashboard feedback
- fewer stale-control race conditions
- cleaner live and telemetry behavior
- lower repeated polling load
- no regression to MCP listener behavior
- a durable, debuggable realtime foundation instead of another temporary shortcut

## Realtime Backpressure and Metrics

To maintain reliability under heavy load, the internal realtime publisher tracks several backpressure metrics per scope. These metrics are available for observability and are updated continuously:

- `coalesced`: The number of times a publish request was deduplicated because an identical request was already pending in the active flush debounce window.
- `throttled`: The number of times a scheduled snapshot was skipped because the request arrived sooner than the defined minimum interval (e.g. `PROJECT_LIVE_MIN_INTERVAL_MS`).
- `unchanged`: The number of times a snapshot loader successfully ran, but the resulting payload fingerpint was identical to the previously published value, skipping network broadcast.
- `published`: The number of times a raw realtime event was successfully appended and broadcasted to listeners.
- `failures`: The number of times a snapshot loader or publisher pipeline threw an unhandled error during the publish task.

These metrics ensure we can verify backpressure logic (such as coalescing high-frequency execution refreshes) functions smoothly without impacting client contracts.
