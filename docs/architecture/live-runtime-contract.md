# Live Runtime Contract

The Live snapshot (`ProjectLiveDashboardSnapshot`) serves as the authoritative boundary contract for the Live dashboard page and websocket realtime stream.

For the bounded snapshot, cache, realtime delivery, and dashboard view-model guardrails that apply when changing this contract, see [Code Quality And Performance Contracts](./code-quality-performance-contracts.md).

## Core Boundary Contract

1. **SQLite is the Absolute Source of Truth:**
   The database holds the definitive state for project metadata, task execution, assigned workers, chat threads, and sprint activity. No single module is the global truth; the database schema as a whole represents the system state.

2. **The Server Assembles the Snapshot:**
   The `getProjectLiveSnapshot` module (`src/app/live/project-live-snapshot.ts`) is the unified assembly path. It reads data across repositories to compute a complete projection for a project in a specific moment.
   Snapshot assembly first resolves and validates the project identity plus selected sprint scope through `ProjectManagementRepository`. After that scope is fixed, the project runtime status read, execution snapshot read, and optional git/CI/PR status read are independent and run concurrently. This keeps the boundary deterministic while preventing slow external git tracking or heavy execution queries from serializing unrelated repository work. Each section still reports its own elapsed duration in the `project_live_snapshot_assembled` log event; the total build time reflects the overlapped wall-clock path.

3. **Websockets Transport Committed Changes:**
   The realtime service (`DashboardRealtimeService`) strictly listens for database commits (e.g., SQLite `UPDATE`, `INSERT`) and triggers the snapshot assembly path. It publishes the newly assembled `ProjectLiveDashboardSnapshot` over the websocket. The websocket transport itself is stateless and relies completely on the backend snapshot assembly.

4. **The Browser Renders (No Reconciling):**
   The browser UI renders the exact snapshot it receives over HTTP `/api/live` or websockets. It does not attempt to reconcile competing sources, merge partial updates manually, or maintain local hidden state that contradicts the snapshot.
   Live task cards may still derive display-only task runtime fields such as the latest session id, PR URL, worker branch, and display phase from the current sprint-scoped dispatch/event history that already exists inside the same snapshot. This is a projection step inside the snapshot boundary, not a second source of truth.

5. **Dashboard View-Model Boundary:**
   Live Session render-time projections live in pure dashboard helpers under `dashboard/src/v2/lib/`, with `live-session-view-model.ts` owning deterministic sprint-scoped runtime collections, projected task display state, task filter counts, task-card invocation feeds, duration ticker eligibility, and transport banner state. `LiveSessionPage` memoizes calls into these helpers and keeps hooks, local optimistic action state, and JSX composition in the component. This keeps large task lists from rebuilding indexes ad hoc during render and makes missing snapshots, stale transport states, and invocation selection testable without mounting the full page.

6. **Semantic Snapshot Equality:**
   Top-level snapshot timestamps are assembly metadata. The realtime service deduplicates `project.live.updated` and `project.execution.updated` using semantic signatures for project/sprint scope, status fields, execution slices, git status, and relevant runtime counters instead of raw `updatedAt` or `timestamp` churn. Unknown payload shapes still fall back to full-payload fingerprinting with `updatedAt` and `timestamp` ignored.

7. **Browser Stabilization:**
   `useDashboardRuntimeData` applies `stabilizeProjectLiveDashboardSnapshot` before equality checks. Project or selected-sprint changes bypass stabilization, while unchanged status, execution, git, and nested execution lists keep their previous references. Active execution snapshots are not replaced by stale empty snapshots during recovery, and missing task runtime metadata can be carried forward only inside the same project and sprint scope.
   Status task stabilization is semantic rather than payload-deep: equality covers the task identity, rendered title/prompt/dependency/status fields, provider/session metadata, worker branch, PR URL, merge indicators, intervention hints, and QA/review summaries used by Live task cards and task board surfaces. Assembly timestamps, large activity payload churn, and unknown non-rendered task fields must not invalidate the status snapshot or unrelated execution list references. Any field visible in `LiveTaskCard`, `ExecutionRuntimePanel`, or `TasksPage` must be added to this explicit comparison before the UI depends on it.
   Execution list stabilization is also per-surface semantic. Unchanged `sprintRuns`, `taskDispatches`, `connections`, `attentionItems`, `recentEvents`, and `recentInvocations` reuse the previous list reference even when sibling feeds update, while rendered runtime changes such as statuses, heartbeat/finish markers, error messages, session/provider/branch/PR metadata, counters, and displayed review/intervention text replace the affected list.

## Field Ownership & Mutation Triggers

The top-level fields within `ProjectLiveDashboardSnapshot` are explicitly owned and mapped back to strict backend origins:

- **`projectId`**:
  - **Owned By:** `ProjectManagementRepository`
  - **Mutated:** When a project is created, selected, or changed via the system.
- **`selectedSprintId`**:
  - **Owned By:** `ProjectManagementRepository`
  - **Mutated:** When a new sprint is created, or the user navigates between sprints.
- **`status`**:
  - **Owned By:** `ProjectRuntimeRepository`
  - **Mutated:** When task states change, a sprint is run, or the orchestration loop updates progress markers.
  - **Write Rules:** Dashboard status sync batches runtime artifact ownership checks and task-run candidate reads before writing task rows. Terminal planning state is monotonic: completed/merged tasks cannot be downgraded by stale snapshots, and `coding_completed` is preserved over older pending/running payloads. If an incoming snapshot still reports a task as running while the linked dispatch or latest provider invocation is already terminal, live sync closes the stale active `task_runs` row from that terminal evidence so provider concurrency and dependency projections do not wait for restart recovery.
- **`execution`**:
  - **Owned By:** `ExecutionRepository` (assembled via `getProjectExecutionSnapshot`)
  - **Mutated:** When sprint runs are dispatched, worker states change, attention items are created/claimed, invocation records/messages are written, or chat threads progress.
  - **Live Invocation Feed:** The execution projection includes `recentInvocations` from `execution_invocations`. `/api/live` passes the selected sprint id into execution snapshot assembly, which merges the latest project-wide records, all records for expanded active/paused/queued sprint runs, and all records for the selected sprint. The Live page renders selected-sprint invocations beside the runtime feed so operators can inspect paused or stopped sprint history even when other sprints are active. Task cards also derive task-scoped invocation feeds from this same list using task, dispatch, and task-run identity. Full transcripts remain linked through the Chat invocation view.
- **`gitStatus` / `gitStatusError`**:
  - **Owned By:** The external git/system environment.
  - **Mutated:** Dynamically tracked when local branches, origin synchronization, or pending PRs change.
- **`updatedAt`**:
  - **Owned By:** The `getProjectLiveSnapshot` module.
  - **Mutated:** Upon every snapshot assembly call to provide an accurate rendering timestamp.

## Observability, Recovery, and Degraded Modes

1. **Guardrails Against Split Authority:**
   Because the server is the single assembly authority, local browser state must never drift. If the browser receives a gap in the sequence stream (e.g., from network instability), it triggers a `snapshot_required` fallback and immediately drops any partial websocket patches until a full REST `/api/live` payload is loaded, enforcing that there is no split-brain runtime state.

2. **Degraded-Mode UX:**
   The `DashboardRealtimeClient` drives deterministic degraded UI modes. If the WebSocket disconnects, the transport transitions through `connecting`, `connected`, `reconnecting`, and `disconnected` states. The UI reflects these states natively without mutating the source-of-truth live snapshots, ensuring the user knows the data is stale rather than attempting to guess the current system state.

3. **Diagnostics and Metrics:**
   For observability, the assembly path is benchmarked (e.g., `scripts/measure-live-snapshot.ts`) to track latency and payload size. These metrics guarantee that as the `ProjectLiveDashboardSnapshot` grows, the backend can continually assemble and deliver it within real-time latency budgets. To further ensure predictable latency, the snapshot projection explicitly avoids issuing empty usage and wall-time rollup queries for idle projects, preventing database query bloat during repeated live refresh cycles.

4. **Reconnect and Restart Recovery Rules:**
   When a client reconnects, it receives only replayable events for its subscribed scopes. If a client misses a non-replayable snapshot, the transport natively handles gap detection by forcing a complete snapshot reload rather than replaying outdated or heavy payloads from the SQLite event log.

5. **WebSocket Delivery Boundaries:**
    Live dashboard snapshots are delivered on the dedicated `project:<projectId>:live` scope as non-replayable `project.live.updated` events. Plain `project:<projectId>` subscribers do not receive the heavy Live payload. The websocket server asks the realtime service for scope interest, skips serialization entirely when no client is subscribed to an event scope, encodes one frame per event, and reuses that buffer for all matching subscribers. Per-subscriber backpressure checks can disconnect slow clients without changing the payload delivered to healthy tabs.

6. **Client Delivery Behavior:**
    The browser still loads the first snapshot through REST and then applies matching websocket payloads directly. Direct payloads are coalesced to one render per animation frame, with a timeout fallback, so bursts of large snapshots do not saturate the main thread. `snapshot_required` messages always trigger a silent REST refresh, and the client suppresses repeated `snapshot_required` notifications for a short cooldown while continuing to process normal event and subscription messages.

7. **Automation Handoff Consistency:**
   When orchestration automatically approves a plan, answers a clarification, or resumes a paused task, the execution tables are updated immediately to clear the prior blocked/error dispatch state for that task run. This prevents stale "action required" warnings from surviving on Live task cards after automation has already taken ownership of the handoff.

8. **Cache TTLs and Invalidation Policies:**
    To guarantee real-time latency budgets, portions of the snapshot are aggressively cached by the `DashboardSnapshotCache`. Cache policies (TTLs and invalidation keys) are explicitly defined in `src/app/lifecycle/dashboard-snapshot-cache-policy.ts`. Current baseline TTLs are 500ms for global telemetry and 2s for project-level stats and execution snapshots. Cached snapshots are immutable to ensure safe concurrent reads without deep cloning. Execution snapshot caches are scoped by a typed project execution key containing the project id and explicit selected-sprint state: either `selected` with the sprint id or `none` when no sprint is selected. Full snapshots and feed-less lean snapshots use the same scope, so `/api/live` selected-sprint payloads and `project.execution.updated` lean payloads cannot reuse a project-only entry for a different selected sprint. `invalidateProjectExecution(projectId)` clears every full and lean execution entry for that project across all selected-sprint scopes. Additionally, live activity streams utilize a short negative cache TTL (e.g., 2s) to briefly suppress repeated failing or empty fetches for running sessions, preserving fast refresh for active sessions while protecting downstream dependencies from noisy retries.

## 11. Optimistic UI and Accessibility Guidelines
When the UI initiates an action (such as pausing a sprint, claiming an attention item, or rerunning a task), the client should rely on optimistic state markers to provide immediate feedback without waiting for the next snapshot. During these pending states, and for dynamic real-time areas:

- **Pending Controls:** Action buttons must use `aria-disabled="true"` and `aria-busy="true"` (rather than simply `disabled="true"`) to prevent interaction while retaining focus visibility. A visually hidden element (`<span className="sr-only">`) should be embedded within the control to explain the pending state (e.g., "Pausing...").
- **Dynamic Content:** Containers for realtime updates (such as event feeds, connection lists, and heartbeat timestamps) must implement `aria-live="polite"` so screen readers appropriately announce updates. Critical recovery or disconnection banners should use `aria-live="assertive"` or `role="alert"`.
- **Status Tones:** Feedback surfaces and error boundaries must consistently use standardized T04 dashboard status tones and apply `aria-busy="true"` when in recovery modes.

## 12. Live Runtime Feedback Surfaces

Live runtime panels preserve the last valid execution snapshot during recovery and stale-data windows. The transport banner distinguishes connection errors, disconnected transport, reconnecting transport, background refresh, first-snapshot recovery, and stale cached snapshots with visible titles, static status icons, `aria-live`, and `aria-busy` state. Assertive announcements are reserved for blocking errors and disconnected transport; stale data, background refresh, reconnecting, and first-snapshot recovery remain polite status updates. Reconnect and disconnect copy must explicitly say that cached runtime data remains visible when a cached snapshot exists.

Collapsible runtime panels keep their trigger focused, expose `aria-expanded` and `aria-controls`, and hide collapsed panel bodies from assistive technology with `aria-hidden` while the visual height collapses. Headers for connection panels, invocation feeds (`InvocationFeedPanel` with invocation restart/cancel capabilities), attention queues (now the dedicated `AttentionLedger` sidebar component), and execution runtime panels must retain visible summary counts while collapsed so operators can understand active, failed, open, claimed, or completed work without expanding the panel. Note that `LiveConnectionsCard` is separated and no longer embedded directly into `ExecutionRuntimePanel`. Expansion/collapse and banner transitions use shared interaction token hooks so reduced-motion preferences resolve to instant state changes without hardcoded timing.

Runtime action controls derive their pending display from dashboard view-model helpers. Pending controls keep focusable button semantics, expose `aria-disabled="true"` and `aria-busy="true"`, suppress duplicate activation, and include stable visible labels plus screen-reader status text for initiation and in-progress states. Disabled and pending buttons must expose a visible or described reason through persistent status text, `title`, or `aria-describedby`; they must not rely on click-time feedback from inert controls. Snapshot rows remain readable during background refresh; cached content is not hidden unless the execution snapshot is genuinely unavailable.

Invocation rows use tokenized `controlFeedback` highlights for status changes. Reduced-motion mode replaces pulses and fades with static borders, rings, badges, and polite count summaries for new or queued, running, completed, and failed invocations. Failed invocation summaries may use alert semantics because they indicate blocking operator review, while normal count changes stay polite.

Task-level runtime actions must also surface their optimistic state on the affected task card, not only in toast feedback. Force-complete immediately projects the task as completed, marks the control busy, shows an inline polite status message, and suppresses duplicate activations until the request settles. If the request fails, the task card rolls back to the snapshot-backed task phase and shows the task-specific error inline with `role="alert"`.

Task filters and header visualization tabs announce their selected result state through polite live regions. The task filter controls use the `selectionMovement` interaction contract and the task list uses `listReorder` timing so changing filters or header views communicates movement without abrupt content replacement. Reduced-motion users receive static status cues such as persistent rings or color changes instead of pulse/spin-only feedback.
