# Managed Container Runtime

Code UX uses a shared, auto-updating Linux runtime for Docker-backed provider invocations, interactive login, sprint previews, and custom dashboard validation. The default path does not run a local Docker build and does not redistribute provider CLIs.

## Runtime Image Family

The runtime is published from `containers/runtime/Dockerfile` to `ghcr.io/codeux-ai/codeux-runtime` for `linux/amd64` and `linux/arm64`.

- `1-base` is based on the current multi-architecture `node:24-trixie-slim` manifest pinned by digest and includes the shared development toolchain: JavaScript package managers, Python, Git/GitHub CLI, compilers, keyring support, preview utilities, and common Unix diagnostics. Runtime tool versions are explicit (`npm` 12.0.1, pnpm 11.13.1, Yarn 1.22.22, Bun 1.3.14, and `serve` 14.2.6) so rebuilding a channel does not silently select a different package-manager binary.
- `1-browser` extends the base target with pinned open-source Playwright, Playwright MCP, and Linux browser dependencies. It intentionally contains no browser binary.

The publish workflow builds both targets, smoke-tests their tool inventory, emits SBOM and provenance attestations, and signs each published digest with Sigstore. Channel tags are discovery pointers only. `ManagedRuntimeService` pulls the channel, resolves the local `RepoDigest`, verifies Node 24 in a network-isolated smoke container, and stores only immutable digests as the active runtime.

At application startup, managed-mode installations check both image targets for updates in the background when the persisted update watermark is older than six hours. A restart inside that freshness window reuses the immutable digests without issuing registry pulls. Running containers are not replaced. A new digest becomes active only after pull and verification; the previous digest is retained for rollback. Registry or Docker failures leave the last verified digest active and are exposed through runtime status instead of blocking dashboard readiness.

State is stored atomically under `~/.code-ux/runtime/managed-runtime.json`. Set `CODE_UX_MANAGED_RUNTIME_REPOSITORY`, `CODE_UX_MANAGED_RUNTIME_CHANNEL`, `CODE_UX_MANAGED_BASE_IMAGE`, or `CODE_UX_MANAGED_BROWSER_IMAGE` only for controlled development or registry mirrors.

## Playwright Browser Volume

When browser support is enabled, `PlaywrightBrowserManager` reads the pinned Playwright version from the verified browser image and downloads that version's browser artifacts directly on the user's Docker host. The download is written to a versioned `code-ux-playwright-browser-*` volume; Code UX then launches the browser with networking disabled to verify the completed volume and writes an atomic completion marker.

Provider containers mount the verified volume at `/ms-playwright` read-only. The complete browser supports headed and headless Playwright launches; Code UX does not force either launch mode. In-process singleflight and cross-process locks prevent duplicate downloads. Startup and settings saves preload the volume when `containerInstallPlaywrightBrowsers` is enabled, so provider invocations normally only attach an existing volume. A new runtime Playwright version receives a new volume, while cleanup retains the active volume and two recent rollback candidates before pruning unreferenced versions after 30 days.

The GHCR image does not redistribute Chrome, Chromium, Widevine, or other browser payloads. Its workflow smoke gate requires `/ms-playwright` to be empty and rejects `libwidevinecdm.so`. Browser artifacts therefore travel from Playwright's configured download service to the user who enabled browser support, rather than through the Code UX registry.

## Provider Tool Volumes

Provider binaries are installed on the user's Docker host rather than baked into the runtime image. `ProviderToolManager` owns the supported source catalog; API callers cannot provide package names, versions, URLs, or shell commands.

| Provider | Stable source | Executable |
| --- | --- | --- |
| Gemini | `@google/gemini-cli` from npm | `gemini` |
| Codex | `@openai/codex` from npm | `codex` |
| Claude Code | `@anthropic-ai/claude-code` from npm | `claude` |
| Qwen Code | `@qwen-code/qwen-code` from npm | `qwen` |
| OpenCode | `opencode-ai` from npm | `opencode` |
| Antigravity | Official platform manifest and installer | `agy` |

Jules is hosted and Mockup CLI is internal, so neither creates a provider-tool volume.

Code UX resolves the stable version of each activated provider in the background when its persisted provider-asset state is older than six hours. Restarts inside that window verify and mount the cached immutable volume without another release-registry request. Checks run with bounded concurrency and never delay readiness. Onboarding selection, settings saves, Login, and provider invocation all call the same singleflight preparation path. Easy onboarding begins preparation when its radio selection changes, before the user presses Login.

Preparation results are shared process-wide. After a managed image digest, provider-tool volume, or
browser volume has passed its first verification, warm invocations reuse that immutable identity
without launching another inspection or provider `--version` container. Provider bootstrap still
checks the cheap completion/ownership markers inside the invocation container. If Docker assets were
removed or recreated externally, the first affected launch invalidates only that asset's cache,
repairs it through the normal singleflight preparation path, and retries once. Managed launches use
`--pull never`, so a missing local digest cannot silently turn one invocation into an image pull.
An already-verified provider volume remains immediately usable while its background stable-channel
update check runs; invocations do not queue behind registry metadata or staging of a future version.

Installation happens in a dedicated container with a writable versioned volume. npm metadata supplies version and integrity information; Antigravity's official manifest supplies the platform version and SHA-512 checksum, and its installer verifies the downloaded artifact. Code UX then runs the binary's version command and writes `.codeux-provider-tool.json`. Failed or incomplete volumes are removed before retry.

Current npm releases block unreviewed lifecycle scripts during global installs. The fixed provider catalog grants `--allow-scripts` only to `@anthropic-ai/claude-code` and `opencode-ai`, whose trusted postinstall steps materialize their platform executable. The approval uses the unversioned package identity required by npm while the installed package target remains pinned to the stable version resolved from registry metadata. Gemini, Codex, and Qwen Code receive no lifecycle-script exception. These installs run inside the selected Linux runtime image, so package scripts resolve the container's `linux/amd64` or `linux/arm64` artifact independently of the host desktop platform.

Completed volumes are keyed by provider, stable version/artifact integrity, architecture-compatible runtime ABI, and custom-image identity where applicable. Provider containers mount the completed volume at `/opt/code-ux/provider-tool` read-only and prepend its `bin` directory to `PATH`. Credentials remain in their existing isolated credential/runtime mounts.

Provider-owned auto-updaters are disabled during invocation with `DISABLE_AUTOUPDATER`, `OPENCODE_DISABLE_AUTOUPDATE`, and `AGY_CLI_DISABLE_AUTO_UPDATE`. Code UX stages updates separately, verifies them, and switches only future containers. Existing invocations and the previous verified volume remain unchanged. In-process singleflight and filesystem locks under `~/.code-ux/runtime/provider-tool-locks/` prevent duplicate downloads across requests and Code UX processes.

The active provider-volume index lives at `~/.code-ux/runtime/provider-tools.json`. Startup cleanup preserves indexed volumes and the newest two versions per provider, then removes unreferenced versions older than 30 days.

## Settings And Compatibility

`cliWorkflow.containerImageMode` selects the runtime path:

- `managed` is the default. `containerImage` is ignored, the managed base/browser image is selected by role, and an empty setup-script setting performs no derived image build.
- `custom` uses `containerImage`. Explicit setup scripts may still be cached as content-addressed extension images, and provider volumes receive a custom-image compatibility key.

Settings without `containerImageMode` are migrated during sanitization. An untouched `node:24-bookworm` value becomes managed mode. Other legacy image values remain custom, so existing operator images are never silently replaced.

Managed provider invocations use the browser target plus the verified browser volume when `containerInstallPlaywrightBrowsers` is enabled and the base target otherwise. Previews and custom dashboard validation use the base target. Custom images retain their explicit setup-extension behavior. The bundled `.code-ux/container/setup.sh` is intentionally a no-op notice; project-specific bootstrap requires an explicitly configured script.

## Status And Failure Semantics

`GET /api/runtime-assets/status` returns managed-runtime, Playwright-browser, and provider-tool state. `POST /api/playwright-browser/prepare` and `POST /api/provider-tools/:provider/prepare` idempotently begin or join preparation.

Provider states are `not_installed`, `waiting_for_docker`, `checking_update`, `queued`, `downloading`, `installing`, `verifying`, `ready`, and `failed`. Responses contain bounded progress text and versions, never raw installer URLs, credentials, or arbitrary output.

When update discovery fails and a verified compatible volume exists, the old volume remains usable and status reports the update error. Without any verified compatible provider or browser volume, only the invocation needing that asset fails with a retryable preparation error. There is no per-workspace fallback installation in managed mode.

## Gemini Deprecation

Gemini CLI remains executable and receives the same startup update checks while it is activated. The dashboard marks it Deprecated, excludes it from new Easy recommendations, and offers Antigravity as the supported replacement. Existing Gemini defaults are preserved and no credentials or routing configuration are migrated automatically.
