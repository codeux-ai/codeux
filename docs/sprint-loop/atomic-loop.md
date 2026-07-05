# Atomic Sprint Loop

This document explains the sprint orchestrator control flow and each atomic step.

## Entry Point

- File: `src/sprint/sprint-orchestrator.ts`
- Public method: `execute(args: SprintAgentArgs)`
- Shared args type: `src/sprint/sprint-types.ts`
- Supporting modules:
  - `src/domain/sprint/orchestrator/*`
  - `src/domain/sprint/ci/*`

## Actions

- `plan`
- `status`
- `orchestrate`

## Step Toggle Settings

Controlled by `dashboardSettings.sprintLoopSteps`:

- `branchPreflight`
- `planningPreflight`
- `loadSubtasks`
- `sessionSync`
- `statusDerivation`
- `startReadyTasks`
- `mergeProtocol`
- `actionRequiredProtocol`
- `statusTable`
- `watchLoop`

## Loop Flow Diagram

```mermaid
flowchart TD
  A[execute args] --> B{branchPreflight}
  B -->|enabled| C[branch-preflight-step]
  B -->|disabled| D
  C --> D{planningPreflight}
  D -->|enabled| E[planning-preflight-step]
  D -->|disabled| F
  E --> F{action == plan}
  F -->|yes| G[create subtasks dir + planning template output]
  F -->|no| H[run orchestration cycle]
  H --> I{loadSubtasks}
  I --> J[load-subtasks-step]
  J --> K{sessionSync}
  K --> L[session-sync-step]
  L --> M{statusDerivation}
  M --> N[status-derivation-step]
  N --> O{startReadyTasks}
  O --> P[start-ready-tasks-step]
  P --> Q[protocol-step]
  Q --> R{statusTable}
  R --> S[status-table-step]
  S --> T{wait && watchLoop}
  T -->|true| U[watch loop cycles]
  T -->|false| V[single-cycle report]
```

## Pull Request Content Rules

Automatically created PRs must provide sufficient human context:
- **Worker Feature PRs** (`worker-branch -> sprint-feature-branch`): Must include both the current task description (from the prompt) and the sprint goal/description in the PR body.
- Worker feature PR timing is rendered with the same completion timestamp later persisted to the task run, so PR bodies show `Finished` and `Duration` even though the PR is opened just before task-run finalization.
- **Main Merge PRs** (`sprint-feature-branch -> default-branch`): Must include the sprint description alongside branch and sprint numbering metadata.
- If task or sprint descriptions are missing/empty, PR bodies will use a compact fallback text instead of omitting sections.
- The `default-branch` target is the resolved scoped `git.defaultBranch` value (`system -> project -> sprint` settings). Legacy project metadata cannot override it during sprint completion, so inherited system defaults such as `dev` remain the final merge target.

## Execution Phases

### 1. Branch preflight (optional)
- Step module: `branch-preflight-step.ts`
- Applies to: `plan` and `orchestrate`
- Validates sprint feature branch exists:
  - locally
  - on remote origin
- On failure: returns templated blocker instructions.

### 2. Planning preflight (optional)
- Step module: `planning-preflight-step.ts`
- Applies to: `status` and `orchestrate`
- Ensures subtask markdown files exist in sprint subtask directory.
- On failure: returns templated planning blocker.

### 3. Plan action
If `action=plan`:
- Creates subtask directory if missing.
- Optionally injects `sprint_agent_guide.md`.
- Returns templated planning instructions.
- Planning may apply a provider-suggested sprint title only when the sprint was explicitly stored as generated/auto-named at creation time. Placeholder-looking custom titles such as `Untitled sprint 1` are treated as user titles and are not writable by planning.

### 4. Orchestration cycle
For `status` and `orchestrate`, each cycle can run:

1. Load subtasks
- `load-subtasks-step.ts`

2. Sync sessions and activities
- `session-sync-step.ts`
- Session-sync activity fetch planning is delegated to `src/domain/sprint/session-sync/activity-fetch-plan.ts` to make decisions testable.
- Session activity fetching uses a bounded concurrency worker pool to prevent overloading the backend, preserving isolated failures per-session.
- Each session-sync cycle keeps a cycle-local metadata cache keyed by normalized session id/name. The cache resolves session identity, latest task-run ownership, provider/mode ownership, and local terminal state once per session for that cycle only, so activity planning and task sync share the same safety decisions without repeated repository lookups.
- Sync source is provider-agnostic:
  - Jules API sessions (when available)
  - locally tracked CLI sessions (`gemini`/`codex`)

3. Derive effective task status
- `status-derivation-step.ts`
- Task transition decisions are centralized in `src/domain/sprint/task-transition-state.ts`.
  The step asks this pure helper whether dependencies are met, whether a failed
  session should reset to `PENDING` or remain `BLOCKED`, and whether terminal,
  QA-pending, merge-required, quota, or failed states should be preserved.

4. Start ready tasks (orchestrate only)
- `start-ready-tasks-step.ts`
- Provider is selected per task using `aiProvider` strategy.
- For CLI providers the workflow is:
  - allocate a unique sprint feature branch name when the sprint has not persisted one yet, checking local and remote refs so restarted sprint numbers do not reuse old branch history
  - create child task branch from sprint feature branch
  - run CLI in background
  - commit/push branch
  - open PR back to sprint feature branch
  - track state and activity in sqlite
- CLI task dispatch carries two task identities through the runtime: the human task key (`T01`, `T02`, ...) stays in branch names, titles, prompts, and task-run tags, while repository/execution lookups use the persisted task record id (`record_id`). Workspace resume targets, task runs, dispatches, and provider invocations must use the record id so normal planned sprint tasks can resume from the correct Docker workspace volume after cancellation or restart.
- CLI workspace patch export discovers untracked files with Git's `--exclude-standard` filtering, then intent-to-adds only those non-ignored paths in bounded batches before diffing. Ignored workspace caches such as `.pnpm-store`, provider runtime homes, and transient export indexes are export noise and must not turn a completed/no-change provider run into a failed dispatch.

5. Build protocol instructions
- `protocol-step.ts`
 - Action-required tasks are separated into:
   - `AGENT INTERVENTION NEEDED`
   - `HUMAN INTERVENTION NEEDED`

6. Build status table
- `status-table-step.ts`

### Automation intervention routing

Action-required Jules sessions (`AWAITING_PLAN_APPROVAL`, `AWAITING_USER_FEEDBACK`, `PAUSED`) are routed by automation policy:
- `FULL`: auto-intervene for all supported action-required states.
- `SEMI_AUTO`: obey `automationInterventions` toggles.
- `ALWAYS_ASK`: no auto-intervention.
- Worker-generated clarification replies are tracked against the persisted task record id (`record_id`) when available, not the display task key (`T01`, `T02`, ...), so auto-intervention does not fail during execution-invocation logging.
- Worker-generated clarification replies now use the editable `Project manager` agent preset instead of worker instructions, and the prompt includes a dedicated Jules clarification-request section so the latest explicit message is preserved when available.
- Worker-generated clarification replies unwrap CLI provider response envelopes before they are sent back to Jules, even when bootstrap or package-manager output surrounds the JSON envelope.
- Clarification dedupe ignores Code UX's own user reply activity and keys silent Jules prompts by the latest non-user activity id/time, so repeated polling of the same activity is idempotent while a later unanswered Jules activity is treated as a new request.

When auto-intervention fails, tasks are routed to `AGENT INTERVENTION NEEDED` with context.

## Watch Mode

When `action=orchestrate`, `wait` is true, and `watchLoop` is enabled:
- Orchestrator enters continuous loop.
- Wait interval is 10 seconds between cycles.
- Output interval defaults to 300 seconds and is now used only as an internal checkpoint boundary for heartbeat/lease renewal inside the same sprint run.
- Code UX does not stop at that boundary anymore. It keeps the same sprint run alive, renews its lease/heartbeat, resets the checkpoint window, and continues watching until a real terminal condition is reached.
- Startup recovery and dashboard **Resume** restart monitoring through the existing-run recovery path. A resumed paused run keeps its original sprint-run id, is moved back to `running`, and then starts the watch loop without creating a duplicate run. Resume is refused while another queued/running/cancel-pending run for the same sprint is active.
- Live CLI telemetry stays enabled during watch mode, including transcript parsing and token accounting. To keep high-concurrency sprints responsive, each provider watcher fingerprints its current stdout/stderr and provider log sources, uses cheap file/source metadata before reading full provider transcripts when available, skips provider-specific read and parse/token work when the sources are unchanged, reuses Codex tokenizer encodings and recent token counts, and only persists provider usage rows when token/transcript state changes.
- Provider telemetry watchers are best-effort and never fail the provider run. Repeated watcher read or parse failures are logged as throttled runtime warnings with provider, Code UX session id, native session id when known, and failure count, without including prompts, transcripts, raw streams, or credentials.
- Dashboard live snapshots are optimized for high sprint concurrency: selected-sprint checks use targeted project/sprint lookups instead of hydrating every sprint, recent provider activities are cached until the project's latest provider activity event changes, and provider activity event reads use partial sqlite indexes for the activity-only paths.
- Preview reconciliation also avoids full project execution snapshots in the common running-session path. It queries running sprint runs directly and memoizes that result while reconciling preview sessions and auto-starting previews.
- Loop exits when:
  - all tasks terminal (`COMPLETED+merged` or `FAILED`) and, in remote-git mode, the final `feature -> default` completion PR is observed as merged, or
  - no runnable tasks remain, or
  - merge-required tasks are detected.
- The watch loop uses the same `task-transition-state.ts` helper as the cycle
  runner to classify settled tasks, failed terminal tasks, PR-backed merge waits,
  QA-pending tasks, quota waits, dependency blockers, and worker attention waits.
  Protocol text and status table rendering remain separate presentation steps.

On completion it may:
- clean up subtask directory,
- append completion steps,
- preserve files when failures remain.

## Single-Cycle Fallback

If caller requests wait mode but `watchLoop` toggle is disabled:
- orchestrator runs one cycle,
- returns normal report with a note that watch mode is disabled.

For `action=status`:
- orchestration always runs as a single cycle for immediate output,
- `wait: true` is ignored and reported as informational text.

## CI Intelligence Integration

`ciIntelligence` settings affect generated protocol text:
- CI status classification is centralized in `src/sprint/ci-status-utils.ts` via `isCiFailure(status, conclusion)` and `isCiPending(status, conclusion)` so feature and main merge gates evaluate checks with the same rules.
- Feature-branch merge instructions can require CI wait and comment resolution.
- Final merge-to-main instructions can require CI wait and comment resolution.
- When a task finishes provider work but its feature PR is still missing, pending, failing, or review-blocked, the CI gate now persists that task back to in-progress state in project task records so dashboard task lists do not incorrectly show it as finished.
- When a completed CLI task has a recorded worker branch but no PR, the feature PR gate verifies that the branch still exists and has commits ahead of the sprint feature branch. If the branch is missing or has no unmerged commits, Code UX clears the stale worker-branch evidence, settles the task as completed with no merge marker, and avoids opening a permanent `merge_required` attention item for no-op work.
- When QA requests fixes and Code UX applies them through a same-session CLI follow-up, the next sprint cycle treats the completed `cli_task_followup` invocation as fresh task work and reruns QA verification instead of waiting for a separate task-run completion timestamp.
- When CLI QA follow-up work creates or reuses a task PR after an earlier PR for the same task was already merged, Code UX clears stale merged state and persists the task as code-complete again so the feature PR gate can evaluate and auto-merge the follow-up PR.
- When a task is parked in `QA_REVIEW_FAILED` but its feature PR is later merged manually, the feature PR gate treats the merged PR as authoritative, marks the task `COMPLETED`/`MERGED`, and lets dependent tasks proceed.
- Recovered stale QA reviews are treated as retryable infrastructure signals even when the verdict budget is otherwise spent. They do not trigger the QA exhaustion policy or human escalation unless a later non-recovered failure reaches the configured ceiling.
- Starting or resuming orchestration resolves stale sprint-level `manual_attention` escalations from prior runs. The new run recomputes current blockers, while task-specific human attention remains open until explicitly handled.
- Before task QA gates are evaluated, the sprint cycle reconciles running task QA invocations with provider runtime state. Missing provider linkage or a missing Docker session container makes the stale QA row retryable instead of blocking the task indefinitely at `QA_PENDING`.
- Sprint orchestration resolves LOCAL vs REMOTE git behavior from the effective project/sprint settings (`settings.git.githubMode`). Local-git projects therefore use the local worker-to-feature merge path consistently during both single-cycle and watch-loop runs.
- In local-git mode, when a task completed without a PR and then receives QA fixes, the QA follow-up process continues by attempting to recover the worker branch from task/task run metadata, open/merged PR metadata, or git branch name matching. If the preserved resume workspace is missing, Code UX prepares/recreates the expected worktree on the recovered branch and continues the QA follow-up run without failing. If no branch can be recovered and no safe workspace can be prepared, the orchestrator fails fast.
- Feature-PR auto-merge mode `WHEN_GREEN` waits for a green gate before attempting the merge.
- Main-branch auto-merge mode `ALWAYS` intentionally bypasses the main CI wait gate and attempts the final `feature -> default` merge as soon as the PR is not conflicted or review-blocked.
- Remote-git sprint completion is fail-closed on the final main merge: Code UX does not mark the sprint run `completed` until GitHub polling reports the completion PR as merged. A successful auto-merge command only keeps the sprint active for another poll; it is not enough to finish the sprint by itself.
- Main-branch auto-merge mode `CREATE_PR` opens or reuses the final completion PR, then pauses for a human handoff until that PR is merged and the sprint is resumed.
- Before creating the final `feature -> default` merge PR, Code UX now verifies that the configured default branch exists on `origin`. If it is missing, Code UX creates it from the repository's actual `origin/HEAD` branch, pushes it, and then creates the final PR against the configured target.
- Main-branch PR creation failures are logged and surfaced in the final merge gate feedback instead of being reduced to an unexplained missing-PR wait state.
- When the watch loop waits or exits at the final main-merge gate, the dashboard status snapshot is republished with the finalization report so operators can see the current blocker without waiting for a later cycle.
- If feature PR checks fail, the sprint loop keeps the task in work state and enters the CI-fix guardrail path. When `waitForJulesCiAutofix` is enabled for a Jules-managed task, Code UX first notifies the Jules session with failed-check context, matched failed run ids/URLs, failed job names, and failed-job log excerpts (when available). When that toggle is disabled, or the task is not Jules-managed, Code UX skips the Jules notification and dispatches a worker-owned `ci_fix_required` item.
- CI autofix retries are capped by `julesCiAutofixMaxRetries`; once exhausted, the task is escalated as intervention-needed with exact task id, PR URL, failed check names, failed run summary, and failed job names (focus: fix CI before merge). The cap applies to the generic CI-fix loop, including worker repairs.
- Worker-owned CI autofix attempts are de-duplicated across watch-loop cycles. While a matching `ci_fix_required` attention item is still open or claimed, Code UX treats that attempt as in-flight, keeps the task in `RUNNING`, and does not consume another retry until the worker attempt resolves.
- Watch-loop regression coverage now locks the idempotency contract for repeated cycles over the same sprint state: no duplicate task dispatch, QA review, CI autofix worker attention, or attention item should be created while the prior cycle's work remains active.
- Provider failures are evaluated before stale PR/session artifacts can settle a task. A failed or cancelled provider session with old PR metadata is reset to retryable `PENDING` when dependencies are satisfied, or `BLOCKED` when dependency policy requires waiting.
- Task QA gate states remain fail-closed at the merge boundary. `changes_requested`, stale/running QA, and exhausted review budget states keep the task in `CODING_COMPLETED` with `QA_PENDING` at the feature PR gate and must not auto-merge or start a new worker branch unless a later rerun/reset produces fresh code-complete work.
- Human/agent intervention is opened only after the CI-fix guardrail is exhausted; disabling the Jules notification toggle must not disable worker CI repair.

## Files and Data Used

- Subtasks directory:
  - `.jules-subagents/sprints/sprint<N>-subtasks/`
- Guide files:
  - `.jules-subagents/agents/*.md`
- Instruction templates:
  - `.jules-subagents/instructions/sprint-main-loop/**/*`
- CLI session tracking DB:
  - `~/.jules-subagents/session-tracking.db`

## Operational Advice

- Keep branch and planning preflight enabled in production.
- Disable individual steps only for diagnostics or controlled experiments.
- Treat instruction templates as runtime policy text, not source logic.
