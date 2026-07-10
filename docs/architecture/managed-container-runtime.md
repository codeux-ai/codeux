# Managed Container Runtime

Code UX uses a shared, auto-updating Linux runtime for Docker-backed provider invocations, interactive login, sprint previews, and custom dashboard validation. The default path does not run a local Docker build and does not redistribute provider CLIs.

## Runtime Image Family

The runtime is published from `containers/runtime/Dockerfile` to `ghcr.io/codeux-ai/codeux-runtime` for `linux/amd64` and `linux/arm64`.

- `1-base` is based on `node:24-trixie-slim` and includes the shared development toolchain: JavaScript package managers, Python, Git/GitHub CLI, compilers, keyring support, preview utilities, and common Unix diagnostics.
- `1-browser` extends the base target with pinned Playwright, Playwright MCP, Chromium, and browser dependencies.

The publish workflow builds both targets, smoke-tests their tool inventory, emits SBOM and provenance attestations, and signs each published digest with Sigstore. Channel tags are discovery pointers only. `ManagedRuntimeService` pulls the channel, resolves the local `RepoDigest`, verifies Node 24 in a network-isolated smoke container, and stores only immutable digests as the active runtime.

At application startup, managed-mode installations check both image targets for updates in the background. Running containers are not replaced. A new digest becomes active only after pull and verification; the previous digest is retained for rollback. Registry or Docker failures leave the last verified digest active and are exposed through runtime status instead of blocking dashboard readiness.

State is stored atomically under `~/.code-ux/runtime/managed-runtime.json`. Set `CODE_UX_MANAGED_RUNTIME_REPOSITORY`, `CODE_UX_MANAGED_RUNTIME_CHANNEL`, `CODE_UX_MANAGED_BASE_IMAGE`, or `CODE_UX_MANAGED_BROWSER_IMAGE` only for controlled development or registry mirrors.

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

Every Code UX startup resolves the stable version of each activated provider. Checks run with bounded concurrency and never delay readiness. Onboarding selection, settings saves, Login, and provider invocation all call the same singleflight preparation path. Easy onboarding begins preparation when its radio selection changes, before the user presses Login.

Installation happens in a dedicated container with a writable versioned volume. npm metadata supplies version and integrity information; Antigravity's official manifest supplies the platform version and SHA-512 checksum, and its installer verifies the downloaded artifact. Code UX then runs the binary's version command and writes `.codeux-provider-tool.json`. Failed or incomplete volumes are removed before retry.

Completed volumes are keyed by provider, stable version/artifact integrity, architecture-compatible runtime ABI, and custom-image identity where applicable. Provider containers mount the completed volume at `/opt/code-ux/provider-tool` read-only and prepend its `bin` directory to `PATH`. Credentials remain in their existing isolated credential/runtime mounts.

Provider-owned auto-updaters are disabled during invocation with `DISABLE_AUTOUPDATER`, `OPENCODE_DISABLE_AUTOUPDATE`, and `AGY_CLI_DISABLE_AUTO_UPDATE`. Code UX stages updates separately, verifies them, and switches only future containers. Existing invocations and the previous verified volume remain unchanged. In-process singleflight and filesystem locks under `~/.code-ux/runtime/provider-tool-locks/` prevent duplicate downloads across requests and Code UX processes.

The active provider-volume index lives at `~/.code-ux/runtime/provider-tools.json`. Startup cleanup preserves indexed volumes and the newest two versions per provider, then removes unreferenced versions older than 30 days.

## Settings And Compatibility

`cliWorkflow.containerImageMode` selects the runtime path:

- `managed` is the default. `containerImage` is ignored, the managed base/browser image is selected by role, and an empty setup-script setting performs no derived image build.
- `custom` uses `containerImage`. Explicit setup scripts may still be cached as content-addressed extension images, and provider volumes receive a custom-image compatibility key.

Settings without `containerImageMode` are migrated during sanitization. An untouched `node:24-bookworm` value becomes managed mode. Other legacy image values remain custom, so existing operator images are never silently replaced.

Managed provider invocations use the browser target when `containerInstallPlaywrightBrowsers` is enabled and the base target otherwise. Previews and custom dashboard validation use the base target. The bundled `.code-ux/container/setup.sh` is intentionally a no-op notice; project-specific bootstrap requires an explicitly configured script.

## Status And Failure Semantics

`GET /api/runtime-assets/status` returns managed-runtime status plus every provider tool state. `POST /api/provider-tools/:provider/prepare` idempotently begins or joins preparation for a supported local CLI provider.

Provider states are `not_installed`, `waiting_for_docker`, `checking_update`, `queued`, `downloading`, `installing`, `verifying`, `ready`, and `failed`. Responses contain bounded progress text and versions, never raw installer URLs, credentials, or arbitrary output.

When update discovery fails and a verified volume exists, the old volume remains usable and status reports the update error. Without any verified compatible volume, only that provider's Login or invocation fails with a retryable preparation error. There is no per-workspace fallback installation.

## Gemini Deprecation

Gemini CLI remains executable and receives the same startup update checks while it is activated. The dashboard marks it Deprecated, excludes it from new Easy recommendations, and offers Antigravity as the supported replacement. Existing Gemini defaults are preserved and no credentials or routing configuration are migrated automatically.

