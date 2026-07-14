# Techstacks

Manages the system techstack catalog and per-project techstack/application-kind assignment.

> Settings area: `techstacks`
> Dashboard documentation route: `/docs/settings-techstacks`

## What This Area Is For

Manages the system techstack catalog and per-project techstack/application-kind assignment. This page expands the short Settings-page help text into an operator reference for deciding when to change this area, what behavior the controls affect, and what to verify after saving.

Use it when you are configuring a new project, auditing inherited settings, or debugging behavior that changed after a system, project, or sprint override was saved.

## Controls And Runtime Effect

System scope owns stack entries, default-stack selection, and technology items; project scope chooses a stack, clears to Unassigned, and selects web or desktop app kind.

Catalog controls, validation, empty states, and application-kind labels follow the active dashboard locale. Stored stack ids, catalog labels, technology/package names, and the `web` or `desktop` application-kind values remain unchanged.

| Control Surface | Runtime Effect | Review Before Saving |
| --- | --- | --- |
| Settings card fields | Updates the active Settings scope after you save the page. | Confirm whether you are editing System or Project scope. |
| Inherited values | Values can flow from system defaults into project and sprint behavior. | Check the source badge before assuming a value is project-specific. |
| Related runtime paths | The affected service reads the saved settings during planning, dispatch, dashboard rendering, or maintenance work. | Re-run the affected workflow after changing operational settings. |

## Recommended Configuration

Keep imported projects unassigned until setup or an operator identifies the stack; use the built-in Code UX stack only for Code UX-style Preact dashboards.

A practical review flow is:

1. Start from the inherited default and change only the fields that solve a concrete operational problem.
2. Save the smallest scope that should own the change. Use System for defaults that every project should inherit, and Project for repository-specific behavior.
3. Reopen the Settings page after saving when the value controls startup behavior, provider routing, preview runtime, or destructive maintenance.

## Risks And Gotchas

Deleting custom stacks clears references to them, while the built-in Code UX Stack is protected and restored by settings normalization.

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

- [Settings overview](/docs/settings-overview)
- [Dashboard Settings](/docs/user-dashboard-settings)
- [Configuration and Storage](/docs/developer-settings-reference)
- [Settings Reference](/docs/developer-settings-reference)
