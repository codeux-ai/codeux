# Merge Gates & Autofix

Configures review, conflict, CI, and auto-merge gates for feature and main-branch merges.

> Settings area: `merge-gates-autofix`
> Dashboard documentation route: `/docs/settings-merge-gates-autofix`

## What This Area Is For

Configures review, conflict, CI, and auto-merge gates for feature and main-branch merges. This page expands the short Settings-page help text into an operator reference for deciding when to change this area, what behavior the controls affect, and what to verify after saving.

Use it when you are configuring a new project, auditing inherited settings, or debugging behavior that changed after a system, project, or sprint override was saved.

## Controls And Runtime Effect

Comment resolution, conflict repair, CI repair, feature PR auto-merge, and main PR auto-merge shape merge readiness.

| Control Surface | Runtime Effect | Review Before Saving |
| --- | --- | --- |
| Settings card fields | Updates the active Settings scope after you save the page. | Confirm whether you are editing System or Project scope. |
| Inherited values | Values can flow from system defaults into project and sprint behavior. | Check the source badge before assuming a value is project-specific. |
| Related runtime paths | The affected service reads the saved settings during planning, dispatch, dashboard rendering, or maintenance work. | Re-run the affected workflow after changing operational settings. |

## Recommended Configuration

Require green checks and resolved comments for shared branches; use immediate auto-merge only in low-risk repositories.

A practical review flow is:

1. Start from the inherited default and change only the fields that solve a concrete operational problem.
2. Save the smallest scope that should own the change. Use System for defaults that every project should inherit, and Project for repository-specific behavior.
3. Reopen the Settings page after saving when the value controls startup behavior, provider routing, preview runtime, or destructive maintenance.

## Risks And Gotchas

Relaxed merge gates can land incomplete work; Local mode disables remote PR gates by design.

Before applying changes, check:

- Whether the value affects provider credentials, Docker runtime behavior, Git automation, memory retention, or destructive cleanup.
- Whether a project override is masking the system value you expected to change.
- Whether a running sprint needs to be paused, restarted, or allowed to finish before the new value can be observed.

## CI Repair Invariants

- A PR check rollup may contain an older cancelled or failed check beside its rerun. Code UX groups checks by workflow and check name and evaluates only the latest timestamped observation, so a newer pending or successful rerun supersedes historical failure.
- CI-repair evidence is selected from the newest branch-matched workflow run. A successful newer run prevents an older failed run from being sent back to a repair agent.
- A task blocked by CI remains code-complete and cannot be projected back to pending coding work merely because its provider session already completed.
- CI-owned tasks do not open `merge_required` attention. CI repair or its human handoff remains the only active blocker until checks settle.
- Coding-budget and CI-repair guardrail handoffs use distinct deduplication keys. Resolving one handoff resets only its matching guardrail purpose.
- When the task later settles as completed, Code UX resolves any remaining task guardrail handoff so the dashboard does not retain a stale intervention.

## Troubleshooting

If the saved setting does not appear to take effect:

- Verify the active Settings scope in the sticky command bar.
- Check for a project or sprint override that takes precedence over the system value.
- Refresh the affected dashboard page if the setting controls a rendered surface.
- Restart the local runtime only when the setting explicitly controls startup, listener, or process-level behavior.
- If repair repeats after a rerun passed, inspect the PR rollup timestamps and the newest branch run. Historical failed rows should no longer count once a later observation for the same workflow/check is pending or successful.

## Related Documentation

- [Settings overview](./index.md)
- [Dashboard Settings](../../dashboard/design-system-settings.md)
- [Operations Runbook](../../operations/runbook.md)
- [Security Hardening](../../operations/security-hardening.md)
