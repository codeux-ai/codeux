# Sprint engine

The sprint engine is the heart of Code UX. It schedules, dispatches, monitors, gates, and finalises every unit of work.

This page documents the runner classes, the cycle pipeline, the watch loop state machine, and the safety mechanisms.

## Source map

| File | Role |
| --- | --- |
| `src/domain/sprint/orchestrator/sprint-action-runner.ts` | Top-level dispatcher (plan / status / orchestrate). |
| `src/domain/sprint/orchestrator/cycle-runner.ts` | Single cycle execution. |
| `src/domain/sprint/orchestrator/watch-loop-runner.ts` | Continuous loop wrapper. |
| `src/domain/sprint/orchestrator/watch-loop-state-machine.ts` | State decision (RUNNING / CHECKPOINT / FINISHED). |
| `src/sprint/steps/start-ready-tasks-step.ts` | Task-start step + emergency-stop logic. |
| `src/domain/sprint/task-merge-state.ts` | Subtask state transition rules. |
| `src/domain/sprint/ci/feature-pr-gate.ts` | Merge protocol / CI gate. |
| `src/sprint/action-required-automation.ts` | Plan / clarification / paused auto-handling. |

## Sprint actions

```
plan        → SprintActionRunner.runPlan         → planning agent → write subtask MD
status      → SprintActionRunner.runStatus       → snapshot only, no mutation
orchestrate → SprintActionRunner.runOrchestrate  → CycleRunner (one shot) OR WatchLoopRunner (continuous)
```

`status` ignores `wait: true` (it's always instant). `orchestrate` runs as a watch loop by default; pass `watchLoopEnabled: false` to run a single cycle.

## Cycle pipeline

A cycle runs the following steps. Each step is independently togglable via `sprintLoopSteps`:

| Step | Purpose |
| --- | --- |
| `branchPreflight` | Ensure the feature branch exists; create from `defaultBranch` if not. |
| `planningPreflight` | Validate the subtask graph (no cycles, required fields). |
| `loadSubtasks` | Read on-disk markdown; reconcile with DB. |
| `sessionSync` | Pull latest worker session state (Jules API + virtual). |
| `statusDerivation` | Apply `evaluatePreCiGateTransition` to advance task statuses. |
| `startReadyTasks` | Find ready PENDING tasks, dispatch new sessions (respecting concurrency caps and emergency stop). |
| `mergeProtocol` | Run `evaluateCiGate` for every CODING_COMPLETED task. |
| `actionRequiredProtocol` | Auto-handle plan approvals, clarifications, paused sessions. |
| `statusTable` | Render the report. |

Each step catches its own errors. A failure logs the error, surfaces an attention item if appropriate, and proceeds to the next step. The cycle does *not* abort.

## Subtask state machine

```
                ┌──── retryFailed ────┐
                │                      │
                ▼                      │
              FAILED ◄───── fail ──────┤
                                       │
                                       │
PENDING ──start──► RUNNING ──finish──► CODING_COMPLETED ──merged──► COMPLETED
                          │                      ▲
                          ├── quota ──► QUOTA ──┤  (retried next cycle)
                          ├── blocked deps ──► BLOCKED
                          └── QA reject ──► QA_REVIEW_FAILED
```

Key transitions (in `task-merge-state.ts`):

```ts
function evaluatePreCiGateTransition(task: TaskPreCiGateState): PreCiGateTransition {
  // COMPLETED but PR not merged → CODING_COMPLETED
  if (status === "COMPLETED" && taskHasMergeEvidence(task) && !task.is_merged) {
    status = "CODING_COMPLETED";
  }
  // CODING_COMPLETED + merge settled → COMPLETED
  else if (status === "CODING_COMPLETED" && isCompletedTaskSettled({...task})) {
    status = "COMPLETED";
  }
  return { status, merge_indicator, intervention_owner: ... };
}
```

A task is "ready to start" when:

1. Its status is `PENDING`.
2. Every `depends_on` task has status `COMPLETED` *and* `is_merged: true`.
3. `provider.maxConcurrentTasks` has slack.
4. Emergency stop is not active.

## Watch loop state machine

The watch loop wraps the cycle in continuous monitoring. At each iteration:

```ts
enum WatchLoopState { RUNNING, CHECKPOINT, FINISHED }

function determineNextState(ctx) {
  if (ctx.allFinished) return FINISHED;
  if (ctx.outputIntervalReached) return CHECKPOINT;
  return RUNNING;
}
```

Behaviour per state:

- `FINISHED` → run finalisation, emit final report, exit loop.
- `CHECKPOINT` → emit progress report, reset checkpoint window, sleep one interval.
- `RUNNING` → sleep one interval, no output.

Default tunables (`sprintLoopSteps`):

| Setting | Default | Min | Max |
| --- | --- | --- | --- |
| `watchLoopIntervalSeconds` | 120 | 1 | 3600 |
| `watchLoopOutputIntervalSeconds` | 300 | 60 | 3600 |

## Heartbeat & leasing

A sprint run holds a **lease** while the watch loop is active. The `HeartbeatService` refreshes the lease on a timer. Lease purpose:

- Prevent two Code UX instances from picking up the same run.
- Allow a stuck instance's lease to expire so cancellation works.

Lease tokens are passed into the cycle context; control interventions (pause, cancel) are evaluated at the top of each cycle iteration.

## Action-required automation

When a session is in `AWAITING_PLAN_APPROVAL`, `AWAITING_USER_FEEDBACK` (clarification), or `PAUSED`, the engine consults `automationLevel` and `automationInterventions`:

- `FULL` → auto-act on everything possible.
- `SEMI_AUTO` → respect each individual toggle.
- `ALWAYS_ASK` → escalate to attention items.

Deduplication uses per-session keys (latest agent prompt + task prompt, max 1000 chars) within `clarificationCooldownSeconds` (default 300 s).

## Emergency stop

Source: `src/sprint/steps/start-ready-tasks-step.ts:29-83`.

Each cycle tracks **consecutive task-start failures**. When the count reaches `maxFailures` (default `5`):

```ts
if (currentFails >= options.maxFailures) {
  throw new Error(
    `CRITICAL: Emergency stop triggered after ${currentFails} consecutive task creation failures.`
  );
}
```

Effect: the cycle aborts, the watch loop exits, the sprint pauses with the error attached. A subsequent run resets the counter from 0.

Override: `maxFailures` setting or `JULES_API_MAX_FAILS` env. Recommended floor: 3.

## CI autofix retries

Per task, the CI gate tracks attempted CI fix dispatches in `ciAutofixRetryCounts: Map<taskId, number>`. The cap is `julesCiAutofixMaxRetries` (default 3, min 0, max 20).

Beyond the cap, the gate emits an attention item rather than dispatching another fix worker.

## Finalisation

Source: `watch-loop-runner.ts:373-683`.

When all tasks have settled (no RUNNING / CODING_COMPLETED that aren't terminal), the loop runs the **finalisation step**:

1. Resolve manual attention items (close stale ones).
2. Optional QA review pass.
3. Check main branch merge status.
4. Decide:
   - `mainBranchAutoMergeMode == OFF` → pause, surface manual-merge command.
   - `CREATE_PR` → open PR to main, stop.
   - `WHEN_GREEN` → open PR, await CI, merge.
   - `ALWAYS` → merge directly.
5. Cleanup terminal CLI worktrees (Docker mounts, removed worktrees).
6. Trigger memory auto-promotion.
7. Transition sprint to `completed` / `failed` / `paused` / `cancelled`.

## Concurrency

Per provider, `maxConcurrentTasks` caps active sessions. The start-ready step honours both:

- The cap (currently active sessions per provider must be < cap).
- Emergency stop.

Within a cycle, ready tasks are dispatched in dependency-order, then by priority, then by task ID.

## Cycle telemetry

Each cycle emits:

- A **cycle event** (start, end, duration, error count).
- **Task transition events** (status / merge_indicator changes).
- **Attention item events** when items are created or resolved.

These events are persisted via the `ExecutionRepository` and broadcast over the WebSocket. The dashboard's **Live Session** page consumes them to render the timeline.

## Rerun semantics

Rerunning a task (`tasks.start`) creates a new dispatch:

- Optionally clears the worktree (`clearWorktree: true`) — useful if the previous attempt left state.
- Optionally cascades `BLOCKED` reset to dependents (`resetDependents: true`).

The previous failed dispatch is preserved for diagnosis. The task gets a fresh provider session.

## Cancellation flow

```
User clicks Cancel
  → POST /api/sprint-runs/:id/cancel
  → SprintRunStatusService transitions status to "cancel_requested"
  → WatchLoopRunner observes at next cycle top, exits cleanly
  → SignalDispatchControl marks active dispatches "cancel"
  → VirtualWorkerService session-poll loop observes, exits
  → Sprint run transitions to "cancelled"
```

Force cancel skips the graceful "cancel_requested" → "cancelled" pause; use only when graceful is stuck.
