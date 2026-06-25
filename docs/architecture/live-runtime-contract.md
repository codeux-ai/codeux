# Live Runtime Contract

The Live snapshot (`ProjectLiveDashboardSnapshot`) serves as the authoritative boundary contract for the Live dashboard page and websocket realtime stream.

## Core Boundary Contract

1. **SQLite is the Absolute Source of Truth:**
   The database holds the definitive state for project metadata, task execution, assigned workers, chat threads, and sprint activity. No single module is the global truth; the database schema as a whole represents the system state.

2. **The Server Assembles the Snapshot:**
   The `getProjectLiveSnapshot` module (`src/app/live/project-live-snapshot.ts`) is the unified assembly path. It reads data across repositories to compute a complete projection for a project in a specific moment.

3. **Websockets Transport Committed Changes:**
   The realtime service (`DashboardRealtimeService`) strictly listens for database commits (e.g., SQLite `UPDATE`, `INSERT`) and triggers the snapshot assembly path. It publishes the newly assembled `ProjectLiveDashboardSnapshot` over the websocket. The websocket transport itself is stateless and relies completely on the backend snapshot assembly.

4. **The Browser Renders (No Reconciling):**
   The browser UI renders the exact snapshot it receives over HTTP `/api/live` or websockets. It does not attempt to reconcile competing sources, merge partial updates manually, or maintain local hidden state that contradicts the snapshot.
   Live task cards may still derive display-only task runtime fields such as the latest session id, PR URL, worker branch, and display phase from the current sprint-scoped dispatch/event history that already exists inside the same snapshot. This is a projection step inside the snapshot boundary, not a second source of truth.

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
- **`execution`**:
  - **Owned By:** `ExecutionRepository` (assembled via `getProjectExecutionSnapshot`)
  - **Mutated:** When sprint runs are dispatched, worker states change, attention items are created/claimed, or chat threads progress.
- **`gitStatus` / `gitStatusError`**:
  - **Owned By:** The external git/system environment.
  - **Mutated:** Dynamically tracked when local branches, origin synchronization, or pending PRs change.
- **`updatedAt`**:
  - **Owned By:** The `getProjectLiveSnapshot` module.
  - **Mutated:** Upon every snapshot assembly call to provide an accurate rendering timestamp.

## Observability, Recovery, and Degraded Modes

5. **Guardrails Against Split Authority:**
   Because the server is the single assembly authority, local browser state must never drift. If the browser receives a gap in the sequence stream (e.g., from network instability), it triggers a `snapshot_required` fallback and immediately drops any partial websocket patches until a full REST `/api/live` payload is loaded, enforcing that there is no split-brain runtime state.

6. **Degraded-Mode UX:**
   The `DashboardRealtimeClient` drives deterministic degraded UI modes. If the WebSocket disconnects, the transport transitions through `connecting`, `connected`, `reconnecting`, and `disconnected` states. The UI reflects these states natively without mutating the source-of-truth live snapshots, ensuring the user knows the data is stale rather than attempting to guess the current system state.

7. **Diagnostics and Metrics:**
   For observability, the assembly path is benchmarked (e.g., `scripts/measure-live-snapshot.ts`) to track latency and payload size. These metrics guarantee that as the `ProjectLiveDashboardSnapshot` grows, the backend can continually assemble and deliver it within real-time latency budgets.

8. **Reconnect and Restart Recovery Rules:**
   When a client reconnects, it receives only replayable events for its subscribed scopes. If a client misses a non-replayable snapshot, the transport natively handles gap detection by forcing a complete snapshot reload rather than replaying outdated or heavy payloads from the SQLite event log.

9. **Automation Handoff Consistency:**
   When orchestration automatically approves a plan, answers a clarification, or resumes a paused task, the execution tables are updated immediately to clear the prior blocked/error dispatch state for that task run. This prevents stale "action required" warnings from surviving on Live task cards after automation has already taken ownership of the handoff.

10. **Cache TTLs and Invalidation Policies:**
    To guarantee real-time latency budgets, portions of the snapshot are aggressively cached by the `DashboardSnapshotCache`. Cache policies (TTLs and invalidation keys) are explicitly defined in `src/app/lifecycle/dashboard-snapshot-cache-policy.ts`. Current baseline TTLs are 500ms for global telemetry and 2s for project-level stats and execution snapshots. Cached snapshots are immutable to ensure safe concurrent reads without deep cloning.

## 11. Optimistic UI and Accessibility Guidelines
When the UI initiates an action (such as pausing a sprint, claiming an attention item, or rerunning a task), the client should rely on optimistic state markers to provide immediate feedback without waiting for the next snapshot. During these pending states, and for dynamic real-time areas:

- **Pending Controls:** Action buttons must use `aria-disabled="true"` and `aria-busy="true"` (rather than simply `disabled="true"`) to prevent interaction while retaining focus visibility. A visually hidden element (`<span className="sr-only">`) should be embedded within the control to explain the pending state (e.g., "Pausing...").
- **Dynamic Content:** Containers for realtime updates (such as event feeds, connection lists, and heartbeat timestamps) must implement `aria-live="polite"` so screen readers appropriately announce updates. Critical recovery or disconnection banners should use `aria-live="assertive"` or `role="alert"`.
- **Status Tones:** Feedback surfaces and error boundaries must consistently use standardized T04 dashboard status tones and apply `aria-busy="true"` when in recovery modes.
