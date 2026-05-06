# Sprint orchestration in depth

This page is the canonical reference for *how* a sprint runs end to end. It is written for users who want to understand and tune the orchestrator — not just drive it.

If you want a code-level walk-through, see [Architecture → Sprint engine](../architecture/sprint-engine.md).

## The three actions

A sprint can be acted on in three modes:

| Action | Purpose | Side effects |
| --- | --- | --- |
| **plan** | Generate or regenerate subtasks via the planning agent | Writes subtask markdown files; creates DB rows |
| **status** | Render the current state | None (refreshes dashboard snapshot only) |
| **orchestrate** | Execute — start tasks, gate merges, advance dependencies | Many: provider calls, Git pushes, PRs, merges |

The MCP API exposes all three under the `sprints` and `tasks` management domains. The dashboard buttons map 1:1.

## The cycle

A single orchestration *cycle* runs the following pipeline (each step is independently toggleable in `sprintLoopSteps`):

1. **branchPreflight** — Ensure the feature branch exists; create it from default branch if not.
2. **planningPreflight** — Validate the subtask graph: detect cycles, ensure required fields, sanity-check dependencies.
3. **loadSubtasks** — Read subtask markdown files and reconcile with DB state.
4. **sessionSync** — Pull the latest state of every active worker session (Jules / virtual).
5. **statusDerivation** — Apply state rules to derive each subtask's effective status (`PENDING`, `RUNNING`, `CODING_COMPLETED`, `COMPLETED`, etc.).
6. **startReadyTasks** — Find subtasks whose dependencies are met and start a new worker session for each. Concurrency is capped per provider via `maxConcurrentTasks`.
7. **mergeProtocol** — Run the [CI gate](./automation-and-ci.md): create PRs, watch CI, auto-merge per policy, surface attention items for conflicts and CI failures.
8. **actionRequiredProtocol** — Auto-handle plan approvals, clarification answers, paused sessions per `automationInterventions` settings.
9. **statusTable** — Render the cycle report.

Each step is independently catchable; a failure in one step does not crash the cycle. Errors are logged and surface as attention items.

## The watch loop

`orchestrate` typically runs continuously via the **watch loop** (`watchLoop: true`). The loop:

```
loop:
  cycle = run_cycle()
  if all tasks settled → finalize and exit
  if outputIntervalReached → emit checkpoint report and reset window
  sleep watchLoopIntervalSeconds
  check for control intervention (pause / cancel)
```

Defaults:

| Setting | Default | Min | Max | Notes |
| --- | --- | --- | --- | --- |
| `watchLoopIntervalSeconds` | `120` | `1` | `3600` | Cycle frequency |
| `watchLoopOutputIntervalSeconds` | `300` | `60` | `3600` | Checkpoint frequency |

If you set `watchLoop: false`, `orchestrate` runs exactly one cycle and returns.

## Dependency model

Each subtask has:

- `depends_on: string[]` — list of task IDs (the human-readable IDs from the markdown frontmatter).
- `is_independent: boolean` — explicit flag. Defaults to `true` if omitted.

A subtask is **ready to start** when:

1. Its status is `PENDING`.
2. All `depends_on` tasks are `COMPLETED` *and* `is_merged: true` (i.e. their PR has been merged into the feature branch).
3. The provider's `maxConcurrentTasks` cap is not full.
4. The emergency stop condition (see below) has not triggered.

This *gating on merge* is intentional: it ensures dependents see the actual code their dependencies produced, not just a green status flag.

## State machine

```
PENDING ──start──► RUNNING ──finish──► CODING_COMPLETED ──merged──► COMPLETED
                          ▲                       │
                          │                       │
                          ├──fail──► FAILED ──retry┤
                          ├──quota──► QUOTA ──next cycle┤
                          ├──QA reject──► QA_REVIEW_FAILED
                          └──blocked deps──► BLOCKED
```

Detailed transitions:

- **CODING_COMPLETED → COMPLETED** when the merge protocol confirms `is_merged: true` or a settled merge indicator (`MERGED`, `AUTOMERGE`, `PR_ONLY`).
- **COMPLETED → CODING_COMPLETED** if `is_merged` is false but there is merge evidence (an open PR or a worker branch). This is a temporary "awaiting merge" state.
- **FAILED**: retried in a new session if `retryFailed: true` (default).
- **QUOTA**: retried next cycle automatically.

## Concurrency

Per-provider concurrency is controlled by `provider.maxConcurrentTasks`:

| Provider | Default cap |
| --- | --- |
| Jules | `15` |
| Gemini | `0` (unlimited) |
| Codex | `0` (unlimited) |
| Claude Code | `0` (unlimited) |
| Qwen Code | `0` (unlimited) |
| OpenCode | `0` (unlimited) |

`0` means no cap. Set explicit caps when running on shared infrastructure to avoid resource contention.

## Emergency stop

To prevent runaway costs from a misconfiguration, Code UX tracks **consecutive task-start failures** per cycle. When this count reaches `maxFailures` (default `5`):

- The cycle aborts with `CRITICAL: Emergency stop active. <N> consecutive task creation failures detected.`
- The watch loop exits.
- A subsequent run resets the counter from zero.

Override via `maxFailures` in settings or `JULES_API_MAX_FAILS` in the environment. Recommended floor: `3`.

## Retries

Two distinct retry surfaces:

1. **Task-level retry** — `retryFailed: true` (default). Failed sessions get a fresh worker session next cycle. The original failure stays attached for diagnosis.
2. **CI autofix retry** — If a PR's CI is failing and `waitForJulesCiAutofix: true`, Code UX dispatches a CI fix worker. Up to `julesCiAutofixMaxRetries` (default `3`, max `20`) attempts before escalating to attention items.

## Action-required automation

Sessions can enter `AWAITING_PLAN_APPROVAL`, `AWAITING_USER_FEEDBACK` (clarification), or `PAUSED`. The engine can auto-handle these per `automationInterventions`:

| Toggle | Default | Behaviour |
| --- | --- | --- |
| `autoApprovePlan` | `true` | Auto-approve plan approval requests. |
| `autoAnswerClarification` | `false` | Auto-respond to clarification requests. |
| `autoAnswerClarificationMode` | `TEMPLATE` | `TEMPLATE` uses a fixed template; `WORKER` routes to the worker pool. |
| `autoResumePaused` | `false` | Auto-resume `PAUSED` sessions. |
| `clarificationAnswerTemplate` | *(default copy)* | Used when mode is `TEMPLATE`. |
| `clarificationCooldownSeconds` | `300` | Deduplication window — same prompt within this window is not re-answered. |

Higher-level **automation level** governs the master switch:

- `FULL` — auto-handle everything possible.
- `SEMI_AUTO` — respect individual toggles.
- `ALWAYS_ASK` — never auto-handle; always escalate.

## Finalisation

When every subtask reaches a terminal merged state, the watch loop runs the **finalisation step**:

1. **Resolve attention items** — close anything still open that no longer needs action.
2. **QA review** — if enabled, run a QA agent over the full set of merged changes.
3. **Main branch merge** — depending on `mainBranchAutoMergeMode`:
   - `OFF` — pause and surface the manual merge command.
   - `CREATE_PR` — open a PR to main and stop.
   - `WHEN_GREEN` — open a PR, wait for CI, merge.
   - `ALWAYS` — merge directly.
4. **Cleanup** — remove Docker worktrees from terminal CLI dispatches; trigger memory auto-promotion.
5. **Status transition** — `completed`, `failed`, `paused` (if main merge needs human), or `cancelled`.

## Cancellation & pause

Both are emitted as **control interventions** picked up at the top of each cycle:

- **Pause** — exits the loop cleanly. Active sessions are *not* killed.
- **Cancel requested** — exits the loop and signals dispatches to stop.
- **Cancelled** — terminal; no further cycles.

Force-cancel skips the graceful path; use only if the orchestrator hangs.

## Heartbeat & leasing

A sprint run holds a **lease** while orchestrating, refreshed by a heartbeat. This prevents:

- Two Code UX instances from picking up the same run.
- A stuck instance from blocking a cancellation forever (the lease expires).

Lease expiry behaviour and heartbeat cadence are internal — see [Architecture → sprint engine](../architecture/sprint-engine.md).

## Programmatic equivalents

Every UI action has an MCP equivalent:

| UI action | MCP call |
| --- | --- |
| Plan a sprint | `manage_code_ux` → `domain: "sprints"` (planning is internal during start) or use planning REST API |
| Orchestrate | `manage_code_ux` → `domain: "sprints", action: "start"` |
| Pause | `domain: "sprints", action: "pause"` |
| Cancel | `domain: "sprints", action: "cancel"` (or `force_cancel`) |
| Inspect run | `domain: "sprints", action: "inspect_run"` |
| Rerun task | `domain: "tasks", action: "start"` |
| Stop task | `domain: "tasks", action: "stop"` (or `force_stop`) |

See [Developer → Management actions](../developer/management-actions.md).
