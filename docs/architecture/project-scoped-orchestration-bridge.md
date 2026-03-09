# Project-Scoped Orchestration Bridge

This page describes the current execution bridge that moves `sprint_agent` onto the Sprint OS project/sprint/task model without breaking the existing Docker, worktree, CI, and provider execution flow.

## Goal

The v2 dashboard is already the source of truth for:
- projects
- sprints
- tasks
- task dependencies

The orchestration loop still depended on repo-local markdown subtasks.

This bridge changes that:
- `sprint_agent` can now resolve a project and sprint from sqlite
- sprint tasks are materialized from the DB into a compatibility execution workspace right before orchestration
- merge/rerun paths now also update the DB-backed task record instead of only mutating markdown

## Primary Files

- `src/services/sprint-execution-bridge-service.ts`
- `src/sprint/sprint-orchestrator.ts`
- `src/repositories/project-runtime-repository.ts`
- `src/app/dependency-factory/sprint-factory.ts`
- `src/app/dependency-factory/dashboard-factory.ts`

## Current Execution Model

`sprint_agent` now resolves execution context in this order:

1. explicit `project_id`
2. matching project by `repo_path`
3. selected dashboard project
4. first known project

Sprint resolution then prefers:

1. explicit `sprint_id`
2. sprint with matching `sprint_number` inside that project
3. first sprint in the project

Once resolved, Sprint OS:
- reads the sprint/task state from sqlite
- projects latest runtime state from `task_runs`
- writes a compatibility `.md` subtask workspace under `.sprint-os/sprints/...`
- runs the existing orchestration loop against that workspace

## Why Materialization Exists

The existing orchestration core still contains file-oriented behaviors:
- subtask loading
- merge protocol references
- automerge merged-flag persistence
- watch-loop cleanup of the compatibility subtask workspace

The bridge keeps those flows working while making sqlite the source of truth.

This means:
- planning and task edits belong to the v2 dashboard / DB model
- the compatibility markdown workspace is an execution artifact, not the authoritative store

## What Changed In Behavior

- `sprint_agent` now accepts optional `project_id` and `sprint_id`
- `status` / `orchestrate` can run from selected-project Sprint OS data instead of requiring markdown planning files to be manually authored first
- `plan` now points callers toward planning in the v2 dashboard or markdown import flow when Sprint OS is the active source of truth
- rerun merged-flag resets now update sqlite even if the compatibility markdown workspace is missing

## Current Boundary

This is still a bridge layer.

The orchestration core still operates on materialized markdown during execution, so this is not the final end-state yet.

Remaining work:
- replace file-oriented orchestration internals with direct repository-backed task state
- move protocol instructions away from file references
- add worker dispatch as an execution option beside Docker/worktree/provider runs
- fully align completion/cleanup semantics with sprint/task DB state instead of compatibility workspace lifecycle
