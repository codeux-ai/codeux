# Project Runtime Integration

This page describes the current runtime bridge between the legacy sprint orchestrator and the Code UX database model.

## Goal

Project planning is already DB-backed through `projects`, `sprints`, and `tasks`.

This integration extends that model so live execution state is also projected into sqlite for the currently selected project instead of being served only from the process-local `runtimeContext.lastStatus`.

## What Changed

Primary implementation files:
- `src/repositories/project-runtime-repository.ts`
- `src/app/dependency-factory/sprint-factory.ts`
- `src/app/dependency-factory/dashboard-factory.ts`
- `src/app/lifecycle/dashboard-lifecycle-service.ts`
- `src/server/code-ux-server.ts`

Key behavior:
- orchestrator status updates are now mirrored into sqlite
- selected-project live dashboard data is read back from sqlite
- rerun actions can target DB task ids while still resetting markdown task state by task key
- git/CI tracking now resolves repo path and active branch from the selected project's stored runtime context, replacing tokens such as `{sprint_key_prefix}`, `{sprint_id}`, `{worker_provider}`, and `{worker_model}`

## Runtime Source Of Truth

The orchestrator still emits the same `DashboardStatus` payload shape during execution.

That payload is now written into the app database as:
- `app_settings`
  - `runtime_context:<projectId>:<sprintId>` stores sprint-scoped runtime context such as sprint number, repo path, feature branch, report text, instructions, and timestamp
- `task_runs`
  - stores the latest known run/session state per task
- `task_run_events`
  - stores status-sync change events for future timeline and audit views

The dashboard `GET /api/status` endpoint now returns the selected project's runtime projection from sqlite.

## Projection Rules

Project matching:
- `repo_path` is matched against the project's `base_dir` or source reference
- selected project is used as fallback when needed

Sprint matching:
- prefers `sprint_number`
- falls back to `feature_branch`
- does not borrow runtime context from another sprint when an explicit sprint scope is known

Task matching:
- prefers DB task record id when present
- otherwise matches by `task_key`
- session and PR artifacts are accepted only when they are unowned or already owned by the same project, sprint, and task. This prevents two projects that point at repositories with the same basename from sharing a provider run-key match such as `codeux/s4/t02`.
- runtime artifact ownership is resolved in batches before task rows are written. Status sync collects all session ids, session names, and PR URLs in the incoming dashboard payload, loads matching `task_runs` and `provider_invocations` rows through chunked `IN` queries, and then classifies each subtask as local or foreign in memory. This keeps large sprint snapshots from issuing one ownership query per subtask while preserving the same foreign-artifact rejection rule.
- existing task-run candidates are also loaded by task id once per status payload and matched in memory using the legacy precedence: same `session_id`, then same `session_name`, then the latest unfinished run, then the latest matching terminal-state run. `RunEventWrites.syncTaskRun` still owns the actual insert/update/event write, but status sync no longer performs repeated candidate lookups inside the task loop.
- stale active task-run candidates are reconciled during live status sync when the linked dispatch or latest provider invocation already reached a terminal state. Failed or cancelled provider evidence closes the run as failed, while completed dispatch/provider evidence closes it as code-complete. This prevents a long-running app process from keeping provider concurrency and dependency scheduling stuck on `RUNNING` rows until the next restart recovery pass.
- terminal task status is monotonic during status mirroring. A durable `completed` task, a task with `is_merged = true`, or a task with `MERGED`/`AUTOMERGE` merge evidence cannot be moved backward by an older dashboard snapshot. `coding_completed` also wins over stale `PENDING` or `RUNNING` snapshots so aggregate counts do not oscillate while provider work, merge gates, and dashboard polling overlap.

Legacy cleanup:
- unscoped project-level runtime rows from the pre-multi-sprint bridge are treated as deprecated
- explicit sprint reads and rerun flows now use sprint-scoped runtime only, so stale data from an old sprint cannot override the active sprint branch

Runtime cleanup:
- Dedicated cleanup paths (`RuntimeCleanupService`, `DockerRuntimePruneService`, `DockerAssetPruneService`) handle stale previews, orphaned containers, setup images, and workspace/runtime volumes, keeping execution state aligned with container assets.

## Current Boundaries

This is still a bridge layer, not the final runtime architecture.

Current limitations:
- the orchestrator still keeps a process-local `lastStatus` copy for readiness and compatibility
- selected-project status still remains a bridge over the orchestrator payload rather than the only runtime write path
- worker MCP assignment and multi-MCP scheduling are not implemented yet
- listen mode now has project-scoped connection/thread/message storage and a pull-based MCP tool loop, but not autonomous server-side dispatch

Recent tightening:
- dashboard rerun no longer rewrites the selected-project runtime snapshot optimistically
- dashboard cancel no longer patches selected-project subtasks directly
- task planning status is now updated from execution owners (`cli_workflow`, worker dispatch completion, and provider session sync) instead of relying only on snapshot mirroring
- recent provider activity is now persisted into `task_run_events` and projected back into `/api/status`, so legacy task cards and the Live page no longer need a second live-activities fetch to show real provider messages
- provider session sync and legacy status mirroring reject foreign runtime artifacts before mutating `task_runs` or planning status. A status payload that contains a session id or PR URL already persisted under another project, sprint, or task is treated as stale and cannot create a new task run in the selected sprint.
- Completed or merged task rows now win over stale failed or blocked task-run and dispatch rows during `/api/status` and execution snapshot projection. This prevents old retry/interruption records from reappearing as failed indicators after a task has merged.
- When a paused sprint is resumed into a fresh sprint run, provider session sync reattaches the persisted task run, dispatch, and provider invocation for the matched session before writing the latest remote state. Durable hosted provider sessions that complete while Code UX is paused therefore do not stay frozen on the older paused sprint run.
- Duplicate hosted provider clarification auto-replies no longer keep a task hidden as indefinitely running. Duplicates are suppressed for the same latest hosted provider request, user replies after that request keep the task agent-owned while hosted provider processes the response, and an unchanged `AWAITING_USER_FEEDBACK` state without a later user reply remains `BLOCKED` after the configured cooldown.

## Why This Matters

This closes the biggest phase-1 gap:
- v2 project selection now scopes live runtime views
- live dashboard pages no longer depend on one global, unscoped status object
- the app can move toward multi-MCP runtime coordination without replacing the project/sprint/task model again
