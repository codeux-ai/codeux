# Default Routing Anchors

Sets the global and worker provider instances used when invocation routes inherit defaults.

## What It Controls

Global and worker defaults choose named provider instances and base models; concurrency and timeout cap worker dispatch.

## Recommended Defaults

Pick stable, authenticated instances for both anchors before fine-tuning route overrides.

## Risks And Gotchas

Unconfigured anchors leave inherited routes without a usable provider.

## Dashboard Link

Open this subcategory from the dashboard docs route at `/docs/user-dashboard-settings#default-routing-anchors`. The Settings card header links to the matching published docs anchor.

## Related Docs

- [Provider Routing](../provider-routing.md)
- [Configuration and Storage](../configuration-and-storage.md)
