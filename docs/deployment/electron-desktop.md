# Electron Desktop App

Code UX can run as an installable Electron desktop app while preserving the existing MCP server and dashboard architecture.

## Runtime Model

- Electron boots the compiled backend in the main process from `dist/electron/main.js`.
- The backend still serves the dashboard over loopback HTTP.
- The desktop window loads the resolved dashboard URL, usually `http://127.0.0.1:4444`.
- If the requested dashboard port is busy, the backend keeps the existing retry behavior and the Electron window opens the actual runtime port.
- The Electron shell (`src/electron/main.ts` and `src/electron/dashboard-network-policy.ts`) defines desktop boundaries, native window management, and network policies for the UI. It does not own backend orchestration; it solely hosts the Code UX UI and connects to the existing container-first backend.
- MCP stdio is disabled in the Electron runtime with `CODE_UX_DISABLE_MCP_STDIO=1` so the GUI process does not attach to desktop process stdio.
- Mutable dashboard runtime traffic (`/api/*`, `/health`, and `/ready`) is treated as non-cacheable in both the backend response headers and the Electron session. The desktop app clears the Electron HTTP cache on startup, injects no-cache request headers only for runtime `GET`/`HEAD` reads, and injects no-store response headers for all loopback runtime data so stale Chromium cache entries cannot make settings, project, agent, or runtime pages appear frozen after navigation without interfering with JSON upload bodies.
- Windows packaged builds keep the active WebGL context cap at 16 so the persistent shell canvas, avatar canvases, and route-scoped chart canvases have enough headroom during long navigation sessions while old Chromium contexts are waiting for garbage collection.
- External links are opened through the host operating system. In-app dashboard and sprint-preview URLs remain inside the Electron app.
- The desktop shell renders only the resolved dashboard origin and same-port sprint preview origins that match `preview-<session>.localhost:<dashboardPort>` internally. Other `http`, `https`, and `mailto` navigations are denied in the renderer and opened through the host operating system after scheme validation; all other schemes are blocked.

## Desktop System Bar

The desktop dashboard uses a frameless renderer-owned system bar instead of native window chrome. It renders only when the preload bridge exposes `window.codeUxDesktop.window`, and it keeps the Code UX logo, the update action, and a visible `v{version}` label compiled from `package.json` through Vite's `__APP_VERSION__` define.

The update button is a no-drag control that calls the fixed `window.codeUxDesktop.openUpdates()` preload IPC method. That method opens `https://github.com/codeux-ai/codeux/releases/latest` in the host browser and deliberately does not expose a generic URL opener or perform an automatic in-app update.

Double-clicking non-interactive system-bar chrome toggles maximize/restore through `window.codeUxDesktop.window.toggleMaximize()`. Interactive controls stop double-click propagation and stay inside `titlebar-no-drag` regions so buttons do not accidentally trigger window dragging or maximize behavior.

## Native Desktop Integration

The Add Project dialog uses a native Electron directory picker when running in the desktop app. Browser-only dashboard sessions keep the existing HTTP directory browser fallback. When no current path is typed, the native picker opens at the user's home directory; relative defaults are resolved from the user's home directory before opening the dialog.

The native picker and desktop-only commands are exposed through the isolated preload bridge:

- `window.codeUxDesktop.pickDirectory(defaultPath?)`
- returns `{ canceled, filePath }`
- `window.codeUxDesktop.openUpdates()`
- returns `true` when Electron accepted the request to open the official latest releases page, otherwise `false`

Renderer Node access remains disabled. The preload exposes only this narrow IPC surface.

Renderer privileges are constrained with `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`. The preload bridge keeps the supported desktop API limited to directory selection, zoom control, and window controls. IPC handlers validate renderer input before using it: directory picker defaults must be strings without control characters, and zoom factors must be finite numbers before being clamped to the supported range.

Because the renderer remains sandboxed, the preload source is `src/electron/preload.cts` and compiles to `dist/electron/preload.cjs`. Keep the preload CommonJS-emitted and load Electron APIs through `require("electron")`; sandboxed Electron preloads do not run as ESM, and an ESM preload prevents `window.codeUxDesktop.window` from initializing, which hides the renderer-owned system bar.

Electron permission prompts are denied by default for dashboard and preview pages except for microphone capture from the trusted dashboard origin. The desktop session grants `microphone` permission, or Electron `media` permission when the request or permission check is explicitly audio-only, only for the resolved dashboard origin such as `http://127.0.0.1:<runtimePort>` and its `localhost` loopback alias. Sprint preview origins, unrelated origins, camera/video capture, geolocation, notifications, and arbitrary Electron permissions remain denied. Preview origins require a separate documented product need and targeted tests before any permission exception is added.

The desktop BrowserWindow is frameless and transparent on every supported platform so the renderer-level `.app-shell` clip can expose real rounded window corners. The shell uses a fixed corner radius and subtle gray border in normal windowed mode, then removes that treatment when Electron reports maximized or fullscreen state, matching the host operating system's square maximized-window behavior. Keep the native BrowserWindow `backgroundColor` transparent when changing package settings; an opaque native background will make the corners appear square even if the renderer content is clipped.

## Installer Experience

Windows release builds use an assisted NSIS installer instead of a one-click installer. The installer:

- Shows the MIT open source license from `build/installer-license.txt` and requires acceptance before installation continues.
- Allows the user to choose the installation directory.
- Shows a dedicated beta notice page after directory selection with the copy: "Code UX is still in beta. Things may not work as expected, and some behavior can change between releases."
- Uses generated Code UX Windows icon and NSIS wizard bitmap assets from `build/icon.ico`, `build/installerHeader.bmp`, and `build/installerSidebar.bmp`.

The beta notice is intentionally installer UI copy only. It is not added to the license text and does not require a separate acknowledgement checkbox.

macOS DMG builds include the MIT license resource through `build/license_en.txt` where supported by Electron Builder. Linux package formats currently include the packaged `LICENSE.txt` resource but do not provide an equivalent required license checkbox flow.

## Build Commands

- `pnpm run electron:dev`: build and launch the desktop app from the local workspace.
- `pnpm run electron:pack`: build an unpacked app directory for the current platform.
- `pnpm run electron:dist`: build installers/packages for the current platform.
- `pnpm run electron:dist:linux`: build Linux targets.
- `pnpm run electron:dist:mac`: build macOS targets.
- `pnpm run electron:dist:win`: build Windows targets.
- `pnpm run electron:benchmark:runtime`: launch Electron with an isolated temporary user profile, navigate dashboard routes, probe backend endpoints, and write route/API/renderer/runtime metrics under `.cache/electron-runtime-benchmark/`.
- `pnpm run electron:benchmark:win`: build Windows installers with `normal` and `store` compression and write timing/size data to `release/electron-benchmark/summary.json`.
- `pnpm run electron:install-deps`: rebuild native app dependencies for Electron.

The release output is written to `release/electron/`.

Electron package builds run `pnpm run electron:prepare-deps` before Electron Builder. That script creates a production-only, hoisted runtime dependency tree in `.cache/electron-runtime/node_modules`, prunes non-runtime package files, generates deterministic PNG/ICO/BMP desktop artwork, and Electron Builder copies it to `resources/node_modules` so ASAR-packaged builds can resolve pnpm transitive dependencies at runtime.

Electron Builder must include the `docs-web/**` runtime catalog in the app contents because the dashboard Docs page reads its collection and markdown through `/api/docs-web`. Installed desktop builds, npm-installed CLI/server runs, and source checkouts all rely on the same directory living beside the compiled runtime root, where `DocsWebCatalogService` resolves it. Keep `docs-web` in both the Electron Builder `files` list and the npm package `files` list whenever packaging metadata changes.

The desktop package must also include `assets/models-dev/catalog.json`. Model pricing resolves this snapshot relative to the compiled runtime, and omitting it makes otherwise known models appear unpriced in Electron even though the npm package calculates their costs correctly. The packaged-default regression test checks both runtime assets and verifies the GPT-5.5 catalogue rate as a representative automatic-pricing entry.

CI runs `tests/e2e/navigation/docs-page.spec.ts` as a dedicated Linux Docs smoke gate on every `dev` and `main` push or pull request. The gate loads exactly five routes—the Docs index, its overview route, and three representative user/developer/architecture pages—and fails on HTTP errors, browser console errors, page errors, missing landmarks, or missing compiled markdown. Full cross-platform Playwright matrices remain limited to main validation and manual dispatches.

Electron Builder also copies the bundled `.code-ux` runtime defaults to `resources/.code-ux-defaults`. Keep that resource filter aligned with the default asset seeding contract in `src/services/code-ux-default-assets-service.ts`; the packaged app depends on `planning_agent.md`, `project_manager.md`, `quality_assurance_agent.md`, `worker.md`, `container/setup.sh`, and `.code-ux/quicksprints/templates/*.md` being present because it cannot fall back to the workspace `.code-ux` directory after installation. Built-in agent preset sync reads those bundled defaults directly, so Project Setup Agent prompts can still use the base agent templates even if a user removes the seeded copies under `~/.code-ux/agents`.

Speech transcription uses the same packaged backend route as the npm-served dashboard: `POST /api/speech/transcriptions`. Local transcription loads `onnxruntime-node` from `resources/node_modules`, so Electron Builder must keep `node_modules/**/*.node` and `node_modules/onnxruntime-node/**` unpacked from ASAR. The runtime dependency prep script prunes `onnxruntime-node` native binaries to the target platform and architecture unless `CODE_UX_ELECTRON_KEEP_ALL_NATIVE_BINARIES=1` is set for diagnostics.

Local speech models are user-cache data, not application bundle data. The service resolves them under `~/.code-ux/models/speech/<sanitized-model-id>/`, where the default `onnx-community/whisper-base.en` becomes `onnx-community--whisper-base.en` and must contain `model.onnx` plus optional `labels.json`. Missing model files produce a structured `missing_local_model` or setup `client_error`; the desktop package should not bundle model weights by default because they are large and user-replaceable. In `auto` mode, an explicitly configured OpenAI-compatible external transcription endpoint can handle fallback requests when the local model is absent or fails. External fallback requires base URL, API key, and model settings; local ONNX transcription does not require external credentials.

The runtime dependency tree is fingerprinted from production dependencies and the lockfile. If the fingerprint matches a previous run, `electron:prepare-deps` reuses the existing tree instead of deleting and reinstalling it.

Dashboard-only libraries belong in `devDependencies` because Vite bundles them into `dashboard/dist/`; keeping them out of production dependencies prevents Electron packages from copying unused source packages into `resources/node_modules`.

Native runtime binaries are pruned during `electron:prepare-deps` to the current native build platform and architecture. Native release runners are expected for production artifacts. Set `CODE_UX_ELECTRON_KEEP_ALL_NATIVE_BINARIES=1` only for diagnostic cross-packaging where all bundled native binaries must be preserved.

Electron runtime locales are limited to `en-US` because the desktop UI is currently English-only. Add languages to `electronLanguages` in `electron-builder.config.cjs` when localized UI support is shipped.

Windows installer compression defaults to `normal`. Set `CODE_UX_ELECTRON_COMPRESSION=store` to prioritize faster package creation and extraction during benchmarking, or run `pnpm run electron:benchmark:win` to compare both modes before changing the default.

Use the runtime benchmark when investigating long-session desktop responsiveness:

- Development Electron: `pnpm run electron:benchmark:runtime -- --routes "/agents,/config,/tasks,/sprints,/agents" --cycles 20 --seed-home-code-ux`
- Packaged Windows build: `pnpm run electron:benchmark:runtime -- --executable "release/electron/win-unpacked/Code UX.exe" --routes "/agents,/config,/tasks,/sprints,/agents" --cycles 10 --seed-home-code-ux`

`--seed-home-code-ux` copies only the database files from the user's home `.code-ux` directory into the isolated benchmark profile. This allows large local datasets to be reproduced without mutating the live profile. On June 4, 2026 a copied live dataset with a 476 MB `app.db`, 33 sprints, 32,873 task runs, and 51,971 task run events completed the focused `/agents,/config,/tasks,/sprints,/agents` benchmark with zero failed or slow API samples. After moving dashboard agent preset listing to a non-blocking read path, the copied-live-database dev run reported backend probe p95 3.5 ms and max `/agent-presets` probe 5.42 ms; the packaged Windows run reported backend probe p95 3.5 ms and max `/agent-presets` probe 4.24 ms.

Linux `electron:pack` benchmark on WSL/Linux after the first installer optimization pass was 17.61s with a warm runtime dependency cache and produced a 595 MB unpacked app. After pruning non-target `onnxruntime-node` native binaries and unused Electron locales, the same local benchmark completed in 15.38s and produced a 373 MB unpacked app.

## GitHub Release Builds

Published desktop artifacts are built by `.github/workflows/release.yml` when a GitHub Release is published. `.github/workflows/desktop-release.yml` is the separate manual `Desktop Release Diagnostics` workflow; it accepts an optional tag/ref and uploads artifact-only rebuilds without modifying a release.

The workflow builds on native runners:

- `ubuntu-latest` runs `pnpm run electron:dist:linux`
- `windows-latest` runs `pnpm run electron:dist:win`
- `macos-latest` runs `pnpm run electron:dist:mac`

Each release job uploads its generated files as a workflow artifact and attaches the same files to the published GitHub Release. Diagnostic rebuilds only upload workflow artifacts.

Release builds set `CSC_IDENTITY_AUTO_DISCOVERY=false`, so the default workflow produces unsigned desktop artifacts unless signing secrets and Electron Builder signing configuration are added later.

The release workflow caches pnpm downloads, TypeScript/Vite caches, Electron downloads, Electron Builder caches, and `.cache/electron-runtime` to reduce repeated desktop build time on native runners.

Use `.github/workflows/release.yml` for published desktop releases. It is the lane that also validates the release tag, publishes the npm package through trusted publishing, and attaches generated installers/packages to the GitHub Release.

## CI Release Candidate Packages

The no-secret release-candidate package lane is part of `.github/workflows/ci.yml`, named `Code UX CI Pipeline`. It runs for `main` validation and manual dispatches after package smoke, keeping the full desktop package proof out of the routine `dev` lane.

The `10 Release Candidate / desktop package` matrix starts as soon as the package smoke job passes, so desktop packaging can run beside the E2E and orchestration matrices instead of waiting for them to finish. It downloads the shared `codeux-build-linux` artifact, installs the cached Electron binary, rebuilds Electron native dependencies, prepares runtime assets, and runs Electron Builder directly with `--linux`, `--mac`, or `--win` plus `--publish never`. The package smoke job that precedes it runs `node scripts/verify-release-install.mjs` with `CODE_UX_SKIP_RELEASE_INSTALL_BUILD=1`, so the npm tarball install check uses the same compiled artifact instead of rebuilding.

Release-candidate packaging sets `CSC_IDENTITY_AUTO_DISCOVERY=false` for unsigned Electron packaging and passes `--publish never` to Electron Builder. It does not require provider API keys, npm publishing credentials, Docker credentials, GitHub Release events, or real project state. When Electron output exists, the workflow uploads files from `release/electron/` as workflow artifacts only; it does not publish to npm or attach files to a GitHub Release.

This lane validates desktop package creation before code reaches `main`; it is not the publishing lane. Treat its artifacts as CI evidence for installability and package generation. `.github/workflows/release.yml` is the source for npm publishing and release-attached desktop builds after a GitHub Release is published. `.github/workflows/desktop-release.yml` remains as `Desktop Release Diagnostics`, an artifact-only manual rebuild path that cannot mutate a GitHub Release.

Developers can reproduce the main-PR desktop package portion locally with:

```bash
pnpm run build
node scripts/verify-release-install.mjs
pnpm run electron:install-deps
pnpm run electron:dist -- --publish never
```

Use `pnpm run electron:dist:linux -- --publish never`, `pnpm run electron:dist:mac -- --publish never`, or `pnpm run electron:dist:win -- --publish never` when matching a specific GitHub Actions matrix leg.

## Cross-Platform Compatibility Findings

- File and directory selection: browser image upload uses standard `<input type="file">` and `FileReader`, which Electron/Chromium supports on macOS, Linux, and Windows. Project directory selection now uses Electron's native directory dialog in the desktop app and falls back to the existing dashboard directory browser outside Electron.
- Paths: backend directory browsing uses Node `path`, `os.homedir()`, and root detection, so Windows drive roots, Linux roots, and macOS roots resolve through the host platform. Tilde expansion accepts both `~/path` and `~\path`.
- Project and Git helpers treat local Windows repository paths as first-class inputs. Clone target name derivation splits both POSIX and Windows separators, absolute user paths resolve through the host platform, and tests compare native paths through normalized representations unless the UI intentionally displays host-native paths.
- User-home dependent desktop behavior must consider both `HOME` and `USERPROFILE`; Windows Electron sessions resolve home directories through the native profile environment.
- Dashboard date, time, and token/count formatting that is rendered in English UI is pinned to explicit `en-US`/UTC formatting where deterministic display matters, preventing host locale differences from changing the desktop surface or CI snapshots.
- Dashboard API calls: the frontend uses relative `/api/*` calls, so it follows the Electron-loaded loopback origin and does not hardcode `localhost`. Shared JSON fetches default to `cache: "no-store"` and the server sends no-store headers for runtime API responses.
- Dashboard JSON mutations are parsed on runtime API routes even if a packaged Chromium request arrives with a missing or downgraded JSON `Content-Type` header. Multipart knowledge uploads and preview proxy bodies are excluded from that fallback so route-specific body handling remains intact.
- Speech input: Electron grants microphone access only for the dashboard loopback origin, while the npm-served dashboard relies on browser secure-context treatment for `localhost` and `127.0.0.1`. If the browser or operating system blocks capture, the dashboard reports the unsupported or permission-denied state and does not mutate the composer draft.
- Sprint previews: preview iframes use same-port `preview-<session>.localhost` origins and the backend routes those hosts to loopback preview containers. Electron keeps those preview URLs internal.
- External links: `target="_blank"` and navigation to non-dashboard HTTP(S) or mailto URLs open in the user's default browser/mail client instead of replacing the desktop shell.
- Native modules: Electron Builder is configured to unpack `.node` files and `onnxruntime-node` assets from ASAR so native bindings remain loadable after packaging.
- WSL validation: packaged launches under WSL disable Electron hardware acceleration and GPU rasterization to avoid WSL GPU process crashes during local release checks.

## Speech Platform Notes

- macOS shows a system microphone consent prompt the first time the desktop app records audio. If access is denied, re-enable it in System Settings under Privacy & Security > Microphone.
- Windows shows microphone consent through Windows privacy controls. If capture fails after an in-app allow decision, check Settings > Privacy & security > Microphone and confirm desktop apps can access the microphone.
- Linux microphone access depends on the desktop audio stack and sandbox format. AppImage and tar.gz builds normally use the host PulseAudio/PipeWire session directly; distro package installs follow the user's desktop permission and audio-device configuration.
- Browsers launched from the npm package can record from `http://localhost:<port>` or `http://127.0.0.1:<port>` because modern browsers treat loopback HTTP as a secure context for media capture. Non-loopback dashboard hosts may require HTTPS and explicit browser permission before microphone capture is available.

## Release Constraints

Linux builds can be validated from WSL with `electron:pack` or Linux-specific targets when required system packaging tools are available.

Windows and Linux targets can be produced from Linux with Electron Builder, but native dependencies may require target-platform rebuilds or prebuilt binaries. macOS packages and macOS code signing require macOS. Production releases should build and sign on each target operating system or a CI matrix with dedicated runners.

Unsigned macOS and Windows builds may trigger operating-system trust warnings. Release builds should add platform signing and notarization before public distribution.
