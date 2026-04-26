# DB-Native Orchestrator Integration

This page describes the execution refactor that moved sprint orchestration onto the Sprint OS database model and is now driven from the dashboard/runtime services instead of a dedicated MCP orchestration tool.

## Scope

This slice replaces markdown task directories as the orchestration input for `status` and `orchestrate`.

It now:
- resolves execution scope from `project_id` / `sprint_id` / `sprint_number` / selected project
- loads sprint tasks from sqlite instead of `.sprint-os/sprints/...`
- creates `sprint_runs` for orchestrate executions
- creates `task_dispatches` and `task_runs` when ready tasks start
- acquires a sprint-scoped execution lease while the orchestrator owns the loop
- keeps Docker or CLI-backed execution and Jules execution under the same dispatch flow
- queues explicit `mcp_worker` tasks into the same dispatch model
- persists auto-merge updates back into DB task records instead of markdown
- routes dashboard task reruns through the same dispatch service
- exposes execution control-plane state through a dedicated dashboard projection
- persists provider session state and activity into `task_run_events`
- persists direct CLI pipeline stage events and CI-gate state changes into `task_run_events`
- persists action-required automation and protocol state into `task_run_events`
- persists branch/planning preflight blockers and watch-loop sprint lifecycle into `sprint_run_events`
- orchestrate branch preflight now auto-prepares the local sprint feature branch and best-effort pushes it to `origin` before opening a blocker
- exposes dashboard control actions for sprint orchestration and dispatch management on the same DB-native runtime

It does not yet:
- remove all legacy wording from every instruction template
- attach richer provider transcripts directly to `task_run_events`

## Primary Files

- `src/services/sprint-execution-state-service.ts`
- `src/services/sprint-task-dispatch-service.ts`
- `src/sprint/sprint-orchestrator.ts`
- `src/domain/sprint/orchestrator/cycle-runner.ts`
- `src/domain/sprint/orchestrator/watch-loop-runner.ts`
- `src/domain/sprint/ci/feature-pr-gate.ts`
- `src/repositories/execution-repository.ts`

## New Runtime Shape

Sprint orchestration now resolves a concrete execution scope before execution starts:

- `project`
- `sprint`
- `repoPath`
- `featureBranch`
- `defaultBranch`
- `sprintNumber`

That scope comes from sqlite, not from a subtask directory path.

## Execution Scope Inputs

The internal orchestration service accepts project-scoped inputs:

- `project_id`
- `sprint_id`
- `sprint_number`
- `repo_path`
- `source_id`
- `feature_branch`
- `action`

Current resolution order is:

1. `project_id` if provided
2. `repo_path` matched to a known project
3. selected dashboard project

Then sprint scope is resolved from:

1. `sprint_id` if provided
2. `sprint_number` within the resolved project

## Task Loading

The orchestration loop now reads tasks from:

- `tasks`
- `task_dependencies`
- latest `task_runs`

Those rows are projected into the existing `Subtask` runtime shape so the CI and protocol steps can still operate while the rest of the loop is being transformed.

This is a migration seam, not a compatibility workspace:

- no task markdown is materialized
- no task markdown is read during execution
- markdown remains import/export only

## Dispatch Flow

When `startReadyTasksStep` launches work during `orchestrate`:

1. the orchestrator creates a `task_dispatch`
2. it creates a `task_run`
3. it starts the provider workflow through the existing `TaskService`
4. it writes session/provider metadata back onto the `task_run`

Implementation note:
- batched task-record hydration in the start-ready phase now uses the shared chunked `IN` query helper, and repository call sites must pass only the predicate prefix (for example `WHERE id`) because the helper appends the `IN (...)` clause itself

Executor mapping in this slice:

- `jules` provider -> `jules` dispatch executor
- CLI providers (`gemini`, `codex`, `claude-code`) -> `docker_cli` dispatch executor
- explicit task `executorType = mcp_worker` -> queued `mcp_worker` dispatch

That keeps the old Docker/worktree flow alive, but under DB-native dispatch records, and adds worker routing without introducing a second runtime.

Worktree safety rule:
- Sprint OS never treats the primary repository checkout as a disposable worktree
- linked-worktree discovery now ignores the main repo path even when that checkout is on the same branch as the worker or merge-resolution branch
- cleanup refuses to remove any path that resolves to the project repo root, or to an ancestor of that repo root

## Watch Loop

Watch-loop execution now updates `sprint_runs` directly:

- `running` while polling
- `completed` when all tasks reach their final settled state and the main merge gate is clear
- `failed` when execution ends with failed tasks
- `paused` when execution stops for manual merge or no-more-action conditions
- `cancelled` when the sprint is empty

The old subtask-directory cleanup behavior is removed from the execution path.

Task lifecycle is now four-stage at the planning/runtime seam:

- `pending`
- `in_progress`
- `coding_completed`
- `completed`

`coding_completed` means task execution finished successfully and code is ready, but Sprint OS still has to settle the merge outcome. The task only advances to final `completed` when one of these is true:

- the feature PR was merged
- merge state is otherwise marked settled
- the task produced no branch/PR output, so there is no merge work to wait for

When all sprint tasks are settled, the same completion path now also handles the final `feature -> default` merge gate:

- if `ciIntelligence.mainBranchAutoMergeMode != OFF` and no main PR exists yet, Sprint OS opens or resolves the `feature -> default` PR automatically
- it then re-checks the main merge gate and applies the configured auto-merge policy
- `CREATE_PR` stops after PR creation/resolution and does not auto-merge
- `WHEN_GREEN` waits for green checks before merging
- `ALWAYS` attempts the final main PR merge without waiting for CI
- Sprint OS now emits `sprint_completed` only after an enabled main auto-merge flow actually settles, including the case where the `feature -> default` PR has already been merged
- while main auto-merge is still pending, waiting on CI, ready to merge, or armed in GitHub, the sprint stays active instead of completing early
- if the main merge gate is `DIRTY`, has failed checks, is review-blocked, or an open main-merge conflict handoff item for the same sprint run still exists, the sprint run pauses instead of completing
- if a CLI task hits an unrecoverable Git push/auth/configuration error, Sprint OS now records that task run as `BLOCKED` rather than retryable `FAILED`, so the watch loop pauses the sprint instead of requeueing the same token-burning failure forever
- if a CLI task hits an unrecoverable execution-environment failure such as missing Docker in a Docker-required path, Sprint OS also records that run as `BLOCKED` rather than retrying indefinitely
- when a sprint run transitions to `completed`, `failed`, or terminal `cancelled`, Sprint OS now removes resumable CLI workspaces for that sprint immediately so disk usage drops without waiting for the next restart

## Active Ownership

`orchestrate` now acquires an `execution_lease` on:

- `scope_type = "sprint"`
- `scope_id = sprint_id`

The lease is acquired before the sprint run starts, renewed while the watch loop is active, and released when the orchestrator call exits.

If another orchestrator already owns the sprint lease, Sprint OS returns an active-run message instead of starting a duplicate loop.

Additional start guard:

- Sprint OS now also refuses to start a fresh sprint run when the latest run is still `running`, `queued`, or `cancel_requested`
- if the latest `cancel_requested` run is already idle, Sprint OS finalizes it to `cancelled` and then allows the new start

## Merge Persistence

Feature PR auto-merge no longer writes `merged: true` into task markdown.

Instead it persists:

- `tasks.is_merged`
- `tasks.merge_indicator`

through the project repository.

Feature PR merge waiting now only applies to code-complete tasks that have merge evidence recorded on the task runtime state:

- `task.worker_branch`
- `task.pr_url`

This keeps no-output tasks, such as validation-only or test-only runs, moving from `CODING_COMPLETED` to final `COMPLETED` instead of pushing them into the CI/PR wait path.
The same merge-evidence rule is now used by dependency unlocking, the merge protocol, live dashboard status projection, and the final watch-loop completion check so a sprint can finish cleanly when a successful task never opened a branch or PR.

## Dashboard Reruns

The dashboard rerun endpoint now uses the same DB-native dispatch path:

1. reset the selected-project runtime task state
2. persist `is_merged = false` on the DB task record
3. reuse an active sprint run or create a dashboard-triggered sprint run
4. create a fresh dispatch and task run through `SprintTaskDispatchService`
5. if rerun had to create a fresh sprint run, resume the watch loop on that run after the new dispatch is launched so CI/merge supervision continues automatically

Reruns no longer bypass the execution model.

## Remaining Gaps

The execution model is now DB-native at the entry, load, dispatch, and merge-persistence layers, but not fully end-to-end yet.

Still pending:
- CI/protocol wording should stop referencing any subtask-file semantics
- broader executor transcript coverage beyond current session-sync, CLI stage, worker lifecycle, and CI gate events
- deeper Jules stop semantics beyond the current soft-stop `send_session_message` fallback

Recent runtime update:
- running dispatch cancellation is now modeled as `cancel_requested` instead of immediately forcing terminal DB state
- local CLI workflows abort through the process runner and settle the dispatch to `cancelled` on shutdown
- connected workers receive `controlAction = "cancel"` on their normal heartbeat/update response path
