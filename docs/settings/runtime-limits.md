# Runtime Limits

Sets preview container concurrency, ports, startup behavior, and optional Docker daemon access.

> Settings area: `runtime-limits`
> Dashboard documentation route: `/docs/settings-runtime-limits`

## What This Area Is For

Sets preview container concurrency, host port range, app port, startup script/command, and Docker access. This page expands the short Settings-page help text into an operator reference for deciding when to change this area, what behavior the controls affect, and what to verify after saving.

Use it when you are configuring a new project, auditing inherited settings, or debugging behavior that changed after a system, project, or sprint override was saved.

## Controls And Runtime Effect

Container cap, host port start/end, internal app port, startup path/command, and Docker access decide how previews launch.

| Control Surface | Runtime Effect | Review Before Saving |
| --- | --- | --- |
| Settings card fields | Updates the active Settings scope after you save the page. | Confirm whether you are editing System or Project scope. |
| Inherited values | Values can flow from system defaults into project and sprint behavior. | Check the source badge before assuming a value is project-specific. |
| Related runtime paths | The affected service reads the saved settings during planning, dispatch, dashboard rendering, or maintenance work. | Re-run the affected workflow after changing operational settings. |
| Default startup command | Replaces auto-detected preview startup for this scope. A Browser sidebar container override takes precedence. | Keep `HOST=0.0.0.0` and the Code UX preview port variables in commands that start a listener. |
| Allow Docker access | Mounts the local Unix Docker socket and validates Docker CLI/daemon access before app startup. | Treat this as host-level control and enable it only for trusted repositories. |

## Recommended Configuration

Keep preview ports on localhost-only ranges and set the app port to the project dev server port.

A practical review flow is:

1. Start from the inherited default and change only the fields that solve a concrete operational problem.
2. Save the smallest scope that should own the change. Use System for defaults that every project should inherit, and Project for repository-specific behavior.
3. Reopen the Settings page after saving when the value controls startup behavior, provider routing, preview runtime, or destructive maintenance.

## Risks And Gotchas

Port collisions, wrong startup commands, missing Docker tooling, or daemon permissions prevent previews from becoming reachable.

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
- [Browser Preview](../../dashboard/browser-preview.md)
- [Security Hardening](../../operations/security-hardening.md)
