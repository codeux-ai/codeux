# Docker Runtime

Code UX defaults to a managed, auto-updating Linux runtime instead of building an agent image on each user's machine.

> Settings area: `docker-runtime`
> Dashboard documentation route: `/docs/settings-docker-runtime`

## Managed Mode

Managed mode pulls the public `ghcr.io/codeux-ai/codeux-runtime` image family:

- `base` includes Node 24 on Debian Trixie, JavaScript package managers, Python, Git/GitHub CLI, compilers, keyring support, preview utilities, and common Linux tools.
- `browser` adds pinned Playwright, Playwright MCP, and browser OS dependencies, but no browser payload.

Code UX checks for runtime updates in the background when the persisted update watermark is older than six hours. It resolves the immutable repository digest, verifies Node 24 in the image, and routes only future containers to the verified digest. Restarts inside the freshness window reuse the cached digest without another pull. Running containers are not interrupted. Registry or verification failure retains the previous working digest and does not block the dashboard.

Provider CLIs are not baked into either image. Activated providers are downloaded from fixed official sources into versioned Docker volumes and mounted read-only. Automatic stable-update discovery uses the same six-hour freshness window; manual preparation still checks immediately.

The browser payload follows the same pattern. When enabled, Code UX downloads the browser matched to the pinned Playwright version directly into a user-local versioned volume, verifies it offline, and mounts it read-only. Code UX does not redistribute the browser through GHCR.

For explicit setup extensions, each Docker runner keeps verified content-addressed setup images hot in process. Warm invocations reuse the verified image without another Docker image inspection or build-context rewrite. If Docker reports that the derived image was removed, Code UX invalidates that readiness entry, rebuilds or resolves the setup image, and retries the launch. Concurrent processes poll setup-image build locks with a short adaptive delay. If restart cleanup removes the lock parent during acquisition, the resolver recreates the parent and retries the same acquisition instead of failing the provider launch. A stale provider-container name is reclaimed before an immediate retry.

Managed workspace and runtime volumes carry the original logical workspace-session label even when their Docker names use a shortened content hash. Startup cleanup compares that durable label with tracked provider sessions and active planning recovery work before removing old volumes; legacy unshortened volume names remain supported as a fallback. This prevents restart cleanup from deleting the preserved snapshot needed by an interrupted provider continuation.

Within one runtime process, independent workspace-manager instances share a runtime-volume readiness and ownership registry. Concurrent preparation and provider launch therefore coalesce volume creation and ownership repair instead of starting duplicate `chown` helpers. Local stress runners wait for terminal owner-scoped workspace cleanup and remove only volumes belonging to their isolated state home before exit, preventing repeated DAG runs from slowing later Docker operations.

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

Packaged installs seed the lightweight baseline setup script into `~/.code-ux/container/setup.sh` when needed. Concurrent seed requests share one operation, and the verified result is reused for five minutes rather than rescanning the same bundled files on every agent lookup. Code UX migrates the recognized legacy provider-install bootstrap once, while an already-current baseline or a user-authored setup script remains untouched.

## Provider Preparation

Selecting a provider during onboarding starts preparation immediately, before Login. Login and invocations join the same preparation job, so a ready provider performs no download.

Managed npm installs keep lifecycle scripts blocked by default. Code UX explicitly allows them only for the fixed `@anthropic-ai/claude-code` and `opencode-ai` provider packages, whose postinstall steps are required to materialize their runtime executable. The package installed into the volume is still pinned to the stable version returned by npm. Preparation failures identify that package and version, remove the incomplete volume, and remain retryable.

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
