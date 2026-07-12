# Display Settings

Controls the dashboard shell layout, theme, accent color, motion preference, and desktop zoom when available.

> Settings area: `display-settings`
> Dashboard documentation route: `/docs/settings-display-settings`

## What This Area Is For

Controls the dashboard shell layout, theme, accent color, motion preference, and desktop zoom when available. This page expands the short Settings-page help text into an operator reference for deciding when to change this area, what behavior the controls affect, and what to verify after saving.

Use it when you are configuring a new project, auditing inherited settings, or debugging behavior that changed after a system, project, or sprint override was saved.

## Controls And Runtime Effect

Navigation mode switches dock/sidebar, theme sets color mode, accent color personalizes global actions and interaction states, reduced motion limits animation, and zoom scales Electron windows.

The accent palette is intentionally limited to accessible presets: Code UX, Ocean, Violet, Cyan, Magenta, and Graphite. Accent changes preview immediately and apply to primary actions, active navigation, focus rings, selections, and links. Provider identity colors, status colors, and chart series remain stable so accent personalization never changes their meaning.

| Control Surface | Runtime Effect | Review Before Saving |
| --- | --- | --- |
| Settings card fields | Updates the active Settings scope after you save the page. | Confirm whether you are editing System or Project scope. |
| Inherited values | Values can flow from system defaults into project and sprint behavior. | Check the source badge before assuming a value is project-specific. |
| Related runtime paths | The affected service reads the saved settings during planning, dispatch, dashboard rendering, or maintenance work. | Re-run the affected workflow after changing operational settings. |

## Recommended Configuration

Use System theme, Code UX accent, and Auto reduced motion unless you need a fixed accessibility or personalization preference.

A practical review flow is:

1. Start from the inherited default and change only the fields that solve a concrete operational problem.
2. Save the smallest scope that should own the change. Use System for defaults that every project should inherit, and Project for repository-specific behavior.
3. Reopen the Settings page after saving when the value controls startup behavior, provider routing, preview runtime, or destructive maintenance.

## Risks And Gotchas

High zoom or dense sidebars can reduce visible workspace on small screens.

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
- [Dashboard Accessibility Patterns](/docs/user-dashboard-overview)
- [Mobile Responsiveness](/docs/user-dashboard-overview)
