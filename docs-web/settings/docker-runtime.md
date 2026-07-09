# Docker Runtime

Defines the default container environment used by Docker-backed provider CLIs.

> Settings area: `docker-runtime`
> Dashboard documentation route: `/docs/settings-docker-runtime`

## What This Area Is For

Defines the default container environment used by Docker-backed provider CLIs. This page expands the short Settings-page help text into an operator reference for deciding when to change this area, what behavior the controls affect, and what to verify after saving.

Use it when you are configuring a new project, auditing inherited settings, or debugging behavior that changed after a system, project, or sprint override was saved.

## Controls And Runtime Effect

Image, setup script, memory limit, setup image caching, and Playwright browser preinstall shape each worker container.

| Control Surface | Runtime Effect | Review Before Saving |
| --- | --- | --- |
| Settings card fields | Updates the active Settings scope after you save the page. | Confirm whether you are editing System or Project scope. |
| Inherited values | Values can flow from system defaults into project and sprint behavior. | Check the source badge before assuming a value is project-specific. |
| Related runtime paths | The affected service reads the saved settings during planning, dispatch, dashboard rendering, or maintenance work. | Re-run the affected workflow after changing operational settings. |

## Recommended Configuration

Keep the default image unless your repo needs a custom toolchain; enable Playwright preinstall for browser-heavy QA.

A practical review flow is:

1. Start from the inherited default and change only the fields that solve a concrete operational problem.
2. Save the smallest scope that should own the change. Use System for defaults that every project should inherit, and Project for repository-specific behavior.
3. Reopen the Settings page after saving when the value controls startup behavior, provider routing, preview runtime, or destructive maintenance.

## Risks And Gotchas

Broken setup scripts or overly tight memory limits can fail every provider invocation in the scope.

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
- [Security Hardening](/docs/user-troubleshooting)
