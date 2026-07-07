# Route Mapping

Routes each invocation type to inherited, manual, weighted, or agent-selected provider pools.

## What It Controls

Each route chooses a profile, strategy, primary instance, allowed weighted pool, and per-provider overrides.

## Recommended Defaults

Use inherited defaults first, then override high-risk routes such as planning, QA, CI repair, and remediation.

## Risks And Gotchas

Weighted pools with unavailable providers can spread failures across multiple task types.

## Dashboard Link

Open this subcategory from the dashboard docs route at `/docs/settings-subcategories-route-mapping`. The Settings card header links directly to this published subpage.

## Related Docs

- [Provider Routing](../provider-routing.md)
- [Atomic Sprint Loop](../../sprint-loop/atomic-loop.md)
