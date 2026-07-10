# Managed Container Runtime

The managed container runtime removes first-invocation Docker builds while keeping provider binaries local to each user's Docker host.

## Runtime Flow

At startup Code UX pulls the stable `base` and `browser` channel tags from GHCR, resolves immutable repository digests, smoke-tests Node 24, and activates verified digests for future containers. Pulls run in the background and fail open to the last verified digest.

The `base` image is a multi-architecture `node:24-trixie-slim` development environment. The `browser` image adds pinned Playwright, Playwright MCP, and Linux browser dependencies, but contains no browser binary. CI rejects embedded browser/Widevine artifacts, smoke-tests both targets, publishes SBOM/provenance attestations, and signs their digests.

When browser support is enabled, Code UX downloads the Playwright-matched browser directly on the user's Docker host into a versioned volume, verifies it offline, and mounts it read-only at `/ms-playwright`. The complete browser supports headed and headless launches; Code UX does not force either mode. Startup and settings saves preload this volume. Provider invocations use `browser` plus the volume; Login, previews, and custom dashboard validation use the appropriate base resolver. The default path contains no local `docker build`.

## Provider Tool Flow

Provider tools and the Playwright browser have separate volume lifecycles:

1. Startup derives activated provider families from saved settings.
2. Each adapter checks its official stable channel.
3. A missing/new version is installed into a versioned staging volume.
4. Code UX verifies the executable and writes a completion marker.
5. Future containers mount the completed volume read-only at `/opt/code-ux/provider-tool`.

Onboarding selection, settings saves, Login, and invocation all join this singleflight path. Filesystem locks prevent separate Code UX processes from installing the same provider concurrently.

Stable sources are fixed in backend code: npm for Gemini, Codex, Claude Code, Qwen Code, and OpenCode; Antigravity uses its official platform manifest and checksum-verifying installer. Jules and Mockup CLI need no volume.

Credentials stay in isolated credential/runtime mounts. Provider-native auto-updaters are disabled during execution; Code UX stages updates and switches future containers only after verification.

## Failure And Rollback

Runtime and provider update checks occur on every startup without blocking readiness. Existing verified artifacts remain active during update work. A failed update reports status but does not break a working provider. When no compatible verified provider exists, only that provider's Login/invocation fails.

Runtime, browser, and provider pointers live under `~/.code-ux/runtime/`. Cleanup preserves active assets and recent rollback versions.

## Gemini Lifecycle

Gemini CLI is deprecated in the dashboard but remains selectable and executable for compatibility. It is excluded from new recommendations, still receives automatic updates while activated, and links users toward Antigravity without changing existing credentials or routes.
