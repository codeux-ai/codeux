# Route Mapping

Routes each invocation type to inherited, manual, weighted, or agent-selected provider pools.

## What It Controls

Each route chooses a profile, strategy, primary instance, allowed weighted pool, and per-provider overrides. Thinking overrides can be cleared back to **Inherit base thinking**, which removes only the route-level `thinkingMode` field and lets the provider instance's base setting apply.

## Recommended Defaults

Use inherited defaults first, then override high-risk routes such as planning, QA, CI repair, and remediation.

## Risks And Gotchas

Weighted pools with unavailable providers can spread failures across multiple task types. Stale route thinking overrides can also hide a provider-level thinking budget change until the route is reset to inherit.

## Dashboard Link

Open this subcategory from the dashboard docs route at `/docs/user-dashboard-settings#route-mapping`. The Settings card header links to the matching published docs anchor.

## Related Docs

- [Provider Routing](../provider-routing.md)
- [Atomic Sprint Loop](../../sprint-loop/atomic-loop.md)
