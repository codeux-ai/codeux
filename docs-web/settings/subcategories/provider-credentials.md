# Provider Credentials

Manages named provider instances, authentication mode, local auth copy, dashboard login, provider config files, and base model defaults.

## What It Controls

Each instance owns API key/auth path/login/config-file mode plus routing-visible identity and availability.

## Recommended Defaults

Use named instances per account or quota pool; use Provider Config File only when a CLI needs a specific config copied.

## Risks And Gotchas

Local auth copy and config-file mounts expose host credentials to Docker-backed provider runs.

## Dashboard Link

Open this subcategory from the dashboard docs route at `/docs/settings-subcategories-provider-credentials`. The Settings card header links directly to this published subpage.

## Related Docs

- [Provider Routing](../provider-routing.md)
- [Qwen Code Integration](../qwen-code-integration.md)
- [OpenCode Integration](../opencode-integration.md)
- [Security Hardening](../../operations/security-hardening.md)
