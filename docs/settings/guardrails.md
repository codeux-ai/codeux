# Guardrails

Caps repeated agent jobs so runaway planning, coding, CI, merge, clarification, or remediation loops stop predictably.

> Settings area: `guardrails`
> Dashboard documentation route: `/docs/settings-guardrails`

## What This Area Is For

Caps repeated agent jobs so runaway planning, coding, CI, merge, clarification, or remediation loops stop predictably. This page expands the short Settings-page help text into an operator reference for deciding when to change this area, what behavior the controls affect, and what to verify after saving.

Use it when you are configuring a new project, auditing inherited settings, or debugging behavior that changed after a system, project, or sprint override was saved.

## Controls And Runtime Effect

Per-job caps and on-limit actions determine whether Code UX blocks, waits, warns, or continues.

The system defaults allow five task-coding attempts and five CI-fix attempts per task. Both default to `BLOCK_AND_ESCALATE`, so reaching either cap stops further automated attempts and creates an intervention handoff. A cap of `0` remains unlimited.

On upgrade, a persisted guardrail profile that exactly matches the former complete default (eight coding attempts and three CI-fix attempts, with every other policy unchanged) is advanced once to the new five/five defaults. Any customized policy shape is preserved, even when it intentionally uses an `8` or `3` cap.

| Control Surface | Runtime Effect | Review Before Saving |
| --- | --- | --- |
| Settings card fields | Updates the active Settings scope after you save the page. | Confirm whether you are editing System or Project scope. |
| Inherited values | Values can flow from system defaults into project and sprint behavior. | Check the source badge before assuming a value is project-specific. |
| Related runtime paths | The affected service reads the saved settings during planning, dispatch, dashboard rendering, or maintenance work. | Re-run the affected workflow after changing operational settings. |

## Recommended Configuration

Keep guardrails enabled and use block-and-escalate for expensive or destructive job types.

A practical review flow is:

1. Start from the inherited default and change only the fields that solve a concrete operational problem.
2. Save the smallest scope that should own the change. Use System for defaults that every project should inherit, and Project for repository-specific behavior.
3. Reopen the Settings page after saving when the value controls startup behavior, provider routing, preview runtime, or destructive maintenance.

## Risks And Gotchas

Very high caps can burn provider quota; very low caps can stop recoverable work too early.

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

## Related Documentation

- [Settings overview](./index.md)
- [Dashboard Settings](../../dashboard/design-system-settings.md)
- [Quality Guardrails](../../architecture/quality-guardrails.md)
- [Operations Runbook](../../operations/runbook.md)
