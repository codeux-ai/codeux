# Execution Dashboard Projection

This page describes the DB-backed execution snapshot now exposed to the dashboard.

## Purpose

`/api/status` is still useful for task-centric protocol output, but it is not enough to observe the full control plane.

Code UX now projects execution state directly from sqlite into a dedicated dashboard payload so the UI can see:

- sprint runs
- task dispatch queue state
- live MCP connections for the selected project
- worker assignment
- active lease ownership
- durable per-sprint planning and human-intervention workflow evidence
- recent task-run events

## API Surface

Implemented in `src/server/dashboard-server.ts`.

Endpoints:

- `GET /api/execution`
  - returns the selected project's lean execution snapshot without heavy recent feeds
- `GET /api/projects/:projectId/execution`
  - returns the full execution snapshot for a specific project, including bounded `recentEvents` and `recentInvocations`
- `GET /api/projects/:projectId/stats?window=24h|7d|30d|all|custom&from=YYYY-MM-DD&to=YYYY-MM-DD`
  - returns the project statistics snapshot used by the Stats page
  - `custom` requires both `from` and `to`

## Snapshot Shape

The payload includes:

- `projectId`
- `projectName`
- `query`
- `range`
- `updatedAt`
- `sprintRuns`
- `taskDispatches`
- `connections`
- `attentionItems`
- `sprintWorkflowProjections`
- `recentEvents`
- `recentInvocations`

### `sprintWorkflowProjections`

Each compact entry contains `sprintId`, `planningStatus`, and the current strict
task-level `humanIntervention`, if one exists. This projection is assembled from
the durable SQLite rows rather than the bounded activity feeds, and it remains
present in lean execution snapshots.

Planning recency is based on invocation identity (`started_at`, then
`created_at`, then stable row/ID tie-breakers), so a late update to an older
planning attempt cannot shadow a newer attempt. Human escalation is deliberately
narrow: only active `open`/`claimed`, human- or user-owned task items with no
assigned worker endpoint qualify. Project-level, worker/system-owned, resolved,
and worker-assigned attention never promotes the sprint badge.

### `sprintRuns`

Each run includes:

- sprint identity
- run status
- trigger type and trigger owner
- executor mode
- heartbeat timestamps
- active sprint lease owner
- rolled-up usage totals for provider time, wall time, and tokens

### `taskDispatches`

Each dispatch includes:

- task and sprint identity
- dispatch status
- executor type
- bound connection metadata
- latest task-run state
- provider/session/pr metadata
- active task-dispatch lease owner
- rolled-up usage totals for provider time, wall time, and tokens

### `recentEvents`

Each event includes:

- task and sprint identity
- task-run and dispatch identity
- event type and originator
- provider/session/branch/PR context
- connection metadata when a worker is involved
- parsed event payload

### `connections`

Each connection summary includes:

- runtime identity and transport
- project scope
- heartbeat-derived status
- listening metadata
- inbox, thread, dispatch, and task-run counters

Current event coverage includes:

- dispatch and worker lifecycle
- provider session sync and provider activity
- direct CLI workflow stage transitions
- CI and merge-gate status changes

## Repository Source

Projection is built in:

- `src/repositories/execution-repository.ts` (public API boundary and snapshot orchestrator)
- `src/repositories/execution/project-execution-snapshot-query.ts` (dashboard snapshot coordination and usage/wall-time mappings)
- `src/repositories/execution/execution-sprint-runs-query.ts` (sprint runs slice query)
- `src/repositories/execution/execution-task-dispatches-query.ts` (dispatches slice query)
- `src/repositories/execution/execution-runtime-events-query.ts` (events slice query)
- `src/repositories/execution/execution-invocations-query.ts` (recent, expanded-run, and selected-sprint invocation feed)
- `src/repositories/execution/execution-sprint-workflow-projection-query.ts` (durable sprint planning and strict task-human escalation evidence)
- `src/repositories/execution/execution-usage-query.ts` (provider usage mapping and rollups)
- `src/repositories/execution/execution-wall-time-query.ts` (wall-time duration projection and DB-driven cache)
- `src/repositories/execution/execution-human-intervention-query.ts` (operator attention formatting)

It joins:

- `sprint_runs`
- `task_dispatches`
- `task_runs`
- `task_run_events`
- `provider_invocations`
- `tasks`
- `sprints`
- `mcp_connections`
- `execution_leases`

This keeps the dashboard read path aligned with the same DB-native runtime records the orchestrator and workers update.

For the repository-wide quality and performance invariants that protect this read path, including scoped execution caches and indexed projection slices, see [Code Quality And Performance Contracts](./code-quality-performance-contracts.md).

## Current UI Usage

The v2 live page now renders an execution runtime panel showing:

- active sprint runs
- active dispatch counts
- live project connections with inbox and dispatch load
- queued and running worker dispatches
- current lease owners
- a DB-backed runtime timeline
- Sprint Clock telemetry for finished, average-finished, accumulated stage time, and token totals, scoped to the relevant sprint run with dispatch usage preferred and sprint-run usage as fallback

That makes multi-sprint and worker execution visible without reconstructing state from task markdown or process-local globals.

## Backend Read-Model Optimizations

To support the dashboard resource layer and page-scoped module boundaries, the backend read-model optimizations project data efficiently without altering the underlying data structures. **API routes and backend contracts remain unchanged.** The project execution snapshot path performs one coordinated pass per slice, then uses precomputed ID sets and maps for secondary enrichment:

- Sprint runs are fetched as all active expanded runs (`running`, `queued`, `paused`, and `cancel_requested`) plus enough inactive runs to reach a 12-run visible tail. If no active run exists, the newest visible run is still expanded so the runtime panel has context.
- Task dispatches are fetched as a 24-row recent-project slice plus an expanded sprint-run slice and then collapsed in memory to the latest dispatch per task. Recency uses heartbeat, start, claim, and queue timestamps with stable ID tie-breaks so stale terminal retries do not shadow newer work.
- Runtime events are fetched as explicit bounded slices: a 240-event project-recent task-event slice, a 240-event project-recent sprint-run-event slice, a 120-event selected-sprint slice when a sprint is selected, and up to 120 task-run events per expanded sprint run. `status_sync` events are excluded from the live feed because they are internal signature bookkeeping. Expanded task events are excluded from the project-recent task slice to avoid duplicate SQL work, selected-sprint events are pinned before the final cap, and all slices are deduplicated by event ID, sorted by `created_at DESC, id DESC`, and capped at 300 events for realtime payload size. This means chatty expanded runs stay bounded by run while quieter expanded runs and older selected-sprint activity can still survive the final merge.
- Invocations are fetched as explicit bounded slices for the 24 most recent project invocations, up to 24 invocations per expanded sprint run, and up to 24 invocations for the optional selected sprint. The hot selected-sprint and expanded-run predicates use authoritative `execution_invocations.sprint_id` and `execution_invocations.sprint_run_id` columns so SQLite can walk the project/sprint and project/sprint-run recency indexes directly. Each scoped slice also runs a small provider-context fallback query for legacy rows whose execution invocation context is legitimately missing, using provider invocation context only when the corresponding execution column is `NULL`. The slices are merged and deduplicated in memory by invocation ID using the same `started_at DESC, rowid DESC` recency rule. This preserves selected-sprint and expanded-run visibility, including inactive selected sprints, without switching live snapshots to full-history reads.
- Sprint workflow evidence is queried independently of those bounded feeds. The newest planning attempt per sprint is ranked by start/creation identity, while strict unassigned task-human interventions are ranked per sprint across the full active attention table. A valid intervention therefore remains visible even when more than 50 newer or higher-severity attention rows occupy the operator activity feed.
- Usage and wall-time rollups deduplicate sprint-run IDs and task IDs before executing chunked `IN` aggregations, then map totals by ID for the final DTO mapping.

The hot live snapshot reads are backed by explicit startup-safe sqlite indexes in both fresh schema initialization and migrations for existing databases:

- `sprint_runs` uses `idx_sprint_runs_project_status_recency` for project/status filters and lifecycle recency ordering across heartbeat, update, and creation timestamps.
- `task_dispatches` uses `idx_task_dispatches_project_task_recency` and `idx_task_dispatches_project_sprint_run_recency` for the latest-dispatch-per-task window and expanded sprint-run dispatch reads.
- `task_runs` uses `idx_task_runs_project_sprint_lookup` and `idx_task_runs_project_sprint_run_lookup` to anchor selected-sprint and expanded-run runtime-event slices before joining to event rows.
- `task_run_events` uses `idx_task_run_events_task_run_created_id` for per-task-run event walks with stable `created_at DESC, id DESC` ordering, while `idx_task_run_events_project_created` continues to support the project-recent slice.
- `sprint_runs` uses `idx_sprint_runs_project_lookup` and `sprint_run_events` uses `idx_sprint_run_events_sprint_run_created_id` so sprint-run event slices can stay scoped to the project or selected sprint while walking `(sprint_run_id, created_at DESC, id DESC)` event timelines.
- `project_attention_items` uses `idx_project_attention_items_project_status_updated` for active project attention reads ordered by latest update.
- `project_attention_items` also uses `idx_project_attention_items_project_status_updated_opened` and `idx_project_attention_items_sprint_run_status_updated_opened` for active attention slices ordered by update, open time, and ID.
- `project_attention_items` uses `idx_project_attention_items_workflow_projection` for the strict owner/status/assignment sprint workflow scan.
- `execution_invocations` uses `idx_execution_invocations_project_started` for the bounded project-recent subquery, plus `idx_execution_invocations_project_sprint_started` and `idx_execution_invocations_project_sprint_run_started` for selected-sprint and expanded-run filters before the final `started_at DESC, rowid DESC` merge ordering.
- `execution_invocations` uses `idx_execution_invocations_project_type_sprint_started_created` to rank durable planning attempts per sprint without scanning unrelated task invocations.
- `execution_invocations` uses `idx_execution_invocations_provider_invocation` so provider-context fallback slices can join back to execution invocation records without scanning the invocation table.
- `execution_invocations` uses `idx_execution_invocations_status_started` for active and retry-recovery scans by invocation status.
- `provider_invocations` uses `idx_provider_invocations_project_sprint_started` and `idx_provider_invocations_project_sprint_run_started` so legacy provider-linked rows can still supply sprint and sprint-run context during fallback joins while staying scoped to the selected project. The older sprint and sprint-run recency indexes remain available for non-project-scoped provider usage paths.

These indexes only cover scalar identifiers, status fields, and timestamps. They intentionally avoid JSON expressions, markdown, prompts, transcripts, and other large payload columns so live dashboard polling improves read locality without increasing write amplification on volatile text content.

Expected scaling is bounded by slice count rather than task count: adding more tasks to the visible snapshot should not add per-task provider-usage, wall-time, task-run, runtime-event, or invocation follow-up reads. The only growth-sensitive reads are chunked `IN` queries, which batch IDs through the database adapter and keep compatibility with both file-backed and in-memory Vitest SQLite databases.

The v2 stats page reads the adjacent project statistics snapshot and renders:

- adaptive hourly, daily, or weekly usage graphs for `24h`, `7d`, `30d`, `all time`, and custom windows
- drag-to-zoom analysis inside the active graph window
- task and sprint usage leaderboards
- provider and execution-purpose splits
- telemetry confidence based on reported versus estimated token counts

## Live Task Timing Reconciliation

The live task timing model now treats the execution snapshot as the source of truth for terminal timing cutoffs when `/api/status` and `/api/execution` are briefly out of sync.

- terminal dispatch fields (`status`, `taskRunState`, `finishedAt`) can stop a task timer even before the task snapshot has promoted its visible status
- terminal runtime events continue to win for late merge settlement and other post-dispatch outcomes
- merge-backed tasks still stay in `CODING_COMPLETED` until real CI or merge-stage evidence appears, so the live page does not mark them fully complete just because coding finished
- when CI wait, CI autofix, automerge, or merge-conflict handling temporarily pushes the persisted task status back to `RUNNING`, the live dashboard still projects those tasks as `CODING_COMPLETED` so race positions and task badges do not regress into the coding lane
- late sync-only events after terminal completion no longer reopen an active timing window

## Realtime Delivery

The execution snapshot is now also pushed to the dashboard over websocket through `/api/realtime`.

Current realtime event used for execution consumers:

- `project.execution.updated`

The browser still loads its initial execution snapshot through REST for execution-focused consumers such as the execution panel and project execution hooks.

For the v2 Live page specifically, execution is no longer applied as an independent visual source of truth. The page now hydrates from `/api/live` and then consumes:

- `project.live.updated`

That combined event folds together:

- selected-sprint `/api/status` data
- project execution snapshot data
- git status
- selected sprint identity from the header-scoped project selection

This keeps the execution read model authoritative for dispatches, runs, connections, and runtime events, while preventing the browser from trying to reconcile separate status and execution payloads into one visual state.

## Subtask State Mapping

To ensure the live projection, project management read-models, and markdown imports all produce a consistent view of a subtask, execution status mapping is centralized in `src/services/subtask-state-mapper.ts`.

This shared module resolves:
- Translation between DB planning statuses (`pending`, `in_progress`, `coding_completed`, `completed`) and orchestrator runtime states (`PENDING`, `RUNNING`, `CODING_COMPLETED`, `COMPLETED`).
- "Latest run" execution state overrides, ensuring that active failures or blocks supersede the persisted planning state.
- Merge-indicator normalization (`CI`, `AUTOMERGE`, `MERGED`, `MERGE_BLOCKED`, `MERGE_CONFLICT`).

By preventing logic drift across repositories and services, the subtask view model remains stable regardless of the data origin.

Related realtime scopes now also exist for the surrounding v2 project-management surfaces:

- `projects`
- `project:<projectId>`
- `thread:<threadId>`

That lets Code UX keep project lists, sprint/task pages, and chat threads in sync without treating execution polling as the only freshness path.
