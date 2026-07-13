# Route Mapping

Routes each invocation type to inherited, manual, weighted, or agent-selected provider pools.

> Settings area: `route-mapping`
> Dashboard documentation route: `/docs/settings-route-mapping`

## What This Area Is For

Routes each invocation type to inherited, manual, weighted, or agent-selected provider pools. This page expands the short Settings-page help text into an operator reference for deciding when to change this area, what behavior the controls affect, and what to verify after saving.

Use it when you are configuring a new project, auditing inherited settings, or debugging behavior that changed after a system, project, or sprint override was saved.

## Controls And Runtime Effect

Each route chooses a profile, strategy, primary instance, allowed weighted pool, and per-provider overrides. Model and thinking overrides are passed together to every invocation path, including planning and planning retries.

| Control Surface | Runtime Effect | Review Before Saving |
| --- | --- | --- |
| Settings card fields | Updates the active Settings scope after you save the page. | Confirm whether you are editing System or Project scope. |
| Inherited values | Values can flow from system defaults into project and sprint behavior. | Check the source badge before assuming a value is project-specific. |
| Related runtime paths | The affected service reads the saved settings during planning, dispatch, dashboard rendering, or maintenance work. | Re-run the affected workflow after changing operational settings. |
| Codex thinking override | Selects the reasoning effort sent to Codex for this route. Codex Sol-family models also offer `max` and `ultra`; other Codex models stop at `xhigh`. | Choose the route model before its thinking override so the available effort levels match the model family. |

The dashboard keeps the current category, focused settings card, and selected invocation route in session state. A hard refresh in the same browser tab returns to that Route Mapping context; saved setting values still come from the active system or project scope.

Route provider pools resolve by provider instance id across `system -> project -> sprint`. A narrower scope can replace which provider ids participate, while each retained provider entry inherits `model`, `thinkingMode`, `enabled`, and `weight` independently. For example, a project-only thinking override keeps the system route model instead of falling back to that provider instance's base model.

## Recommended Configuration

Use inherited defaults first, then override high-risk routes such as planning, QA, CI repair, and remediation.

A practical review flow is:

1. Start from the inherited default and change only the fields that solve a concrete operational problem.
2. Save the smallest scope that should own the change. Use System for defaults that every project should inherit, and Project for repository-specific behavior.
3. Reopen the Settings page after saving when the value controls startup behavior, provider routing, preview runtime, or destructive maintenance.

## Risks And Gotchas

Weighted pools with unavailable providers can spread failures across multiple task types.

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
- [Provider Routing](/docs/user-providers-and-models)
- [Atomic Sprint Loop](/docs/user-sprint-orchestration)
