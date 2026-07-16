# Restart Behavior

Chooses how active sprints and interrupted provider invocations are reconciled after the app restarts.

> Settings area: `restart-behavior`
> Dashboard documentation route: `/docs/settings-restart-behavior`

## What This Area Is For

Chooses how active sprints and interrupted provider invocations are reconciled after the app restarts. This page expands the short Settings-page help text into an operator reference for deciding when to change this area, what behavior the controls affect, and what to verify after saving.

Use it when you are configuring a new project, auditing inherited settings, or debugging behavior that changed after a system, project, or sprint override was saved.

## Controls And Runtime Effect

Sprint policy continues, pauses, or cancels active sprints; invocation policy continues, cancels, or restarts interrupted work.

The invocation policy applies to every provider-backed orchestration stage, not only task coding. Under `continue`, Code UX durably resumes sprint planning, task coding, QA review, QA-requested coding follow-up, CI-fix, and merge-conflict work from their recorded logical session and workspace. When the provider exposed a resumable native session, the replacement invocation continues that native conversation as well.

| Control Surface | Runtime Effect | Review Before Saving |
| --- | --- | --- |
| Settings card fields | Updates the active Settings scope after you save the page. | Confirm whether you are editing System or Project scope. |
| Inherited values | Values can flow from system defaults into project and sprint behavior. | Check the source badge before assuming a value is project-specific. |
| Related runtime paths | The affected service reads the saved settings during planning, dispatch, dashboard rendering, or maintenance work. | Re-run the affected workflow after changing operational settings. |

### Continue-policy recovery contract

When `restartSprintPolicy = continue` and `restartInvocationPolicy = continue`, startup recovery:

- resumes the existing sprint run and watch loop instead of creating a replacement sprint run
- preserves the complete sprint-planning request and its routing options, closes the process-bound invocation interrupted by shutdown, and continues the exact provider-native planning session in the preserved planning workspace. A missing recorded provider conversation fails closed rather than silently creating a new conversation. Only a request interrupted before provider linkage is reissued from its durable full prompt, because no provider session existed yet.
- correlates each interrupted QA reviewer with its exact execution invocation, reviewer preset, logical provider session, and isolated review workspace
- reuses the QA review workspace and provider conversation only while completing the same interrupted review cycle; verification after a decisive verdict starts from a fresh branch snapshot so it sees any coding follow-up
- checkpoints every configured reviewer in a multi-reviewer cycle before invoking the first reviewer; recovery keeps completed verdicts, resumes only interrupted reviewers, and fills any reviewer row missing from a legacy partial cycle without spending another QA cycle
- preserves task-level and sprint-completion `changes_requested` verdicts before starting their coding handoffs; if restart occurs between the verdict and the follow-up invocation, the next cycle resumes that pending handoff instead of leaving QA indefinitely blocked
- returns an abruptly failed QA coding handoff to `CODING_COMPLETED`/`QA_PENDING` and retries it from the recorded coding session and workspace. A successful or reconciled handoff remains in that verification-ready state until the next QA review starts, preventing the restart window from launching unrelated coding work. Provider failures are bounded to three continuation attempts, while resuming a `running` checkpoint after a runtime restart does not consume another failure allowance; exhaustion then follows the configured QA exhaustion policy instead of redispatching the task as unrelated coding or heartbeating forever.
- records the original worker-branch baseline before invoking a QA coding follow-up and reuses it after restart, so provider commits made before host-branch publication are still exported and published instead of being mistaken for an empty follow-up
- treats coding-provider completion as an intermediate checkpoint until Git finalization records a pushed branch or a verified no-change result. Task QA waits for that evidence. If restart interrupts this window, startup uses recovered-session membership (including hard kills with no shutdown event), preserves the workspace, requeues the premature terminal projection, and continues at Git finalization without calling the coding provider again.
- reconciles the recovered coding task-run and dispatch after a successful handoff, preventing an earlier transient failure marker from incorrectly failing the sprint during terminal evaluation
- requeues interrupted worker-owned CI-fix and merge-conflict attention, clearing ownership left by the stopped virtual worker
- closes the stopped repair attempt's provider-usage row before requeueing it, so a hard restart cannot leave a stale invocation occupying the provider concurrency limit. A durable `workspace_finalized`, `host_publishing`, or `host_published` checkpoint proves that the provider returned successfully, so recovery records that attempt as completed; an attempt interrupted before that boundary is recorded as cancelled.
- resumes those repair workers with the same logical session, native provider session when available, and preserved workspace, so uncommitted repair progress survives the process boundary

Recovery creates a correlated continuation invocation only when provider work was interrupted. When provider work already completed, recovery continues publication or attention finalization from the durable checkpoint without calling the provider again. A cancelled audit attempt therefore does not mean the logical work was abandoned, while a completed attempt remains visible as completed across the restart.

## Recommended Configuration

Continue sprints and continue invocations for local development; pause when you want manual review after downtime.

A practical review flow is:

1. Start from the inherited default and change only the fields that solve a concrete operational problem.
2. Save the smallest scope that should own the change. Use System for defaults that every project should inherit, and Project for repository-specific behavior.
3. Reopen the Settings page after saving when the value controls startup behavior, provider routing, preview runtime, or destructive maintenance.

## Risks And Gotchas

Restarting interrupted work can duplicate provider effort if the previous CLI run was still externally active.

The continuation guarantee depends on the provider's resumable session support and on the workspace volume still being available. Code UX preserves managed workspace volumes during a normal shutdown and fails closed when it cannot safely recover required Git state; manually deleting Docker volumes or provider-side conversations removes information the runtime cannot reconstruct.

Before applying changes, check:

- Whether the value affects provider credentials, Docker runtime behavior, Git automation, memory retention, or destructive cleanup.
- Whether a project override is masking the system value you expected to change.
- Whether a running sprint needs to be paused, restarted, or allowed to finish before the new value can be observed.

## Troubleshooting

If the saved setting does not appear to take effect:

- Verify the active Settings scope in the sticky command bar.
- Check for a project or sprint override that takes precedence over the system value.
- Refresh the affected dashboard page if the setting controls a rendered surface.
- Restart the local runtime only when the setting explicitly controls startup, listener, or process-level behavior.
- For a task parked at `QA_PENDING`, inspect the latest QA row for a pending fix handoff and confirm that a correlated `cli_task_followup` invocation was resumed or already completed.
- For CI-fix or merge-conflict work, confirm the attention item returned to the queue after startup and that its continuation invocation retained the prior workspace/session identifiers.

## Related Documentation

- [Settings overview](/docs/settings-overview)
- [Dashboard Settings](/docs/user-dashboard-settings)
- [Operations Runbook](/docs/user-troubleshooting)
- [Atomic Sprint Loop](/docs/user-sprint-orchestration)
