# Electron Desktop App

Code UX can run as an installable Electron desktop app while preserving the existing MCP server and dashboard architecture.

## Runtime Model

- Electron boots the compiled backend in the main process from `dist/electron/main.js`.
- The backend still serves the dashboard over loopback HTTP.
- The desktop window loads the resolved dashboard URL, usually `http://127.0.0.1:4444`.
- If the requested dashboard port is busy, the backend keeps the existing retry behavior and the Electron window opens the actual runtime port.
- MCP stdio is disabled in the Electron runtime with `CODE_UX_DISABLE_MCP_STDIO=1` so the GUI process does not attach to desktop process stdio.
- Mutable dashboard runtime traffic (`/api/*`, `/health`, and `/ready`) is treated as non-cacheable in both the backend response headers and the Electron session. The desktop app clears the Electron HTTP cache on startup and injects no-cache request/response headers for loopback runtime data so stale Chromium cache entries cannot make settings, project, agent, or runtime pages appear frozen after navigation.
- Windows packaged builds keep the active WebGL context cap at 16 so the persistent shell canvas, avatar canvases, and route-scoped chart canvases have enough headroom during long navigation sessions while old Chromium contexts are waiting for garbage collection.
- External links are opened through the host operating system. In-app dashboard and sprint-preview URLs remain inside the Electron app.

## Native Desktop Integration

The Add Project dialog uses a native Electron directory picker when running in the desktop app. Browser-only dashboard sessions keep the existing HTTP directory browser fallback.

The native picker is exposed through the isolated preload bridge:

- `window.codeUxDesktop.pickDirectory(defaultPath?)`
- returns `{ canceled, filePath }`

Renderer Node access remains disabled. The preload exposes only this narrow IPC surface.

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

Desktop release artifacts are built by `.github/workflows/desktop-release.yml` when a GitHub Release is published. The workflow can also be started manually from GitHub Actions with an optional tag input.

The workflow builds on native runners:

- `ubuntu-latest` runs `pnpm run electron:dist:linux`
- `windows-latest` runs `pnpm run electron:dist:win`
- `macos-latest` runs `pnpm run electron:dist:mac`

Each job uploads its generated files as a workflow artifact. For published GitHub Releases, the same generated files are also attached to the release.

Release builds set `CSC_IDENTITY_AUTO_DISCOVERY=false`, so the default workflow produces unsigned desktop artifacts unless signing secrets and Electron Builder signing configuration are added later.

The release workflow caches pnpm downloads, TypeScript/Vite caches, Electron downloads, Electron Builder caches, and `.cache/electron-runtime` to reduce repeated desktop build time on native runners.

## Cross-Platform Compatibility Findings

- File and directory selection: browser image upload uses standard `<input type="file">` and `FileReader`, which Electron/Chromium supports on macOS, Linux, and Windows. Project directory selection now uses Electron's native directory dialog in the desktop app and falls back to the existing dashboard directory browser outside Electron.
- Paths: backend directory browsing uses Node `path`, `os.homedir()`, and root detection, so Windows drive roots, Linux roots, and macOS roots resolve through the host platform. Tilde expansion accepts both `~/path` and `~\path`.
- Dashboard API calls: the frontend uses relative `/api/*` calls, so it follows the Electron-loaded loopback origin and does not hardcode `localhost`. Shared JSON fetches default to `cache: "no-store"` and the server sends no-store headers for runtime API responses.
- Sprint previews: preview iframes use same-port `preview-<session>.localhost` origins and the backend routes those hosts to loopback preview containers. Electron keeps those preview URLs internal.
- External links: `target="_blank"` and navigation to non-dashboard HTTP(S) or mailto URLs open in the user's default browser/mail client instead of replacing the desktop shell.
- Native modules: Electron Builder is configured to unpack `.node` files and `onnxruntime-node` assets from ASAR so native bindings remain loadable after packaging.
- WSL validation: packaged launches under WSL disable Electron hardware acceleration and GPU rasterization to avoid WSL GPU process crashes during local release checks.

## Release Constraints

Linux builds can be validated from WSL with `electron:pack` or Linux-specific targets when required system packaging tools are available.

Windows and Linux targets can be produced from Linux with Electron Builder, but native dependencies may require target-platform rebuilds or prebuilt binaries. macOS packages and macOS code signing require macOS. Production releases should build and sign on each target operating system or a CI matrix with dedicated runners.

Unsigned macOS and Windows builds may trigger operating-system trust warnings. Release builds should add platform signing and notarization before public distribution.
