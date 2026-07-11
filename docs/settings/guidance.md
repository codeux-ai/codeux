# Guidance

Manages selected tech-stack and styleguide guidance plus custom instruction entries for the active settings scope.

> Settings area: `guidance`
> Dashboard documentation route: `/docs/settings-guidance`

## What This Area Is For

Manages selected tech-stack and styleguide guidance plus custom instruction entries for the active settings scope. This page expands the short Settings-page help text into an operator reference for deciding when to change this area, what behavior the controls affect, and what to verify after saving.

Use it when you are configuring a new project, auditing inherited settings, or debugging behavior that changed after a system, project, or sprint override was saved.

## Controls And Runtime Effect

Each section has a selector with None support, custom entry add/edit/delete controls, and styleguide visibility controls for hiding built-in defaults from the UI.

| Control Surface | Runtime Effect | Review Before Saving |
| --- | --- | --- |
| Settings card fields | Updates the active Settings scope after you save the page. | Confirm whether you are editing System or Project scope. |
| Inherited values | Values can flow from system defaults into project and sprint behavior. | Check the source badge before assuming a value is project-specific. |
| Related runtime paths | The affected service reads the saved settings during planning, dispatch, dashboard rendering, or maintenance work. | Re-run the affected workflow after changing operational settings. |

## Recommended Configuration

Use None until a scope needs explicit design guidance; keep custom ids stable once projects or sprints reference them.

A practical review flow is:

1. Start from the inherited default and change only the fields that solve a concrete operational problem.
2. Save the smallest scope that should own the change. Use System for defaults that every project should inherit, and Project for repository-specific behavior.
3. Reopen the Settings page after saving when the value controls startup behavior, provider routing, preview runtime, or destructive maintenance.

## Risks And Gotchas

Built-in guidance is protected. Deleting a selected custom entry clears that selection back to None for the edited scope.

The built-in `game-experience` styleguide is for playable products and covers input feedback, performance budgets, deterministic lifecycle state, recovery, and accessible controls. It is distinct from `gaming-companion`, which remains available for game-adjacent statistics, loadout, matchmaking, and community interfaces.

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
- [Configuration and Storage](../configuration-and-storage.md)
- [Settings Reference](../configuration-and-storage.md)
