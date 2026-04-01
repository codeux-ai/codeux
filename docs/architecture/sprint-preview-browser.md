# Sprint Preview Browser

This page describes the sprint-scoped in-app browser and preview-container runtime.

## Goal

Sprint OS can now build and run one isolated preview app per sprint, then surface that app inside the dashboard through a same-origin browser view.

The feature is designed for:
- comparing multiple active sprint builds side by side without port conflicts
- previewing progress inside Sprint OS instead of switching out to separate terminals
- reusing the existing Docker/bootstrap/runtime stack instead of introducing a second container system

## Primary Implementation Files

- `src/services/sprint-preview-service.ts`
- `src/services/sprint-preview-utils.ts`
- `src/repositories/sprint-preview-repository.ts`
- `src/repositories/app-db-storage.ts`
- `src/server/dashboard-server.ts`
- `src/server/jules-agent-server.ts`
- `dashboard/src/v2/BrowserPage.tsx`
- `dashboard/src/v2/lib/browser-api.ts`
- `dashboard/src/v2/SettingsPage.tsx`

## Runtime Model

Each preview session is scoped to one `(projectId, sprintId)` pair.

Key rules:
- every sprint preview runs from a dedicated exported branch snapshot under the preview runtime root, not a registered git worktree
- the preview container reuses the same Docker bootstrap and can reuse an already-built cached setup image, but preview startup no longer builds setup-cache images inline or runs the full worker setup script at runtime
- the app inside the container listens on `sprintPreview.containerAppPort`
- the host-facing port is allocated from `sprintPreview.hostPortRangeStart..hostPortRangeEnd`
- host ports bind to `127.0.0.1` only
- preview startup injects `HOST`, `PORT`, `DASHBOARD_HOST`, `DASHBOARD_PORT`, and `SPRINT_PREVIEW_WORKSPACE` so containerized apps can bind to the published preview port and boot from the exported snapshot directory
- preview startup is serialized per `(projectId, sprintId)` so manual starts, rebuilds, and auto-start reconciliation cannot spawn duplicate session containers
- if the previewed app still binds a loopback-only internal port, the generated preview bootstrap keeps a dedicated in-container bridge open on the published preview proxy port and forwards requests to the live app listener
- containers are labeled with sprint-preview metadata so runtime reconciliation can rediscover them

Preview session state is persisted in sqlite instead of staying process-local.

## Storage

Preview runtime state is stored in the Sprint OS app database table:
- `sprint_preview_sessions`

The table stores:
- project/sprint identity
- preview status and health
- host/container port mapping
- container id/name
- preview workspace path and feature branch
- resolved startup mode and detected commands
- task-count and sprint-status markers used by reconciliation
- timestamps and last error state

## Startup Script Resolution

Preview startup uses a dedicated script path, separate from the task-execution setup script.

Resolution order:
1. explicit project setting `sprintPreview.startupScriptPath`
2. default project-relative path `.sprint-os/browser/start-preview.sh`
3. generated fallback script when no custom preview script exists

Command detection reads `package.json` and lockfiles to infer:
- package manager
- install command
- build command
- runtime command

Install behavior:
- preview runtime now uses `pnpm install --prefer-offline --no-frozen-lockfile` so non-fatal manifest/lockfile drift does not spam container logs and warmed runtime caches are reused before going back to the registry
- preview containers now reuse the shared Docker runtime package caches instead of mounting host `node_modules`, and pnpm is pinned to a persistent store under that runtime cache so exported workspaces do not trigger cold installs on every rebuild
- preview fallback now prefers the base image plus app-level install/build commands over re-running the worker-oriented setup script, which avoids unrelated provider/Playwright bootstrap work from blocking app previews

Runtime command preference:
1. `preview`
2. `start`
3. `serve`
4. static build-directory fallback via `serve`

The setup script configured in `cliWorkflow.containerSetupScriptPath` still prepares the container environment. It does not replace the preview startup script.

## Browser Delivery

The browser now serves each preview session on its own local origin:
- `http://preview-<sessionId>.<dashboard-host>:<dashboardPort>/...`

The dashboard server routes that host to the matching preview container by session id, generalizing beyond just `.localhost` to support tunneled or hosted environments (e.g. `preview-123.example.com`). This replaces the older path-proxy page delivery model and gives each preview its own origin by default.

Benefits:
- relative `/api/...` and websocket calls stay inside the preview container instead of hitting the main dashboard APIs
- cookies, local storage, and service workers stay isolated per preview session
- open-in-new-tab uses the preview origin directly instead of a rewritten proxy path
- extensionless direct loads such as `/sprints` now retry the preview app shell when a dev server returns `404`, so SPA routes keep working on refresh and on copied deep links

The dashboard injects a small preview bridge script into proxied HTML responses. The bridge:
- reports `location` and `title` changes to the parent browser page via `postMessage`
- accepts back/forward/reload/navigate commands from the parent browser chrome
- uses `history.pushState` / `history.replaceState` for parent-driven path changes before falling back to hard navigations, so SPA previews can switch routes without reloading the entire app

Host-based preview routing also proxies websocket upgrades so preview apps that derive websocket URLs from `window.location` continue to work on their own preview origin.

## Automation

`SprintPreviewService.reconcileSessions()` runs on a background interval from `JulesAgentServer`.

It supports:
- auto-start when a sprint becomes `running`
- rebuild when completed task count increases
- rebuild when a sprint transitions into a completed terminal state
- auto-stop when a sprint becomes terminal

Rebuild behaviors:
- A rebuild (whether triggered automatically or manually via `POST /api/browser/sessions/:sessionId/rebuild`) now synchronizes the sprint feature branch with `origin` before exporting the workspace. This ensures remote changes (such as those pushed by remote Jules workers) are reflected in rebuilt containers.

These behaviors are controlled through scoped settings under `sprintPreview`.

Current preview controls include:
- `enabled`
- `showInAppBrowser`
- `autoStartOnRunningSprint`
- `rebuildOnTaskCompletion`
- `rebuildOnSprintCompletion`
- `pullLatestOnRebuild`
- `autoStopOnTerminalSprint`
- `maxConcurrentContainers`
- `hostPortRangeStart`
- `hostPortRangeEnd`
- `containerAppPort`
- `startupScriptPath`

Startup hygiene:
- Sprint OS now removes any existing `sprint-os.preview=true` containers on server startup before the preview reconciliation loop begins
- Sprint OS also removes orphaned unlabeled setup-helper containers that were created by older inline setup-image preview flows
- persisted preview sessions are reset back to `stopped` during that startup cleanup so stale containers do not survive process restarts
- any legacy repo-local preview worktree directories under `.sprint-os/worktrees/preview-*` are removed on startup so older preview implementations stop polluting the repository checkout

## Dashboard Surface

The dashboard now exposes:
- `/browser` route for the in-app browser workspace
- dock and top-nav entry points for the browser
- a dedicated horizontal session slider strip above the browser surface, so the iframe starts directly below the cards instead of sharing a stretched header row
- session cards in that rail are limited to persisted preview containers (`running`, `starting`, `stopped`, or `error`) rather than every sprint in the project
- the rail ends with a placeholder-style `Launch Container` card that lets the operator choose any sprint from a selector and start a preview container without changing the current sprint scope elsewhere in the dashboard
- the browser chrome includes a lightweight tab rail that shows the active container name plus recently visited preview routes for the selected session
- in-app navigation no longer rebinds the iframe `src` for every route change; Browser chrome updates use the preview bridge so client-side routers can transition in place
- when the selected preview session is stopped, starting, unhealthy, or missing a reachable host port, the embedded iframe is replaced with a standby panel that explains the state and exposes `Start Container` / `Rebuild Container` actions instead of surfacing raw proxy socket errors
- the Browser page polls preview-session state more aggressively than the generic default so the embedded preview reconnects quickly after a start or rebuild once the container becomes healthy
- a dedicated `Browser Preview` settings category in the left settings rail for preview enablement, visibility, rebuild policy, Git sync, and container-cap controls
- project-level `Sprint Browser` settings in the project settings editor for port range, startup script path, and automation overrides
- per-sprint startup script editing in the browser page itself
- preview logs, rebuild, stop, open, and remove actions
- port routing status on preview cards, including container-port to host-port mappings such as `:4444 -> :5653`
- when `showInAppBrowser` is disabled, Browser entry points are hidden from the dashboard shell and the `/browser` route shows a configuration notice instead of the embedded workspace
- when `enabled` is disabled, preview reconciliation stops active preview containers and prevents new launches or rebuilds
- when `maxConcurrentContainers` would be exceeded, Sprint OS stops the oldest active previews in the same project before starting the next one

## API Surface

Preview endpoints are implemented in `src/server/dashboard-server.ts`.

- `GET /api/projects/:projectId/preview/sessions`
- `POST /api/projects/:projectId/sprints/:sprintId/preview/start`
- `POST /api/browser/sessions/:sessionId/rebuild`
- `POST /api/browser/sessions/:sessionId/stop`
- `DELETE /api/browser/sessions/:sessionId`
- `GET /api/projects/:projectId/sprints/:sprintId/preview/script`
- `PUT /api/projects/:projectId/sprints/:sprintId/preview/script`
- `GET /api/browser/sessions/:sessionId/logs`
- `ALL /api/browser/sessions/:sessionId/proxy/*`

The legacy path-proxy endpoint remains available for compatibility and diagnostics, but the production browser surface should prefer the preview host origin.

## Current Boundaries

Current intentional limits:
- one persisted preview session row per project+sprint pair
- preview host routing assumes projects use relative URLs or origin-derived absolute URLs for API/websocket traffic
- script detection prefers production-style preview/start commands and does not automatically fall back to `dev`
