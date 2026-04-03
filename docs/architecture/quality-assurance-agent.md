# Quality Assurance Agent

## Status
Implemented

## Purpose

Sprint OS now supports a dedicated Quality Assurance agent that reviews completed work after delivery instead of relying only on merge state or worker self-reporting.

The QA agent is designed to:

- review a completed task with full sprint context
- check whether the implementation is actually complete
- catch code-quality issues and integration mistakes
- investigate missing features or regressions
- decide whether a completed task without a PR should actually have one
- continue the existing task session with concrete fix instructions when changes are required

## Configuration Surface

Project-scoped settings live under:

- `agents.qualityAssurance`

The current settings are:

- `enabled`
- `maxTaskReviewRuns`
- `taskCompletion`
  - `enabled`
  - `agentPresetId`
- `sprintCompletion`
  - `enabled`
  - `agentPresetId`
- `completedTaskWithoutPr`
  - `enabled`
  - `agentPresetId`

Dashboard surface:

- `dashboard/src/v2/AgentsPage.tsx`

The Agents page includes a dedicated `Senior QA Agent` card that:

- stays compact when QA is disabled
- exposes the three QA triggers when enabled
- allows per-trigger agent preset selection
- allows controlling how many times task QA can re-run after QA-driven fixes

## Default Agent Preset

Sprint OS ships a project-local default markdown file:

- `.sprint-os/agents/quality_assurance_agent.md`

Agent resolution uses the same preset-sync path as other built-in agents, so a project can keep the default behavior, edit the preset in the dashboard, or point an individual QA trigger at a different project agent preset.

## Runtime Flow

Backend service:

- `src/services/quality-assurance-service.ts`

Persistence:

- `src/repositories/qa-review-repository.ts`
- `qa_review_runs` table in `src/repositories/db/app-db-schema.ts`

Provider routing:

- invocation route id: `qa_review`

### Task completion QA

When a task newly transitions into `COMPLETED`, `CycleRunner` can trigger QA once for that completion event.

Behavior:

1. resolve effective project/sprint settings
2. decide whether the trigger is `task_completion` or `completed_task_without_pr`
3. enforce `maxTaskReviewRuns`
4. resolve the QA agent preset and provider route
5. run the QA prompt with sprint task context plus the current task context
6. store the run in `qa_review_runs`
7. if QA requests changes, continue the active Jules or CLI session with fix instructions

Normal default:

- task QA runs once after the first completion only

If `maxTaskReviewRuns > 1`:

- a task can be reviewed again after a QA-requested fix loop until the cap is reached

### Sprint completion QA

Before the watch loop marks a sprint run complete, Sprint OS can run a final sprint-level QA review.

Behavior:

- QA receives full sprint context
- QA can choose a target task that should continue
- if QA requests follow-up work and Sprint OS can continue that task session, sprint completion is held open
- if QA passes, the sprint completes normally

## Session Continuation

QA does not open an isolated side-channel for fixes.

Instead:

- Jules tasks receive a follow-up message on the existing Jules session
- CLI tasks resume the existing worker session/worktree when possible

For CLI follow-up runs, Sprint OS:

- preserves the successful worktree after completion when QA is enabled for task completion
- resumes the worker branch
- records the follow-up invocation in execution tracking
- pushes/publishes any resulting PR updates when needed

## Output Contract

The QA provider is prompted to return JSON only with:

- `verdict`
- `summary`
- `findings`
- `fixInstructions`
- `targetTaskKey`
- `shouldHavePr`

That contract keeps the follow-up automation deterministic instead of scraping prose heuristically.
