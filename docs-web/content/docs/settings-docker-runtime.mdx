# Docker Runtime

Code UX defaults to a managed, auto-updating Linux runtime instead of building an agent image on each user's machine.

> Settings area: `docker-runtime`
> Dashboard documentation route: `/docs/settings-docker-runtime`

## Managed Mode

Managed mode pulls the public `ghcr.io/codeux-ai/codeux-runtime` image family:

- `base` includes Node 24 on Debian Trixie, JavaScript package managers, Python, Git/GitHub CLI, compilers, keyring support, preview utilities, and common Linux tools.
- `browser` adds pinned Playwright, Playwright MCP, and browser OS dependencies, but no browser payload.

Code UX checks for runtime updates on every startup. It pulls the stable channel in the background, resolves the immutable repository digest, verifies Node 24 in the image, and routes only future containers to the verified digest. Running containers are not interrupted. Registry or verification failure retains the previous working digest and does not block the dashboard.

Provider CLIs are not baked into either image. Activated providers are downloaded from fixed official sources into versioned Docker volumes and mounted read-only. Code UX checks every activated provider for a stable update on every startup.

The browser payload follows the same pattern. When enabled, Code UX downloads the browser matched to the pinned Playwright version directly into a user-local versioned volume, verifies it offline, and mounts it read-only. Code UX does not redistribute the browser through GHCR.

## Controls

| Control | Behavior |
| --- | --- |
| Runtime image mode | `Managed` follows the Code UX runtime channel; `Custom` uses the image field below. |
| Custom container image | Used only in Custom mode. Existing non-default legacy images remain custom during migration. |
| Container setup script | Optional project-specific extension. An empty value performs no build in Managed mode. |
| Cache custom setup extension | Builds a content-addressed extension image only for an explicit setup script. |
| Memory limit | Applies a hard Docker memory and memory-swap ceiling; `0` disables the cap. |
| Preload Playwright browser | Selects the managed browser-dependency image and preloads its matched browser into a reusable local volume. Disable it to use the smaller base image. |
| Run as root | Privileged compatibility escape hatch; leave disabled unless a trusted project requires it. |

The default managed path never runs `docker build`. Login, coding, QA, previews, and custom dashboard validation share the same resolver instead of building separate base images.

## Provider Preparation

Selecting a provider during onboarding starts preparation immediately, before Login. Login and invocations join the same preparation job, so a ready provider performs no download.

Runtime, browser, and tool states are available from `GET /api/runtime-assets/status`. Retry browser or provider preparation with:

```http
POST /api/provider-tools/codex/prepare
POST /api/playwright-browser/prepare
```

If an update fails, Code UX keeps the previous verified provider volume. If no verified compatible version exists, only that provider's Login or invocation is blocked with a retryable error.

Provider credentials are never written into tool volumes. Provider-owned self-updaters are disabled inside invocations so mounted binaries remain immutable.

## Custom Images

Custom mode preserves operator-controlled images and explicit setup scripts. Provider tools receive a compatibility key derived from the custom image, so a volume prepared for the managed Debian runtime is not silently reused in an incompatible image.

Custom images must supply Node, Bash, and the installer dependencies required by the selected CLI. Setup-extension builds remain available, but provider installation no longer falls back into each workspace.

## Cleanup And Recovery

Runtime state is stored under `~/.code-ux/runtime/`. Code UX retains the current and previous managed digests plus active browser/provider volume pointers. Unreferenced volumes older than 30 days are pruned while recent rollback candidates are preserved.

For failures:

1. Confirm Docker is ready in onboarding or the top navigation status.
2. Inspect `GET /api/runtime-assets/status`.
3. Retry the affected provider preparation.
4. Verify GHCR and npm/vendor release endpoints are reachable.
5. Switch to Custom mode only when a repository needs a genuinely different base image.

## Related Documentation

- [Managed Container Runtime](/docs/architecture-managed-container-runtime)
- [Providers and models](/docs/user-providers-and-models)
- [Dashboard Settings](/docs/user-dashboard-settings)
- [Troubleshooting](/docs/user-troubleshooting)
