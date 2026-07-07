# Docker Runtime

Defines the default container environment used by Docker-backed provider CLIs.

## What It Controls

Image, setup script, memory limit, setup image caching, and Playwright browser preinstall shape each worker container.

## Recommended Defaults

Keep the default image unless your repo needs a custom toolchain; enable Playwright preinstall for browser-heavy QA.

## Risks And Gotchas

Broken setup scripts or overly tight memory limits can fail every provider invocation in the scope.

## Dashboard Link

Open this subcategory from the dashboard docs route at `/docs/user/dashboard/settings#docker-runtime`. The Settings card header links to the matching published docs anchor.

## Related Docs

- [Configuration and Storage](../configuration-and-storage.md)
- [Security Hardening](../../operations/security-hardening.md)
