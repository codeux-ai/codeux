# Base Provider Configuration

Defines each named provider instance's default eligibility, model, thinking depth, weight, and concurrency.

## What It Controls

Provider cards set default route participation, model, thinking mode, weighted routing weight, and max concurrent tasks.

Project and sprint scopes store these provider cards as sparse overrides. When a project changes only a named instance's base model or thinking depth, the other fields for that same provider-config ID, such as `enabled`, `weight`, and `maxConcurrentTasks`, continue to inherit from the parent scope.

## Recommended Defaults

Keep only healthy instances eligible and use weights to express preference rather than hard pinning every route.

## Risks And Gotchas

Incompatible model choices or high concurrency can cause repeated provider failures or quota pressure.

Base provider inheritance is field-by-field, but invocation route provider maps are narrower: a route-level `providers` map replaces the inherited provider map for that route so explicit pools do not silently admit parent-scope providers.

## Dashboard Link

Open this subcategory from the dashboard docs route at `/docs/user-dashboard-settings#base-provider-configuration`. The Settings card header links to the matching published docs anchor.

## Related Docs

- [Provider Routing](../provider-routing.md)
- [Qwen Code Integration](../qwen-code-integration.md)
- [OpenCode Integration](../opencode-integration.md)
