# Quality Assurance Agent

## Status
Implemented

## Purpose

Code UX now supports a dedicated Quality Assurance agent that reviews completed work after delivery instead of relying only on merge state or worker self-reporting.

The QA agent is designed to:

- review a code-complete task with full sprint context before Code UX merges it
- check whether the implementation is actually complete
- catch code-quality issues and integration mistakes
- investigate missing features or regressions
- decide whether a completed task without a PR should actually have one
- continue the existing task session with concrete fix instructions when changes are required
- block feature or main-branch merges until QA passes, or until the configured task-review retry budget is exhausted
- create sprint follow-up tasks when sprint-completion QA finds work that should become new tracked tasks instead of only resuming an existing session

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

- `dashboard/src/v2/components/settings/panels/SettingsAgentsPanel.tsx`

The `Settings -> Agents` panel includes a dedicated `Quality Assurance` section that:

- stays compact when QA is disabled
- appears above instruction templates in the Agents settings stack
- exposes the three QA triggers when enabled
- allows per-trigger agent preset selection across all project agent presets
- sorts presets labeled for QA ahead of other agent presets
- allows controlling how many times task QA can re-run after QA-driven fixes

## Default Agent Preset

Code UX ships a project-local default markdown file:

- `.code-ux/agents/quality_assurance_agent.md`

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

When a task newly transitions into a code-complete state (`CODING_COMPLETED` or a no-merge `COMPLETED` task), `CycleRunner` triggers QA before feature-branch merge automation proceeds.

Behavior:

1. resolve effective project/sprint settings
2. decide whether the trigger is `task_completion` or `completed_task_without_pr`
3. enforce `maxTaskReviewRuns`
4. resolve the QA agent preset and provider route
5. run the QA prompt with sprint task context plus the current task context
6. store the run in `qa_review_runs`
7. if QA requests changes, continue the active Jules or CLI session with fix instructions when possible, otherwise requeue the task for another implementation pass
8. allow feature merge only after:
   - QA returns `pass`
   - QA determines a no-PR task should not have a PR
   - task QA retry budget is exhausted

Task-level prompt scope:

- task completion and completed-without-PR reviews are explicitly single-task reviews
- the selected current task is the only deliverable under review
- the sprint task list and full non-current task instructions are included as context only, so QA can understand dependencies and sprint intent without treating sibling work as missing from the current task
- the prompt tells QA to assume the current workspace or branch contains only the current task's changes on top of its base branch
- a task-level review must pass when the current task satisfies its own prompt, even if completed sibling tasks are absent from the branch
- QA must not request fixes because completed sibling tasks, files, commits, PRs, or behavior are absent from the current task branch
- QA must not tell the current coding session to implement, restore, or modify another task's scope
- when task-level QA requests changes, `fixInstructions` must target the current task's coding session and `targetTaskKey` must identify that current task

If task QA is still pending, running, or has failed without exhausting `maxTaskReviewRuns`, Code UX marks the task merge state as `QA_PENDING` and keeps the sprint active instead of auto-merging.

Recovery guarantees:

- task QA no longer depends only on catching a single in-cycle transition edge; if a task is already code-complete and still has no successful QA run, Code UX will enqueue the missing review on the next orchestration cycle instead of leaving the task parked in `QA_PENDING`
- if a QA run row is left behind in `running` state after its backing execution invocation has already finished, Code UX now automatically converts that stale row into a retryable failed run so the gate can recover instead of blocking indefinitely
- before task QA starts, Code UX polls feature PR status with any task-level PR URLs already recorded by Jules. This lets orchestration recover the PR head branch even when the Jules PR base branch has drifted from the currently configured sprint feature branch.
- if a prior QA run requested changes and a later Jules or CLI task run completed after that QA result, Code UX treats the later completion as meaningful work and reruns task QA on the next orchestration cycle even when the task was already persisted as `coding_completed`.
- CLI QA follow-up work is tracked through `cli_task_followup` execution invocations. If that follow-up finishes inside the same task run after a `changes_requested` QA result, the next orchestration cycle now treats it as fresh work and queues the verification QA run instead of leaving the task parked at the CI/QA merge gate.
- each sprint cycle reconciles running task QA reviews against their backing provider runtime. If a running QA invocation never links to provider runtime, or if a Docker-backed QA provider invocation no longer has a running `code-ux.session-id` container, Code UX marks the stale QA run failed so the next cycle can retry it instead of leaving the task at `QA_PENDING`.
- provider concurrency slot waits and claims also reconcile stale Docker-backed provider invocations before counting or creating active slots. This releases orphaned `qwen-code`/CLI QA slots when their containers disappeared before the invocation reached a terminal state, including providers configured with unlimited concurrency, but only after linked execution activity has been idle long enough to avoid racing normal container startup.
- startup recovery also reconciles stale `running` QA review rows and stale QA invocation audit rows globally. If the backing QA execution invocation already ended, never linked to provider runtime, or points at a Docker-backed provider invocation whose container is gone, startup marks the QA run and backing invocation failed so the sprint can retry instead of keeping a historical `QA review running` badge indefinitely.
- startup recovery also clears stale task-coding runtime projections that can otherwise keep sprint QA and merge gates looking active after the real work ended. This includes terminal linked task runs, terminal provider invocations, orphaned Jules `task_coding` provider rows, active task-run rows without dispatch/provider/execution linkage, and paused sprint-run rows whose owning sprint is already idle or terminal.
- if QA/runtime recovery closes a provider or execution invocation while the provider process is still unwinding, later telemetry and completion callbacks do not rewrite the recovered terminal rows back to `running` or `completed`.
- sprint-scoped task loading falls back to the latest unscoped task run when no task run exists for the active sprint run. This keeps continued Jules sessions visible to QA and merge gates after restarts or follow-up messages.
- remote branch refreshes for task QA are serialized per repository, preventing parallel QA checks from racing while creating local tracking branches and failing on `.git/config` locks.

Run budgeting:

Note: The run budget and retry limit rules are explicitly implemented in a dedicated domain module (`src/domain/qa-review/qa-review-budget.ts`). Additionally, the setup logic for trigger selection, branch fallback, and instruction composition is handled cleanly by pure functions in `src/domain/qa-review/qa-review-request-builder.ts` before the `QualityAssuranceService` acts on it.

- the initial completed task review always counts as run `1`
- extra QA runs only happen after QA requested fixes and the task reaches code-complete again
- `maxTaskReviewRuns = 1` normally means only the initial task review runs; when QA itself requested and successfully applied an automatic CLI continuation, Code UX still permits the follow-up verification run so the task cannot remain indefinitely QA-blocked after completed fix work
- recovered stale QA rows do not consume the task's final retry opportunity. If Code UX marks a running QA row failed because its provider runtime disappeared, the next cycle treats that as a retryable infrastructure recovery rather than a semantic QA failure.
- `maxTaskReviewRuns = 2` means the initial task review plus one QA re-check after fixes
- `maxTaskReviewRuns = N` means the initial task review plus up to `N - 1` QA re-checks for later fix iterations
- if QA has failed at the cap without an explicit `changes_requested` verdict, Code UX treats the retry budget as exhausted
- if the latest QA verdict is `changes_requested`, Code UX keeps the merge blocked at the retry cap unless a completed Code UX-applied QA continuation is waiting for verification
- a passing task QA result is final for that completion state and is not retriggered just because orchestration loops again
- task-level QA runs are now surfaced in task list records and live runtime snapshots. The Tasks page and Live page both show a compact QA badge, including a spinner state while the latest task QA run is still `running`.

### Sprint completion QA

Before Code UX evaluates the final `feature -> default` merge, it runs sprint-completion QA when that trigger is enabled.

Behavior:

- QA receives full sprint context, including every task instruction prompt rather than only the task summary lines
- QA can choose a target task that should continue
- QA can return structured `followUpTasks` with full task instructions so Code UX creates new pending sprint tasks automatically
- if QA requests follow-up work and Code UX can continue that task session, sprint completion is held open
- if QA creates follow-up tasks, sprint completion is held open until those new tasks finish and sprint QA passes on a later run
- sprint QA runs once for the finished sprint, then only runs again after a prior `changes_requested` or failed result and meaningful sprint task state changes have occurred
- a passing sprint QA result is final for that sprint state and is not retriggered by another orchestration cycle with no real work changes
- sprint QA uses the same `maxTaskReviewRuns` budget semantics as task QA:
  - run `1` is the initial finished-sprint review
  - later runs are only used to check QA-requested fixes or follow-up work
  - `maxTaskReviewRuns = 1` means sprint fixes are not re-checked by QA
- if sprint QA passes, Code UX proceeds to main-merge evaluation and eventual completion
- if sprint QA is still running, failed, or waiting on follow-up work, the main merge stays blocked
- while a sprint QA review is running, Code UX now refreshes the parent sprint-run heartbeat and lease so long reviews are not mistaken for stalled orchestration and failed by runtime cleanup
- stale sprint-level `running` QA rows are also reconciled against execution invocation state before gating; if the backing invocation already ended, Code UX reclassifies the stale row and immediately allows a retry instead of keeping sprint completion blocked forever

## Session Continuation

QA does not open an isolated side-channel for fixes.

Instead:

- Jules tasks receive a follow-up message on the existing Jules session
- CLI tasks resume the existing worker session/worktree when possible

For CLI follow-up runs, Code UX:

- preserves the successful worktree after completion when QA is enabled for task completion
- refreshes `origin` and starts follow-up work from the latest remote feature branch when remote GitHub mode is enabled
- resolves the expected resume workspace from `sessionId` plus CLI execution mode and recovers the current branch from that workspace when `task.worker_branch` and `taskRun.workerBranch` are empty
- resets a reused task workspace to the latest remote worker branch when that branch already exists, so QA fixes build on the current task PR tip
- creates a missing local feature branch from `origin/<feature>` instead of recreating it from the default branch when the remote feature branch already exists
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
- `followUpTasks`

Result parsing and structure normalization are fully delegated to `src/domain/qa-review/qa-review-result-normalizer.ts`.

That contract keeps the follow-up automation deterministic instead of scraping prose heuristically.

QA agent responses are processed using the shared structured response helper (`StructuredProviderResponseService`). This ensures that if the agent returns malformed JSON or omits required fields, Code UX automatically triggers an in-session retry to correct the output shape before failing the review.

## Gemini Workspace Trust

Gemini CLI can reject headless automation in untrusted folders before the QA prompt executes. Code UX sets `GEMINI_CLI_TRUST_WORKSPACE=true` for Gemini provider runs and passes it through Docker execution so task and sprint QA reviews can run in isolated snapshot containers without requiring an interactive trust prompt.
