# Docker Runtime

Defines the default container environment used by Docker-backed provider CLIs.

## What It Controls

Image, setup script, memory limit, setup image caching, and Playwright browser preinstall shape each worker container.

## Recommended Defaults

Keep the default image unless your repo needs a custom toolchain; enable Playwright preinstall for browser-heavy QA.

When setup-image caching is enabled, Playwright preinstall is baked into the derived setup image at `/ms-playwright` with readable permissions for non-root runtime users. Cache hits reuse that browser path and skip the setup script, avoiding repeated Chromium downloads on every provider launch.

## Risks And Gotchas

Broken setup scripts or overly tight memory limits can fail every provider invocation in the scope.

## Dashboard Link

Open this subcategory from the dashboard docs route at `/docs/user/dashboard/settings#docker-runtime`. The Settings card header links to the matching published docs anchor.

## Related Docs

- [Configuration and Storage](../configuration-and-storage.md)
- [Security Hardening](../../operations/security-hardening.md)
