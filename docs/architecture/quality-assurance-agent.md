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
- `agents.selfReflection.qualityAssurance`

The current settings are:

- `enabled`
- `maxTaskReviewRuns`
- `maxSprintReviewRuns`
- `exhaustionPolicy`
- `taskCompletion`
  - `enabled`
  - `agentPresetIds`
  - `agentPresetId` legacy compatibility mirror
- `sprintCompletion`
  - `enabled`
  - `agentPresetIds`
  - `agentPresetId` legacy compatibility mirror
- `completedTaskWithoutPr`
  - `enabled`
  - `agentPresetIds`
  - `agentPresetId` legacy compatibility mirror

QA self-reflection is configured separately under `agents.selfReflection.qualityAssurance`:

- `enabled`: defaults to `false`; when false, QA output is accepted exactly as it was before this loop existed
- `criteria`: ordered `{ id, label, prompt, threshold }` records, where `threshold` is stored on the 0-1 settings scale and compared against the reviewer self-rating converted from 1-10
- `maxImprovementAttempts`: maximum number of same-session improvement prompts after a below-threshold rating

When enabled, Code UX asks the same QA provider session to return JSON-only self-ratings for the normalized QA result. If every criterion meets its threshold, the original normalized result is used. If any criterion is below threshold and attempts remain, Code UX asks for an improved QA JSON payload and re-runs the normal QA schema normalization. Invalid reflection JSON, provider failures, or invalid improved QA JSON are fail-open for this optional loop: Code UX logs the issue and keeps the last valid normalized QA result.

Each QA trigger owns an ordered reviewer roster in `agentPresetIds`:

- `[]` means no custom reviewer IDs are configured; Code UX resolves one built-in/default QA reviewer through `resolveTargetedQualityAssuranceAgent(projectId, null)`.
- `["agent-qa-primary"]` runs one custom reviewer.
- `["agent-qa-security", "agent-qa-accessibility"]` runs both custom reviewers in order.

The legacy `agentPresetId` field is still accepted by sanitizer and effective-settings paths. When `agentPresetIds` is absent, a non-empty legacy value seeds the one-item roster; when `agentPresetIds` is present, it is authoritative and `agentPresetId` mirrors the first selected reviewer or `null`.

Dashboard surface:

- `dashboard/src/v2/components/settings/panels/SettingsSprintPanel.tsx`

The `Settings -> Sprint & Git` panel includes a dedicated `Quality Assurance` section that:

- stays compact when QA is disabled
- appears immediately below `Merge Gates & Autofix` in the Sprint & Git settings stack
- exposes the three QA triggers when enabled
- allows per-trigger multi-select agent preset assignment across all project agent presets
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
- optional self-reflection ratings are recorded as `execution_invocation_messages.metadata_json` on the QA invocation, including criteria ids, labels, thresholds, scores, pass/fail state, attempt count, and final decision. Raw provider credentials are not stored in these metadata records.

Provider routing:

- invocation route id: `qa_review`

### Task completion QA

When a task newly transitions into a code-complete state (`CODING_COMPLETED` or a no-merge `COMPLETED` task), `CycleRunner` triggers QA before feature-branch merge automation proceeds.

Behavior:

1. resolve effective project/sprint settings
2. decide whether the trigger is `task_completion` or `completed_task_without_pr`
3. enforce `maxTaskReviewRuns`
4. resolve the trigger reviewer roster from `agentPresetIds`, or one default fallback reviewer when the roster is empty
5. create one `qa_review_runs` row per reviewer with the same `run_index`
6. run each QA prompt with sprint task context plus the current task context
7. store the reviewer-specific verdict, summary, fix instructions, `agent_preset_id`, `agent_name`, and payload in that reviewer's row
8. if any reviewer requests changes, continue the active Jules or CLI session with fix instructions when possible, otherwise requeue the task for another implementation pass
9. allow feature merge only after:
   - every reviewer in the latest review cycle returns `pass`
   - every reviewer that reviews a no-PR task agrees it should not have a PR
   - task QA retry budget is exhausted according to the configured exhaustion policy

Runtime aggregation is fail-closed for the latest cycle:

- all reviewer rows in the same `run_index` must pass before QA passes
- any `changes_requested` reviewer blocks the task and can provide the fix instructions used for the single follow-up action in that cycle
- any `running` or `failed` reviewer keeps the task blocked until it recovers, retries, or exhausts the configured budget
- review budgets count distinct `run_index` values, not reviewer rows, so two reviewers in one cycle consume one QA attempt
- reviewer rows stay visible independently in `qa_review_runs`, task events, and dashboard history with their own agent identity and payload details

Task and sprint cards project one representative reviewer from the newest `run_index`. Within that cycle, the shared projection prioritizes `running`, then `changes_requested`, provider failures (`failed`, `cancelled`, or `errored`), `pass`, and finally other states. A passing reviewer therefore cannot hide an active, blocking, or provider-failed reviewer from the summary badge.

Example trigger settings:

```json
{
  "agents": {
    "qualityAssurance": {
      "taskCompletion": {
        "enabled": true,
        "agentPresetIds": ["agent-qa-security", "agent-qa-regression"],
        "agentPresetId": "agent-qa-security"
      },
      "completedTaskWithoutPr": {
        "enabled": true,
        "agentPresetIds": [],
        "agentPresetId": null
      }
    }
  }
}
```

Task-level prompt scope:

- task completion and completed-without-PR reviews are explicitly single-task reviews
- the selected current task is the only deliverable under review
- the sprint task list and full non-current task instructions are included as context only, so QA can understand dependencies and sprint intent without treating sibling work as missing from the current task
- the prompt tells QA to assume the current workspace or branch contains only the current task's changes on top of its base branch
- a task-level review must pass when the current task satisfies its own prompt, even if completed sibling tasks are absent from the branch
- QA must not request fixes because completed sibling tasks, files, commits, PRs, or behavior are absent from the current task branch
- QA must not tell the current coding session to implement, restore, or modify another task's scope
- when task-level QA requests changes, `fixInstructions` must target the current task's coding session and `targetTaskKey` must identify that current task

If task QA is still pending, running, or has failed without exhausting `maxTaskReviewRuns`, Code UX marks the task merge state as `QA_PENDING` and keeps the sprint active instead of auto-merging. If QA is exhausted and configured to `ESCALATE_TO_HUMAN`, the task is held in `QA_REVIEW_FAILED` and will not be merged or marked complete until a human resolves it.

Provider/infrastructure failures in sprint-completion QA are also retryable without requiring task changes. Code UX starts the next review cycle until `maxSprintReviewRuns` is reached, opens the sprint-scoped human handoff only at that cap, and leaves the sprint run active so it can observe resolution and continue automatically.

Recovery guarantees:

- task QA no longer depends only on catching a single in-cycle transition edge; if a task is already code-complete and still has no successful QA run, Code UX will enqueue the missing review on the next orchestration cycle instead of leaving the task parked in `QA_PENDING`
- every task- and sprint-completion reviewer row records the exact review execution invocation, logical reviewer session, isolated workspace session, reviewer preset, and continuation provenance. Under the restart `continue` policy, a retry reuses that reviewer workspace and continues the provider's native session when available instead of starting the review again without its prior investigation context.
- a `changes_requested` result persists its coding-handoff state before Code UX invokes the target coding session. If the runtime stops after saving the verdict but before finishing that handoff, the next cycle resumes the pending handoff. If the same-session coding follow-up already completed, recovery settles the handoff from that execution evidence and schedules verification rather than invoking the coding provider again. This closes the post-verdict crash window that could otherwise leave a task parked indefinitely at `QA_PENDING`.
- a transient provider exit during that coding handoff preserves the original target session/workspace, restores the task to `CODING_COMPLETED` with `QA_PENDING`, and leaves the handoff retryable. Successful and execution-reconciled handoffs also remain `CODING_COMPLETED`/`QA_PENDING` until verification is scheduled, so a restart cannot mistake the crash window for ordinary task work. Continuation failures are capped by `QA_INFRA_FAILURE_GRACE`; exhausting the cap records no-progress evidence so the normal QA exhaustion policy settles or escalates the task.
- when a later same-session handoff succeeds, Code UX also reconciles the original task-run and dispatch back to completed before sprint terminal evaluation. An earlier failed continuation therefore cannot leave stale runtime evidence that falsely fails an otherwise healthy sprint.
- if a QA run row is left behind in `running` state after its backing execution invocation has already finished, Code UX now automatically converts that stale row into a retryable failed run so the gate can recover instead of blocking indefinitely
- before task QA starts, Code UX polls feature PR status with any task-level PR URLs already recorded by Jules. This lets orchestration recover the PR head branch even when the Jules PR base branch has drifted from the currently configured sprint feature branch.
- if a prior task QA run requested changes, Code UX sends fix instructions back to the same task session when possible and tracks that work as same-session follow-up instead of creating a new task branch.
- CLI QA follow-up work is tracked through `cli_task_followup` execution invocations. If that follow-up finishes inside the same task run after a `changes_requested` QA result, the next orchestration cycle now treats it as fresh work and queues the verification QA run instead of leaving the task parked at the CI/QA merge gate.
- a CLI QA follow-up only counts as applied when that invocation produces a new patch. Existing commits or PR state do not renew verification. If the provider exits successfully but produces no new mergeable Git progress, the review records `followUpNoProgress`, applies the configured QA exhaustion policy, and opens the normal human handoff instead of launching another QA/follow-up cycle.
- when CLI QA follow-up work updates a task branch or opens/reuses a follow-up PR, Code UX clears any previous `is_merged` / `MERGED` projection from an earlier task PR and persists the task back to `coding_completed`. This lets the feature PR gate evaluate and auto-merge the follow-up PR instead of treating the task as already settled.
- when a task reaches the QA retry cap, a completed same-session `cli_task_followup` spawned by the cap-reaching QA verdict gets exactly one final verification review before the exhaustion policy is applied. A later no-op continuation cannot renew that exception, and a new full task run is not treated as task-QA follow-up work; further work must come from an explicit rerun/reset path.
- once a task is parked in `QA_REVIEW_FAILED`, status derivation treats it as a stable human-owned state rather than requeueing it just because dependencies are satisfied. Only an explicit rerun/reset should move it back to pending work.
- human-resolving or dismissing a task QA exhaustion attention item is treated as explicit operator intervention: Code UX clears the task-scoped QA review history and the `qa_review` guardrail counter, then moves a still-parked `QA_REVIEW_FAILED` task back to `coding_completed` so the next orchestration cycle can run QA again instead of remaining blocked or immediately re-escalating on the exhausted budget. A task that already settled through another operator action is not regressed. New QA handoffs carry `sourceAttentionType: "qa_review"` in their payload; older handoffs are still recognized by their QA budget payload fields.
- each sprint cycle reconciles running task QA reviews against their backing provider runtime. If a running QA invocation never links to provider runtime, or if a Docker-backed QA provider invocation no longer has a running `code-ux.session-id` container, Code UX marks the stale QA run cancelled so the next cycle can retry it instead of leaving the task at `QA_PENDING`. Recovered `failed`, `cancelled`, and `errored` attempts share the same bounded infrastructure grace; all terminal attempts count toward the hard ceiling, so repeated container loss cannot retry forever.
- provider concurrency slot waits and claims also reconcile stale Docker-backed provider invocations before counting or creating active slots. This releases orphaned `qwen-code`/CLI QA slots when their containers disappeared before the invocation reached a terminal state, including providers configured with unlimited concurrency, but only after linked execution activity has been idle long enough to avoid racing normal container startup. For task-coding invocations, the reconciler checks the linked task run and dispatch first; completed linked work closes the provider invocation as completed, and recently heartbeating dispatches are left running instead of being failed by the stale-container sweep.
- startup recovery also reconciles stale `running` QA review rows and stale QA invocation audit rows globally. If the backing QA execution invocation already ended, never linked to provider runtime, or points at a Docker-backed provider invocation whose container is gone, startup marks the QA run and backing invocation failed so the sprint can retry instead of keeping a historical `QA review running` badge indefinitely.
- startup recovery also clears stale task-coding runtime projections that can otherwise keep sprint QA and merge gates looking active after the real work ended. This includes terminal linked task runs, terminal provider invocations, orphaned Jules `task_coding` provider rows, active task-run rows without dispatch/provider/execution linkage, and paused sprint-run rows whose owning sprint is already idle or terminal.
- session sync also clears stale hosted Jules task projections when a task records a session id that is missing from the list snapshot and a direct provider lookup returns not found. In that case Code UX fails the stale provider/execution/task-run rows and requeues the task when failed-task retry is enabled.
- if QA/runtime recovery closes a provider or execution invocation while the provider process is still unwinding, later telemetry and completion callbacks do not rewrite the recovered terminal rows back to `running` or `completed`.
- sprint-scoped task loading falls back to the latest unscoped task run when no task run exists for the active sprint run. This keeps continued Jules sessions visible to QA and merge gates after restarts or follow-up messages.
- remote branch refreshes for task QA are serialized per repository, preventing parallel QA checks from racing while creating local tracking branches and failing on `.git/config` locks.
- in local-git mode, if a code-complete task loses `worker_branch` / `workerBranch` metadata during redispatch or settlement, task QA recovers the newest matching local worker branch that contains commits ahead of the sprint feature branch. The recovered branch is backfilled onto the task and task run before review so QA inspects the task's actual work instead of the empty sprint feature branch.

Run budgeting:

Note: The QA service keeps side effects in `src/services/quality-assurance-service.ts` and delegates deterministic decisions to `src/domain/qa-review/`. Run budget and retry limit rules live in `qa-review-budget.ts`; trigger selection and request construction live in `qa-review-request-builder.ts`; branch resolution lives in `qa-review-branch-resolution.ts`; running-row recovery decisions live in `qa-review-stale-run.ts`; sprint completion preflight decisions live with the sprint snapshot helpers in `sprint-qa-snapshot.ts`; and task QA verdict-to-state classification lives in `task-review-outcome.ts`.

This separation keeps repository writes, provider calls, task status mutations, logging, workspace cleanup, and Git operations in `QualityAssuranceService`, while pure helpers answer questions such as:

- whether a task QA attempt is still within budget or should require human attention
- whether a normalized task review means pass, changes requested, retryable failure, or fatal failure
- whether a sprint completion review should run, retry a provider failure, stay blocked, or be skipped because it already passed or exhausted its retry budget
- whether a `running` QA review row is still legitimately active or should be recovered as a failed stale run

- the initial completed task review always counts as run `1`
- extra QA runs only happen after QA requested fixes and the task reaches code-complete again
- `maxTaskReviewRuns = 1` normally means only the initial task review runs; when QA itself requested and successfully applied an automatic CLI continuation, Code UX still permits the follow-up verification run so the task cannot remain indefinitely QA-blocked after completed fix work
- recovered stale QA rows do not consume the task's final retry opportunity. If Code UX marks a running QA row failed because its provider runtime disappeared, the next cycle treats that as a retryable infrastructure recovery rather than a semantic QA failure.
- multi-reviewer cycles share one `run_index`, so one cycle with several reviewer rows still counts as one used run for `maxTaskReviewRuns`
- `maxTaskReviewRuns = 2` means the initial task review plus one QA re-check after fixes
- `maxTaskReviewRuns = N` means the initial task review plus up to `N - 1` QA re-checks for later fix iterations
- `maxTaskReviewRuns = 3` is the default task QA budget for new or unset settings
- `FINISH_TASK` is the default task QA exhaustion policy for new or unset settings, so a task whose budget is spent without a pass is marked complete unless the project selects `FAIL_TASK` or `ESCALATE_TO_HUMAN`
- if QA has failed at the cap without an explicit `changes_requested` verdict, Code UX treats the retry budget as exhausted
- if the latest QA verdict is `changes_requested`, Code UX keeps the merge blocked at the retry cap unless a completed Code UX-applied QA continuation is waiting for verification
- if the latest QA verdict is `changes_requested` and a same-session CLI QA follow-up completes after that verdict, Code UX schedules verification before applying `FINISH_TASK`, `FAIL_TASK`, or `ESCALATE_TO_HUMAN`
- a passing task QA result is final for that completion state and is not retriggered just because orchestration loops again
- task-level QA runs are surfaced in task list records and live runtime snapshots. Tasks, Live, Sprints, and Overview project the latest review into the shared six-stage delivery workflow badge, including an active QA stage while the latest task QA run is still `running`.

### Sprint completion QA

Before Code UX evaluates the final `feature -> default` merge, it runs sprint-completion QA when that trigger is enabled.

Behavior:

- QA receives full sprint context, including every task instruction prompt rather than only the task summary lines
- sprint-completion QA uses `sprintCompletion.agentPresetIds`, or one default fallback reviewer when that roster is empty
- each reviewer in the sprint cycle gets its own `qa_review_runs` row with the same `run_index`
- QA can choose a target task that should continue
- QA can return structured `followUpTasks` with full task instructions so Code UX creates new pending sprint tasks automatically
- if QA requests follow-up work and Code UX can continue that task session, sprint completion is held open
- if sprint-completion QA targets a task that is already merged, Code UX does not reopen that settled session; it records the target for traceability and creates follow-up sprint tasks so repair work goes through a new tracked task branch
- if QA creates follow-up tasks, sprint completion is held open until those new tasks finish and sprint QA passes on a later run
- automatic follow-up creation is allowed only before the final configured sprint review cycle. The final cycle is reserved for verification: if it still requests changes, Code UX records the findings, creates one sprint-scoped human handoff, and does not create another unreviewable task batch
- sprint QA runs once for the finished sprint, then only runs again after a prior `changes_requested` or failed result and meaningful sprint task state changes have occurred
- a passing sprint QA result is final for that sprint state and is not retriggered by another orchestration cycle with no real work changes
- sprint task state changes are detected purely by serializing all current subtasks into a `SprintQaSnapshot` (including status, prompt, and merge indicators) and comparing it with the payload of the latest QA run; if a historical QA run lacks a saved snapshot, Code UX falls back to comparing the newest task modification timestamp against the QA run's finish timestamp
- sprint QA uses the same budget semantics as task QA, but with its own `maxSprintReviewRuns` setting:
  - run `1` is the initial finished-sprint review
  - later runs are only used to check QA-requested fixes or follow-up work
  - `maxSprintReviewRuns = 3` is the default sprint QA budget for new or unset settings
  - `maxSprintReviewRuns = 1` means sprint fixes are not re-checked by QA
- an exhausted sprint QA budget is authoritative even when completed follow-up work changed the task snapshot. Snapshot changes cannot start an over-budget review or suppress the required human handoff
- if every reviewer in the latest sprint QA cycle passes, Code UX proceeds to main-merge evaluation and eventual completion
- if any reviewer is still running, failed, requested changes, or waiting on follow-up work, the main merge stays blocked
- reviewer rows remain visible per agent, while the shared `run_index` spends one sprint QA budget cycle
- while a sprint QA review is running, Code UX now refreshes the parent sprint-run heartbeat and lease so long reviews are not mistaken for stalled orchestration and failed by runtime cleanup
- stale sprint-level `running` QA rows are also reconciled against execution invocation state before gating; if the backing invocation already ended, Code UX reclassifies the stale row and immediately allows a retry instead of keeping sprint completion blocked forever
- an operator can explicitly choose `Mark QA Pass` from the Sprints page when human review should override a non-passing sprint-completion verdict. Code UX records a new terminal `sprint_completion` QA cycle with `outcome = 'pass'`, `Manual QA` reviewer identity, and dashboard provenance; any stale running rows in that sprint review stream are closed first. The action also resolves the matching sprint-scoped QA handoff, but does not resolve task QA or unrelated sprint attention. The dashboard disables the override while a sprint QA provider review is actively running and hides it after a passing verdict.
- `maxSprintReviewRuns` limits review cycles, not the number of defects that an earlier review can split into tracked work. Keeping task-completion QA enabled catches task-local defects before merge and reduces the amount of remediation deferred to the full integrated-sprint review

## Session Continuation

QA review and QA-requested fixes use two related but distinct session tracks:

- the reviewer runs in an isolated review workspace and owns its own durable logical/provider session
- any requested implementation fix returns to the target task's coding session and worktree

For the reviewer track, Code UX persists the exact execution invocation and workspace binding on the reviewer-specific QA row before dispatch. A runtime restart under the `continue` invocation policy closes the interrupted audit invocation, preserves the snapshot workspace, and starts a correlated continuation with the same logical session. When the CLI provider supplied a native session id, Code UX passes it to the resumed invocation so the reviewer retains conversation context as well as filesystem state. Multi-reviewer cycles recover each preset independently; timestamp proximity is only a compatibility fallback for older rows that predate exact invocation correlation.

For the fix track, QA does not open an isolated side-channel. Instead:

- Jules tasks receive a follow-up message on the existing Jules session
- CLI tasks resume the existing worker session/worktree when possible

The QA row records a pending continuation before that follow-up begins. Completion updates that same handoff record, which lets startup and later watch cycles distinguish work that still needs dispatch from a follow-up that already finished before the final QA payload write.

For CLI follow-up runs, Code UX:

- preserves the successful worktree after completion when QA is enabled for task completion
- refreshes `origin` and starts follow-up work from the latest remote feature branch when remote GitHub mode is enabled
- resolves the expected resume workspace from `sessionId` plus CLI execution mode and recovers the current branch from that workspace when `task.worker_branch` and `taskRun.workerBranch` are empty
- resets a reused task workspace to the latest remote worker branch when that branch already exists, so QA fixes build on the current task PR tip
- creates a missing local feature branch from `origin/<feature>` instead of recreating it from the default branch when the remote tracking base branch exists, or falls back to resolving a repository default branch start point
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

### Shared summary projection

Tasks, Sprints, and Live expose one backward-compatible `SprintReviewSummary` contract from `src/contracts/qa-review-summary.ts`. The original fields remain unchanged:

- `status`
- `outcome`
- `summary`
- `findings`
- `reviewer`
- `finishedAt`

When approved structured data exists, the same summary can also include:

- `fixInstructions`
- `targetTaskKey`
- `followUpTasks`, normalized to `title`, `promptMarkdown`, nullable `description`, `dependsOnTaskKeys`, and `priority`

`src/repositories/project-management/qa-review-summary-query.ts` owns the batched task-level and sprint-level read path. It selects the newest `run_index` for each task or sprint, then applies the same fail-closed representative-row precedence as `QaReviewRepository`: `running`, `changes_requested`, `failed`, `pass`, then other states. Start time and row identity provide deterministic ordering inside the same precedence tier. This prevents a passing reviewer from hiding a blocking reviewer in the same multi-reviewer cycle.

The query reads only dedicated summary columns and the approved `findings`, `fixInstructions`, `targetTaskKey`, and `followUpTasks` payload fields. Unknown payload keys, raw provider responses, prompts, credentials, and malformed follow-up entries are not projected. Dedicated `fix_instructions` and `target_task_key` columns take precedence, with approved payload values used only as compatibility fallbacks.

No migration is required. Legacy rows without structured follow-up fields retain the original six-field response, malformed payload JSON yields safe empty findings and absent optional fields, and explicit `followUpTasks: []` remains an approved empty specification. `ProjectManagementRepository`, `sprint-summary-query.ts`, and `RuntimeStatusProjection` all use this shared query, so Tasks, Sprints, and Live return identical normalization behavior without per-card database fetches.

QA agent responses are processed using the shared structured response helper (`StructuredProviderResponseService`). This ensures that if the agent returns malformed JSON or omits required fields, Code UX automatically triggers an in-session retry to correct the output shape before failing the review.

## Gemini Workspace Trust

Gemini CLI can reject headless automation in untrusted folders before the QA prompt executes. Code UX sets `GEMINI_CLI_TRUST_WORKSPACE=true` for Gemini provider runs and passes it through Docker execution so task and sprint QA reviews can run in isolated snapshot containers without requiring an interactive trust prompt.
