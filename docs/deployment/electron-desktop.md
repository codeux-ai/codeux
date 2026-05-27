# Electron Desktop App

Code UX can run as an installable Electron desktop app while preserving the existing MCP server and dashboard architecture.

## Runtime Model

- Electron boots the compiled backend in the main process from `dist/electron/main.js`.
- The backend still serves the dashboard over loopback HTTP.
- The desktop window loads the resolved dashboard URL, usually `http://127.0.0.1:4444`.
- If the requested dashboard port is busy, the backend keeps the existing retry behavior and the Electron window opens the actual runtime port.
- MCP stdio is disabled in the Electron runtime with `CODE_UX_DISABLE_MCP_STDIO=1` so the GUI process does not attach to desktop process stdio.
- External links are opened through the host operating system. In-app dashboard and sprint-preview URLs remain inside the Electron app.

## Native Desktop Integration

The Add Project dialog uses a native Electron directory picker when running in the desktop app. Browser-only dashboard sessions keep the existing HTTP directory browser fallback.

The native picker is exposed through the isolated preload bridge:

- `window.codeUxDesktop.pickDirectory(defaultPath?)`
- returns `{ canceled, filePath }`

Renderer Node access remains disabled. The preload exposes only this narrow IPC surface.

## Build Commands

- `pnpm run electron:dev`: build and launch the desktop app from the local workspace.
- `pnpm run electron:pack`: build an unpacked app directory for the current platform.
- `pnpm run electron:dist`: build installers/packages for the current platform.
- `pnpm run electron:dist:linux`: build Linux targets.
- `pnpm run electron:dist:mac`: build macOS targets.
- `pnpm run electron:dist:win`: build Windows targets.
- `pnpm run electron:install-deps`: rebuild native app dependencies for Electron.

The release output is written to `release/electron/`.

Electron package builds run `pnpm run electron:prepare-deps` before Electron Builder. That script creates a production-only, hoisted runtime dependency tree in `.cache/electron-runtime/node_modules`, and Electron Builder copies it to `resources/node_modules` so ASAR-packaged builds can resolve pnpm transitive dependencies at runtime.

## GitHub Release Builds

Desktop release artifacts are built by `.github/workflows/desktop-release.yml` when a GitHub Release is published. The workflow can also be started manually from GitHub Actions with an optional tag input.

The workflow builds on native runners:

- `ubuntu-latest` runs `pnpm run electron:dist:linux`
- `windows-latest` runs `pnpm run electron:dist:win`
- `macos-latest` runs `pnpm run electron:dist:mac`

Each job uploads its generated files as a workflow artifact. For published GitHub Releases, the same generated files are also attached to the release.

Release builds set `CSC_IDENTITY_AUTO_DISCOVERY=false`, so the default workflow produces unsigned desktop artifacts unless signing secrets and Electron Builder signing configuration are added later.

## Cross-Platform Compatibility Findings

- File and directory selection: browser image upload uses standard `<input type="file">` and `FileReader`, which Electron/Chromium supports on macOS, Linux, and Windows. Project directory selection now uses Electron's native directory dialog in the desktop app and falls back to the existing dashboard directory browser outside Electron.
- Paths: backend directory browsing uses Node `path`, `os.homedir()`, and root detection, so Windows drive roots, Linux roots, and macOS roots resolve through the host platform. Tilde expansion accepts both `~/path` and `~\path`.
- Dashboard API calls: the frontend uses relative `/api/*` calls, so it follows the Electron-loaded loopback origin and does not hardcode `localhost`.
- Sprint previews: preview iframes use same-port `preview-<session>.localhost` origins and the backend routes those hosts to loopback preview containers. Electron keeps those preview URLs internal.
- External links: `target="_blank"` and navigation to non-dashboard HTTP(S) or mailto URLs open in the user's default browser/mail client instead of replacing the desktop shell.
- Native modules: Electron Builder is configured to unpack `.node` files and `onnxruntime-node` assets from ASAR so native bindings remain loadable after packaging.
- WSL validation: packaged launches under WSL disable Electron hardware acceleration and GPU rasterization to avoid WSL GPU process crashes during local release checks.

## Release Constraints

Linux builds can be validated from WSL with `electron:pack` or Linux-specific targets when required system packaging tools are available.

Windows and Linux targets can be produced from Linux with Electron Builder, but native dependencies may require target-platform rebuilds or prebuilt binaries. macOS packages and macOS code signing require macOS. Production releases should build and sign on each target operating system or a CI matrix with dedicated runners.

Unsigned macOS and Windows builds may trigger operating-system trust warnings. Release builds should add platform signing and notarization before public distribution.
