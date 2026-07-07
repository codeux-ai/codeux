# Provider Integration

Explains that AI provider credentials are system-owned while project scopes still control routing and auth-copy behavior. External chat provider connections also appear under Settings -> Providers, but they use a separate chat-provider runtime path for ingress, channel binding, and outbound reply delivery.

## What It Controls

The notices clarify where AI provider instances live, which settings remain project-scoped, and why chat provider connections are configured beside provider credentials without participating in AI model routing.

## Recommended Defaults

Switch to system scope to add AI provider credentials, then route them from AI Models. Configure chat provider connections from the provider integration cards only when an external chat bridge is ready to send authenticated ingress.

## Risks And Gotchas

Expecting project scope to create AI provider credentials can leave routes without provider instances. Expecting chat provider credentials to affect AI routing can also be misleading: chat provider connections bind external channels to projects, while AI provider credentials decide which model runs Code UX work.

## Dashboard Link

Open this subcategory from the dashboard docs route at `/docs/user/dashboard/settings#provider-integration`. The Settings card header links to the matching published docs anchor.

## Related Docs

- [Provider Routing](../provider-routing.md)
- [Chat Provider Integrations](../chat-provider-integrations.md)
- [Configuration and Storage](../configuration-and-storage.md)
