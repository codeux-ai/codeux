# Docker Runtime

Defines the default container environment used by Docker-backed provider CLIs.

## What It Controls

Image, setup script, memory limit, setup image caching, root execution posture, and Playwright browser preinstall shape each worker container.

## Recommended Defaults

Keep the default image unless your repo needs a custom toolchain; keep `cliWorkflow.containerRunAsRoot` off unless a trusted tool requires package-manager or OS-level writes; enable Playwright preinstall for browser-heavy QA.

`cliWorkflow.containerRunAsRoot` defaults to `false` and inherits through scoped settings. Agent presets can override local Docker-backed CLI task runs with nullable `containerRunAsRoot`: Inherit (`null`), Force non-root (`false`), and Force root (`true`). Root mode is privileged and is not a safety boundary for untrusted code.

When setup-image caching is enabled, Playwright preinstall is baked into the derived setup image at `/ms-playwright` with readable permissions for non-root runtime users. Cache hits reuse that browser path and skip the setup script, avoiding repeated Chromium downloads on every provider launch. Cache-disabled workflows and custom setup scripts must honor `CODE_UX_INSTALL_PLAYWRIGHT=1` and install Chromium when browser automation is required.

## Risks And Gotchas

Broken setup scripts, overly tight memory limits, or root-mode changes can fail every provider invocation in the scope.

## Dashboard Link

Open this subcategory from the dashboard docs route at `/docs/user-dashboard-settings#docker-runtime`. The Settings card header links to the matching published docs anchor.

## Related Docs

- [Configuration and Storage](../configuration-and-storage.md)
- [Security Hardening](../../operations/security-hardening.md)
