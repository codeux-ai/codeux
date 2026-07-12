# Provider Credentials

Manages named provider instances, authentication mode, local auth copy, dashboard login, provider config files, and base model defaults.

> Settings area: `provider-credentials`
> Dashboard documentation route: `/docs/settings-provider-credentials`

## What This Area Is For

Manages named provider instances, authentication mode, local auth copy, dashboard login, provider config files, and base model defaults. This page expands the short Settings-page help text into an operator reference for deciding when to change this area, what behavior the controls affect, and what to verify after saving.

Use it when you are configuring a new project, auditing inherited settings, or debugging behavior that changed after a system, project, or sprint override was saved.

## Controls And Runtime Effect

Each instance owns an encrypted credential reference, auth path/login/config-file mode, routing-visible identity, and availability. API-key mode selects credential metadata by name; stored values are never displayed or saved with ordinary settings.

| Control Surface | Runtime Effect | Review Before Saving |
| --- | --- | --- |
| Settings card fields | Updates the active Settings scope after you save the page. | Confirm whether you are editing System or Project scope. |
| Credential binding | Binds an active project/global credential with the `read` capability and stores only its credential ID. | Select a project for credential administration and confirm secure-backend health. |
| Create, rotate, replace, revoke | Sends write-only values directly to the credential broker; replace and revoke require confirmation. | Secret inputs clear after successful submission and cannot be recovered from the dashboard. |
| Inherited values | Values can flow from system defaults into project and sprint behavior. | Check the source badge before assuming a value is project-specific. |
| Related runtime paths | The affected service reads the saved settings during planning, dispatch, dashboard rendering, or maintenance work. | Re-run the affected workflow after changing operational settings. |

## Recommended Configuration

Use named instances per account or quota pool; use Provider Config File only when a CLI needs a specific config copied.

A practical review flow is:

1. Start from the inherited default and change only the fields that solve a concrete operational problem.
2. Save the smallest scope that should own the change. Use System for defaults that every project should inherit, and Project for repository-specific behavior.
3. Reopen the Settings page after saving when the value controls startup behavior, provider routing, preview runtime, or destructive maintenance.

## Risks And Gotchas

Local auth copy and config-file mounts expose host credentials to Docker-backed provider runs. A legacy API-key warning means the setting still requires one-way migration: create or select a broker credential, bind it, and save to scrub the compatibility field.

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
- [Qwen Code Integration](../qwen-code-integration.md)
- [OpenCode Integration](../opencode-integration.md)
- [Security Hardening](../../operations/security-hardening.md)
