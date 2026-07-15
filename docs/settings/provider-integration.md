# Provider Integration

Explains that provider credentials are system-owned while project scopes still control routing and auth-copy behavior.

> Settings area: `provider-integration`
> Dashboard documentation route: `/docs/settings-provider-integration`

## What This Area Is For

Explains that provider credentials are system-owned while project scopes still control routing and auth-copy behavior. This page expands the short Settings-page help text into an operator reference for deciding when to change this area, what behavior the controls affect, and what to verify after saving.

Use it when you are configuring a new project, auditing inherited settings, or debugging behavior that changed after a system, project, or sprint override was saved.

## Controls And Runtime Effect

The notices clarify where provider instances live and which settings remain project-scoped.

| Control Surface | Runtime Effect | Review Before Saving |
| --- | --- | --- |
| Settings card fields | Updates the active Settings scope after you save the page. | Confirm whether you are editing System or Project scope. |
| Inherited values | Values can flow from system defaults into project and sprint behavior. | Check the source badge before assuming a value is project-specific. |
| Related runtime paths | The affected service reads the saved settings during planning, dispatch, dashboard rendering, or maintenance work. | Re-run the affected workflow after changing operational settings. |

## Recommended Configuration

Switch to system scope to add credentials, then route them from AI Models.

A practical review flow is:

1. Start from the inherited default and change only the fields that solve a concrete operational problem.
2. Save the smallest scope that should own the change. Use System for defaults that every project should inherit, and Project for repository-specific behavior.
3. Reopen the Settings page after saving when the value controls startup behavior, provider routing, preview runtime, or destructive maintenance.

## Localization And Protected Values

Provider setup descriptions, authentication-mode labels, chat-bridge fields, terminal chrome, and dashboard-authored status messages follow the selected dashboard language. Provider names, configuration paths, credential fields, terminal streams, and provider or network failures remain verbatim. The UI also preserves secure-storage capability checks and redaction independently of locale.

## Risks And Gotchas

Expecting project scope to create credentials can leave routes without provider instances.

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
- [Provider Routing](../provider-routing.md)
- [Configuration and Storage](../configuration-and-storage.md)
