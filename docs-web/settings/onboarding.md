# Onboarding

Reopens the guided setup flow without changing saved settings by itself.

> Settings area: `onboarding`
> Dashboard documentation route: `/docs/settings-onboarding`

## What This Area Is For

Reopens the guided setup flow without changing saved settings by itself. This page expands the short Settings-page help text into an operator reference for deciding when to change this area, what behavior the controls affect, and what to verify after saving.

Use it when you are configuring a new project, auditing inherited settings, or debugging behavior that changed after a system, project, or sprint override was saved.

## Controls And Runtime Effect

The action button launches onboarding so you can revisit provider, project, and setup prompts.

Easy mode follows the short Setup mode, Installation, Introduction, Provider, and GitHub sequence. The Introduction presents the container-first runtime and credential boundary before provider setup. Easy provider selection offers Antigravity, Codex, Claude Code, Qwen Code, and OpenCode; deprecated Gemini CLI remains available in Standard, Expert, and Settings but is not shown in Easy. Every Easy provider card initially selects **Dashboard Login**. Operators can still explicitly switch the selected provider to **Local Copy** before finishing.

| Control Surface | Runtime Effect | Review Before Saving |
| --- | --- | --- |
| Settings card fields | Updates the active Settings scope after you save the page. | Confirm whether you are editing System or Project scope. |
| Inherited values | Values can flow from system defaults into project and sprint behavior. | Check the source badge before assuming a value is project-specific. |
| Related runtime paths | The affected service reads the saved settings during planning, dispatch, dashboard rendering, or maintenance work. | Re-run the affected workflow after changing operational settings. |

## Recommended Configuration

Use it when setting up a new machine or after adding provider credentials.

A practical review flow is:

1. Start from the inherited default and change only the fields that solve a concrete operational problem.
2. Save the smallest scope that should own the change. Use System for defaults that every project should inherit, and Project for repository-specific behavior.
3. Reopen the Settings page after saving when the value controls startup behavior, provider routing, preview runtime, or destructive maintenance.

## Risks And Gotchas

Saving new onboarding choices can overwrite the current system defaults.

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
- [Dashboard Onboarding](/docs/user-installation)
- [Quickstart](/docs/user-quickstart)
