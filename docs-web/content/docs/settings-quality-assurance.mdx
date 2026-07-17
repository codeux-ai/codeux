# Quality Assurance

Controls completion-time QA review, QA routing, and trigger-specific agent assignment.

> Settings area: `quality-assurance`
> Dashboard documentation route: `/docs/settings-quality-assurance`

## What This Area Is For

Controls completion-time QA review, QA routing, and trigger-specific agent assignment. This page expands the short Settings-page help text into an operator reference for deciding when to change this area, what behavior the controls affect, and what to verify after saving.

Use it when you are configuring a new project, auditing inherited settings, or debugging behavior that changed after a system, project, or sprint override was saved.

## Controls And Runtime Effect

QA toggles, route choices, and trigger selectors decide when and how final reviews run.

| Control Surface | Runtime Effect | Review Before Saving |
| --- | --- | --- |
| Settings card fields | Updates the active Settings scope after you save the page. | Confirm whether you are editing System or Project scope. |
| Inherited values | Values can flow from system defaults into project and sprint behavior. | Check the source badge before assuming a value is project-specific. |
| Related runtime paths | The affected service reads the saved settings during planning, dispatch, dashboard rendering, or maintenance work. | Re-run the affected workflow after changing operational settings. |

## Recommended Configuration

Keep QA enabled for multi-task sprints and route it to a provider with strong review behavior.

A practical review flow is:

1. Start from the inherited default and change only the fields that solve a concrete operational problem.
2. Save the smallest scope that should own the change. Use System for defaults that every project should inherit, and Project for repository-specific behavior.
3. Reopen the Settings page after saving when the value controls startup behavior, provider routing, preview runtime, or destructive maintenance.

## Risks And Gotchas

Disabling QA removes an important last check before merge automation continues.

Disabling task-completion QA while leaving sprint-completion QA enabled moves task-local defect discovery to the integrated sprint review. That review can split several distinct blockers into separate tracked follow-up tasks, so this configuration can make the sprint task list grow sharply near completion.

Before applying changes, check:

- Whether the value affects provider credentials, Docker runtime behavior, Git automation, memory retention, or destructive cleanup.
- Whether a project override is masking the system value you expected to change.
- Whether a running sprint needs to be paused, restarted, or allowed to finish before the new value can be observed.

Task-level QA prompts contain full details only for the task under review: title, status, provider, worker branch, PR, dependencies, the complete unshortened prompt, and the latest eight activity entries without content truncation. Other sprint tasks appear only after they reach `completed`, and then only their titles are listed; unfinished siblings and all sibling instructions, metadata, and activity are omitted. Sprint-completion QA still receives every task because it reviews cross-task integration. When that full sprint context exceeds 100,000 estimated tokens (using the runtime's four-characters-per-token estimate), sprint QA receives the first half of every task instruction with an explicit notice while task metadata, ordering, and recent activity remain intact.

During orchestration, QA reconciliation and initial merge-gate evaluation load the whole DAG's latest review cycles and attempt counts in a chunked batch. Review decisions, retry budgets, and fail-closed behavior are unchanged.

Task QA runs in waves of at most four reviews per orchestration cycle, or a lower positive capacity when the providers routed to `qa_review` are configured more conservatively. The cycle settles that wave, merges ready branches, and starts newly unblocked coding before scheduling more reviews. Provider admission remains authoritative and may reduce effective concurrency further under host pressure.

Codex QA coding follow-ups resolve the coding invocation associated with the task's durable workspace-binding run, then read that exact native thread's rollout from the paired runtime volume. This prevents another rollout in a reused runtime home, or a newer logical retry id, from separating the continuation thread from its saved `.codex` state. If a legacy or corrupt record still names a thread whose rollout is already unavailable, Code UX preserves the workspace and retries the self-contained QA fix prompt once in a fresh Codex conversation. Other resume failures remain failures, and strict recovery flows that require the exact recorded conversation do not use this fallback.

## Troubleshooting

If the saved setting does not appear to take effect:

- Verify the active Settings scope in the sticky command bar.
- Check for a project or sprint override that takes precedence over the system value.
- Refresh the affected dashboard page if the setting controls a rendered surface.
- Restart the local runtime only when the setting explicitly controls startup, listener, or process-level behavior.
- A newly created Codex invocation must persist the `thread.started` id from its own exec stream, and its telemetry must read `rollout-*-<thread-id>.jsonl` from the paired runtime volume rather than the directory's newest rollout. A legacy Task Coding invocation that reports `no rollout found for thread id` during a QA fix should emit one fresh-session retry while retaining the same task workspace. If it still fails, inspect the retry's provider error; Code UX does not loop or mask unrelated Codex failures.
- If a task exhausts QA and enters `QA_REVIEW_FAILED`, resolve or dismiss its QA handoff after reviewing or correcting the work. Code UX clears that task's QA history and retry guardrail, returns a still-parked task to code-complete review state, and lets the active sprint run one fresh QA cycle. Restarting alone intentionally preserves the QA hold.
- A fix continuation created by the review that reaches the configured cap gets one final verification review. A CLI continuation with no patch and no commits ahead is treated as `follow_up_no_progress` and applies the exhaustion policy immediately; repeated continuations cannot extend the budget indefinitely.
- Recovered failed, cancelled, or errored QA attempts retry only within the bounded infrastructure grace. All terminal attempts count toward the hard ceiling, so repeated container loss eventually opens the configured handoff.
- Sprint QA review limits count review cycles, not the number of findings in each earlier cycle. The final configured cycle is verification-only: if it does not pass, Code UX opens one sprint-scoped human handoff and does not create another automatic follow-up batch. Completed follow-up work cannot bypass that exhausted-budget handoff merely because it changed the task snapshot.
- After a person reviews a blocked sprint result, **Mark QA Pass** in the Sprints page action menu creates a durable manual passing verdict and resolves only the sprint-level QA handoff. The control is disabled while an automated sprint review is running; it does not approve task-level QA failures or unrelated attention.

## Related Documentation

- [Settings overview](/docs/settings-overview)
- [Dashboard Settings](/docs/user-dashboard-settings)
- [Quality Assurance Agent](/docs/user-automation-and-ci)
- [Provider Routing](/docs/user-providers-and-models)
