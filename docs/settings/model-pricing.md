# Model Pricing

Stores token pricing metadata used for model cost estimates in dashboard views.

> Settings area: `model-pricing`
> Dashboard documentation route: `/docs/settings-model-pricing`

## What This Area Is For

Stores token pricing metadata used for model cost estimates in dashboard views. This page expands the short Settings-page help text into an operator reference for deciding when to change this area, what behavior the controls affect, and what to verify after saving.

Use it when you are configuring a new project, auditing inherited settings, or debugging behavior that changed after a system, project, or sprint override was saved.

## Controls And Runtime Effect

Pricing rows define per-model input and output token costs where the dashboard can estimate usage.

Published base prices come from the bundled `assets/models-dev/catalog.json` snapshot. npm and Electron packages both ship that same snapshot, so automatic estimates use identical catalogue rates in server and desktop installs; for example, a recorded `gpt-5.5` invocation resolves to the `openai/gpt-5.5` base price when no override exists.

| Control Surface | Runtime Effect | Review Before Saving |
| --- | --- | --- |
| Settings card fields | Updates the active Settings scope after you save the page. | Confirm whether you are editing System or Project scope. |
| Inherited values | Values can flow from system defaults into project and sprint behavior. | Check the source badge before assuming a value is project-specific. |
| Related runtime paths | The affected service reads the saved settings during planning, dispatch, dashboard rendering, or maintenance work. | Re-run the affected workflow after changing operational settings. |

## Recommended Configuration

Keep prices current for providers you actively route to and leave unknown models unset.

A practical review flow is:

1. Start from the inherited default and change only the fields that solve a concrete operational problem.
2. Save the smallest scope that should own the change. Use System for defaults that every project should inherit, and Project for repository-specific behavior.
3. Reopen the Settings page after saving when the value controls startup behavior, provider routing, preview runtime, or destructive maintenance.

## Risks And Gotchas

Outdated prices affect estimates only; they do not change provider billing.

If an installed build shows no price for a catalogue model, verify that its package contains `assets/models-dev/catalog.json`. A missing runtime catalogue is a packaging failure, not a zero-price override.

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
- [Dashboard Guide](../../dashboard/dashboard-guide.md)
