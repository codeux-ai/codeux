# Worker Sprint Preflight

This page documents the worker-owned sprint-start preflight that now runs before a worker-backed sprint orchestration resumes.

## Problem

Historically, starting a sprint still relied on `sprint_agent(orchestrate)` to:

- validate branch state
- block on missing sprint branches
- then continue into the orchestration loop

That meant sprint start was still coupled to the old direct orchestrator entrypoint even when a worker was connected.

## Shipped Behavior

When a sprint is started from the dashboard and an eligible worker is connected for that project:

1. Sprint OS creates a queued `sprint_run`
2. Sprint OS creates a queued `sprint_preflight_job`
3. the worker `listen` loop claims that preflight job before normal task dispatches
4. the worker runs branch automation against the project's configured `base_dir`
5. on success, Sprint OS resumes the same queued `sprint_run` through `sprint_agent(orchestrate)`

If no worker is available, Sprint OS keeps the direct orchestrator fallback.

## Data Model

New execution table:

- `sprint_preflight_jobs`

Primary columns:

- `project_id`
- `sprint_id`
- `sprint_run_id`
- `connection_id`
- `job_type`
- `status`
- queue / claim / heartbeat / finish timestamps
- `error_message`

Current job type:

- `branch_preflight`

Current statuses:

- `queued`
- `claimed`
- `running`
- `completed`
- `failed`
- `blocked`
- `cancel_requested`
- `cancelled`

Leases:

- workers hold `execution_leases(scope_type = "sprint_preflight_job")` while a preflight job is active

## Automatic Branch Handling

The worker now performs safe automatic branch preparation in the project repo path:

- if local and remote branch both exist: checkout local branch
- if remote exists and local does not: fetch and create local tracking branch
- if local exists and remote does not: checkout and push with upstream
- if neither exists: create from the default branch and push

Unexpected repository problems remain intervention points:

- missing project repo directory
- not a git repository
- missing default branch locally and on origin
- checkout / push failures

Those cases mark the preflight job terminal and pause the sprint run instead of silently continuing.

## Orchestration Resume

Sprint preflight completion does not create a second sprint run.

Instead, Sprint OS calls `sprint_agent(orchestrate)` internally with:

- `existing_sprint_run_id`
- `skip_branch_preflight = true`

That reuses the queued sprint run, acquires the normal sprint lease, and continues into the DB-native orchestration loop.

## Cancellation

Sprint cancellation now includes sprint preflight jobs:

- queued and claimed jobs are cancelled immediately
- running jobs move to `cancel_requested`
- force-cancel releases any preflight lease and marks the job cancelled

Sprint cancellation finalization now waits for both:

- active `task_dispatches`
- active `sprint_preflight_jobs`

## Primary Files

- `src/services/execution-control-service.ts`
- `src/services/worker-sprint-preflight-service.ts`
- `src/sprint/steps/branch-preflight-step.ts`
- `src/sprint/sprint-orchestrator.ts`
- `src/worker/sprint-os-worker.ts`
- `src/repositories/execution-repository.ts`
