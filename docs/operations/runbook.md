# Operations Runbook

This runbook covers day-to-day operation and incident handling for the MCP server and dashboard.

## Normal Startup Procedure

Database maintenance (`DatabaseMaintenanceService`) runs automatically during normal startup to perform settings-driven DB pruning, VACUUM, and WAL checkpointing. Do not instruct operators to manually perform destructive DB edits. Operators can expect:
- `dbAutoVacuumOnStartup`: Triggers VACUUM on local databases. Can skip if set to false.
- `dbPruningEnabled`: Prunes old data matching `dbRetentionDays`. Can skip if set to false.
- `dbRetentionDays`: Bounded to a safe range (1-3650 days). Negative or zero values will be clamped.
- Startup logs will show a structured result detailing counts of pruned elements, failed vacuums, and WAL checkpoint failures (`checkpointFailures`). WAL checkpoint failures are non-fatal, busy checkpoints are safe to retry later.

1. Confirm API key source is available (recommended, but startup is allowed without key).
2. Start server (`pnpm run dev` or `pnpm start`).
   - `pnpm run dev` runs the TypeScript entrypoint through the repository dev script.
   - Code UX writes a project-manager PID lock under the home `.code-ux/runtime/` directory. If another recorded Code UX runtime process is still alive, startup waits briefly for that process to finish shutdown before failing, instead of launching a second scheduler against the same Docker/runtime state. Tune the wait with `CODE_UX_RUNTIME_LOCK_WAIT_MS` when shutdown is expected to be slow. Set `CODE_UX_ALLOW_MULTIPLE_RUNTIMES=1` only for targeted diagnostics.
   - Dashboard startup launches a best-effort background prewarm for the pinned provider-login base image. Startup does not wait for Docker; if Docker is unavailable or the build fails, the login modal retries image preparation on demand and can still fall back to the raw base image.
3. Open dashboard and verify settings.
4. Confirm `/api/status` and `/api/git-status` (via `GitStatusService`) are responding.
5. Confirm `/health` and `/ready` probes:
   - `/health`: Liveness probe. In dashboard mode it is served by the dashboard server; in server mode it is served by the MCP HTTP listener.
   - `/ready`: Readiness probe from the dashboard server or MCP HTTP listener. A success (`{"status":"READY"}` or `{"status":"UP"}`) means the server considers required startup/runtime dependencies ready enough to serve normal traffic. It does not validate every provider, project, Docker workspace, or external service.

### Headless Server Mode

Use `--server-mode` or `CODE_UX_SERVER_MODE=true` for an MCP-only process intended for authenticated remote clients. Server mode disables the dashboard listener, dashboard websocket, terminal websocket, and static dashboard assets; starts MCP HTTP by default; and requires an explicit non-empty bearer token via `MCP_HTTPS_AUTH_TOKEN`, `MCP_HTTP_AUTH_TOKEN`, `--mcp-https-auth-token`, or `--mcp-http-auth-token`.

If started without key:
- Configure `JULES_API_KEY` in `.env`, or `julesApiKey` in `.code-ux/settings.json`, or set it in dashboard settings.
- Retry API-backed commands after configuration.
- Dashboard key fields can stay empty when system-wide environment keys are already present.

## Sprint Execution Procedure

1. Verify the repo is a healthy git checkout. Code UX now prepares the local feature branch automatically on orchestration start and will try to push it to `origin` when that remote exists.
2. Create or verify sprint tasks in the dashboard, or import them from markdown when needed.
3. Ensure at least one worker is connected through `listen` for the project when you want supervised execution.
4. Start the sprint from the dashboard.
5. Follow merge and action-required protocol until terminal state, resuming from the dashboard after manual intervention.

## Safety Controls

### Dashboard and file access boundaries
- Dashboard mutation requests to `/api/*`, `/health`, and `/ready` reject hostile browser origins. Treat `Sec-Fetch-Site: cross-site`, malformed `Origin`, cross-host `Origin`, malformed `Referer`, and cross-host `Referer` on mutations as blocked browser requests; CLI/API clients without browser origin headers remain allowed.
- Local directory browsing only lists canonical paths inside the allowed local roots. Encoded traversal, Windows-style separator traversal, absolute paths outside the roots, and symlink escapes must not expose directory listings or leak requested paths in error responses.
- Sprint file-browser file and diff reads accept normalized relative paths only. Encoded traversal, malformed percent encoding, `..` traversal, Windows drive paths, and absolute paths are rejected as malformed client input before provider or Docker-backed file-browser dependencies are invoked.
- Provider login terminal requests reject provider configuration IDs with path separators, traversal sequences, absolute-path syntax, encoded separators, control characters, leading hyphens, or characters outside the filesystem-safe ID set before credential directories are removed, created, or copied.
- Malformed dashboard route inputs should return client errors (`400`, `403`, or `404` depending on the failure). Unexpected server failures should return only `{ "error": "Internal Server Error" }` to callers while still flowing to Express error handling and structured logs.
- MCP approval prompts are one-time, correlation-id-bound decisions. Expired, mismatched, duplicate, blank, or malformed correlation IDs must not return a pending approval, and destructive settings approvals are bound to the exact action and payload that was queued.
- For preview/file-browser failures, triage routes through preview host middleware (`src/server/preview-host-middleware.ts`) and cleanup/rebuild/restart steps; commands are safe and avoid exposing local DB contents, tokens, hostnames, or private paths.
- Structured logs and invocation output pass through redaction helpers before storage or display. Secret-like environment assignments, authorization headers, hosted Git tokens, and URL credentials should appear only as `[REDACTED]` in logs and provider output.

### Emergency stop
If consecutive task creation failures reach threshold:
- New task creation stops.
- Review credentials, source ID, branch state, Jules API availability.
- Re-run after corrective actions.

### Preflight blockers
- Branch preflight blocker means Code UX could not prepare the local feature branch, or it could not push the branch to `origin` on a repo that expects a remote feature branch.
- Planning preflight blocker means subtask files are missing.

### Provider Concurrency Controls
Provider concurrency is enforced globally across all projects using `ProviderSettings.maxConcurrentTasks`.
- **Pre-Launch Enforcement**: Slots are claimed atomically before any provider container or host process is launched. If no slot is available, the task dispatch waits and retries until a slot becomes free.
- **Unlimited Mode**: Setting `maxConcurrentTasks` to `0` disables concurrency enforcement for that provider (unlimited).
- **Terminal States**: Completed, failed, cancelled, or quota-wait terminal invocations do not count against the cap. Only 'running' invocations are counted.
- **Abort Handling**: If a task dispatch is cancelled while waiting for a slot, the wait loop exits immediately without creating a stale running invocation record.

### Provider invocation observability
- Provider usage rows are the source of truth for runtime diagnostics. Confirm `provider_invocations` keeps the Code UX provider invocation id, Code UX session id, native provider session id, provider, purpose, status, model, execution mode, lifecycle timestamps, duration, token counters, transcript character count, tool-call count, usage source, invocation source, and raw-usage presence. Linked `execution_invocations` preserve the provider invocation id for cross-querying.
- Structured invocation logs are metadata-only. They may include identifiers, lifecycle fields, counters, `failureCount`, `errorName`, and `correlationId`, but must not include raw transcripts, API keys, provider environment values, raw usage JSON, or full prompts.
- Docker provider launches should expose only env-file and controlled mount paths in the host process arguments. Provider API keys, Git tokens, custom provider env values, and long prompts are written to temporary files or controlled mounts and should not appear in `docker run` argv or activity log metadata.
- File logging has its own threshold. `DEBUG_LOG_FILE_LEVEL=debug` can persist debug-level provider diagnostics to `.code-ux/debug.log` even when console logging is filtered to `error`; use this only for focused diagnostics and keep the metadata-only rule in place.
- New runtime logs should set a structured `logPurpose` label so request (`HTTP`), invocation (`INVK`), realtime (`LIVE`), security (`SEC`), orchestration (`ORCH`), storage (`DATA`), and lifecycle (`LIFE`) traffic stays separable in console and debug-file output.
- Realtime event logs are operational metadata, not payload dumps. They may include event type, sequence, scope, bounded byte sizes, replay/recovery reason, and `correlationId`; they must not include full websocket frames, dashboard payloads, provider transcripts, request bodies, API keys, or authorization headers.

Focused validation:

```bash
pnpm run test:backend -- tests/backend/infrastructure/providers/cli/provider-runner.test.ts tests/backend/infrastructure/providers/cli/provider-execution-loop.test.ts tests/backend/infrastructure/providers/cli/provider-telemetry-watcher.test.ts tests/backend/infrastructure/providers/cli/docker-runner.test.ts tests/backend/infrastructure/providers/cli/workspace-manager.test.ts tests/backend/repositories/execution-repository.test.ts tests/backend/shared/logging/logger.test.ts
pnpm run test:backend:coverage
pnpm run lint
```

## Common Incidents

### 1. Dashboard unavailable
Checks:
- Is server process running?
- Is configured dashboard port free?
- Any startup warning for `EADDRINUSE`?

### 1a. Dashboard loads slowly or live view feels stale during a sprint
Checks:
- If logs show `malformed_snapshot_identity`, `selected_sprint_missing_while_active`, `selected_sprint_outside_project`, or `active_runs_mismatch_snapshot_scope`, runtime state may be temporarily inconsistent. Restarting the dashboard server should reconcile the local state.
- If logs show `repeated_unhealthy_recovery_patterns`, a client is struggling to keep its WebSocket synced. Check the client's network connection or if a proxy is severing long-lived connections.
- Look at dashboard request timings for static assets and `/api/execution`; multi-second `304` or static asset responses usually indicate event-loop pressure from orchestration work rather than network latency.
- Verify the current build includes the March 15, 2026 realtime hardening:
  - throttled project execution snapshots
  - lightweight non-replayable snapshot markers in `dashboard_realtime_events`
  - direct attention-item realtime refresh
  - scope-aware websocket replay checks
- If the live view updates task state but Git/CI panels lag, confirm `/api/git-status` is healthy; that surface is rate-limited to avoid external API spam, so it may trail runtime updates by a couple of seconds under heavy activity.
- `/api/live-activities` fetches are bounded per provider session with a safe timeout so slow activity reads cannot stall the dashboard request indefinitely. Fetch concurrency remains capped, terminal sessions are skipped before cache lookup or provider fetch, and sessions that genuinely return zero activities are negative-cached briefly to avoid hot polling.
- If a live activity refresh times out or fails for a session with previously cached activities, Code UX logs a warning and returns the stale activities instead of replacing them with an empty result. Provider errors and timeouts are not treated as empty activity results, so the next refresh can recover as soon as the provider responds again.
- Sprint session-sync activity polling uses the same bounded behavior: a slow or rejected provider activity API logs `Could not fetch activities for session` with `sessionName`, `pageSize`, `concurrency`, `timeoutMs`, `elapsedMs`, `errorName`, and `errorMessage`, then records an empty activity list for that poll only. A genuine empty provider response is not logged as a failure.
- Live activity warnings include structured fields such as `sessionName`, `failureCause`, `errorName`, `cacheFallbackState`, `cachedActivityCount`, and `timeoutMs` when applicable. They should not include provider output bodies; inspect provider session logs separately if the cause needs deeper diagnosis.
- To validate this surface after cache or timeout changes, run `pnpm run test:backend -- tests/backend/server/activity-cache-service.test.ts`, then `pnpm run test:backend:coverage` to confirm `src/server/activity-cache-service.ts` remains above its 80% line threshold.
- `/api/system/update-status` reports the running Code UX version plus the latest published npm version. It caches the npm lookup briefly, so repeated dashboard refreshes should not hammer the registry, and the dashboard logs a single startup notice when a newer release is available. The response keeps the legacy `releaseUrl` field and also includes typed `downloadTargets.npm` and `downloadTargets.electron` entries so consumers can route npm installs to `npmjs.com` and desktop updates to the official `github.com/codeux-ai/codeux` release tag. Registry failures return `latestVersion: null`, the repository releases fallback URL, and stable official fallback download targets.
- The Electron dashboard title bar shows the running version when `window.codeUxDesktop.window` is available. The update affordance is driven by `useUpdateStatus()` and appears only when `/api/system/update-status` reports `updateAvailable === true`; when `latestVersion` is known, the button remains version-aware in its accessible label. The visible action still calls the fixed preload `openUpdates()` bridge. If the bar is missing in desktop mode, inspect preload bridge initialization and renderer access to `window.codeUxDesktop.window`; if the update button is missing, inspect the update-status response first.
- If the dashboard still degrades under load, inspect `runtime.debugLogFileLevel`; file logging defaults to `error` and uses async streams, but sustained log volume is still a useful signal that a hot loop is too noisy.

### 2. No PR/CI data in remote mode
Checks:
- Token availability in settings/env
- `/api/git-providers/available` reports token-backed provider availability only. It does not require or probe local `gh`/`glab` binaries.
- If a CLI task pushed code but cannot create a PR, the run now fails instead of completing as "without PR" while auto-create PRs are enabled. When a GitHub/GitLab token is configured, Code UX creates and finds PRs/MRs through the host API and does not require `gh` or `glab` on the machine.
- If no GitHub/GitLab token is configured, remote PR/CI/issue automation is unavailable until the matching token is configured. Code UX no longer falls back to local `gh`/`glab` for dashboard provider availability, new remote repository creation, PR/MR status, or GitHub issue import/close flows.
- Git subprocesses launched by the backend run through the `alpine/git` helper container, with Git-specific auth/config environment forwarded into the container. Warm helper containers are keyed by the project Git common directory plus host UID/GID, so repo-local worktrees share one project helper instead of creating one helper per task workspace. Extra host paths such as temporary bundle outputs and Git index files are mounted to Linux-style container paths under `/mnt/code-ux/git-paths/*`, so Windows paths like `C:\Users\...\AppData\Local\Temp\code-ux-bundle-*` are never used as Docker mount targets. The helper masks the image-declared `/git` volume with tmpfs so these commands do not leave anonymous Docker volumes behind. Production runtime does not require host Git; host-Git env switches are reserved for guarded E2E/test lanes.
- Git host API reads are throttled and cached briefly to avoid rate-limit bursts when multiple sprints poll PR/CI state at the same time. Failed-run job/log enrichment is still limited, so Git/CI panels may trail live task state under heavy activity.
- "Workflow completed without PR" is only expected when `git.autoCreatePr` is disabled for the resolved system/project/sprint settings.

### 2a. Models catalog workflow cannot push to a protected branch
Checks:
- The Models Catalog workflow runs on pushes to `main` and `dev`, fetches `models.dev`, and compares the result with `assets/models-dev/catalog.json`.
- When the catalog changes, the workflow must not push directly back to `main` or `dev`; branch protection requires PR-based changes. It pushes `chore/models-catalog-<target-branch>` instead and opens or updates a PR against the branch that triggered the workflow.
- Catalog update commits must not include `[skip ci]` or another GitHub Actions skip marker. These PRs only carry `assets/models-dev/catalog.json` changes, but the normal pull request CI still needs to run before merge.
- If the job reports a push rejection for `refs/heads/main` or `refs/heads/dev`, the workflow is running an older definition. Re-run it after the branch includes the PR-based catalog update workflow.
- If PR creation fails, check the workflow token permissions include both `contents: write` and `pull-requests: write`.

### 3. API-backed tools return key setup instructions
Checks:
- Is Jules API key configured in dashboard settings?
- Is `.env` loaded with `JULES_API_KEY`?
- Is `.code-ux/settings.json` containing `julesApiKey`?
- Was settings save applied after editing dashboard value?

### 3a. Jules task stays at "Started jules dispatch"
Checks:
- Inspect the latest task run. If it has `dispatch_started` but no `session_created`, the provider session has not been created yet.
- Check for a long-running `docker run ... alpine/git fetch` child of `node dist/index.js`; Jules dispatch refreshes `origin` before calling the Jules API in remote git mode.
- HTTPS remotes should fail fast when credentials are missing. Code UX disables interactive Git credential prompts and bounds branch-preflight/fetch checks so orchestration settles instead of waiting indefinitely on a local credential helper. CLI-backed task dispatch still requires a remote refresh before branch preparation; when the starting branch is known, Code UX fetches that branch's remote-tracking ref instead of every branch on `origin`. Slow GitHub/GitLab smart HTTP connections can still take longer than 30 seconds, so the default fetch timeout is 120 seconds. Set `CODE_UX_GIT_FETCH_TIMEOUT_MS` higher when the network or remote regularly needs more time. Backend Git commands run inside the helper container unless host mode is explicitly enabled for diagnostics.
- For Jules dispatch, that local refresh is best-effort and a refresh failure should be logged without blocking Jules session creation.
- After a restart, active Jules dispatches that never reached `session_created` are treated as interrupted pre-session dispatches and moved back to a retryable task state. Jules dispatches with a persisted session remain attached for normal sprint recovery.
- If the dispatch fails with an auth error, fix the dashboard GitHub token or remote URL, then rerun the task.

### 4. Gemini/Codex task sessions fail immediately
Checks:
- Is the CLI installed and executable (`gemini`, `codex`)?
- Is auth available system-wide or via provider API key settings?
- Did child task branch creation succeed from feature branch?
- Are `git` and `gh` available in PATH for commit/push/PR steps?
- If `Settings -> CLI Workflow -> Execution Mode` is `Docker`:
  - Is Docker daemon available (`docker ps`)?
  - Is the configured image pullable/runnable?
  - If provider tools are not in the image, is a setup script configured, present at `.code-ux/container/setup.sh`, or available through the bundled Code UX default script?
  - If `Cache setup as image` is enabled, check session activity for cache hits or image-build failures before the worker command starts.
  - Check session activity for setup resolution details:
    - `Configured container setup script not found: ...`
    - `Using cached Docker setup image ...`
    - `Waiting for cached Docker setup image ... to finish building.`
    - `Building cached Docker setup image ...`
    - `Cached Docker setup image build failed ... Falling back to runtime setup script.`
  - Provider runner now falls back to installing missing provider CLI in-container before failing:
    - `gemini`: `npm install -g @google/gemini-cli`
    - `codex`: `npm install -g @openai/codex`
    - `claude`: `curl -fsSL https://claude.ai/install.sh | bash`
  - Claude runner executes headless using `claude -p "<prompt>" --dangerously-skip-permissions`.
  - For Claude auth mounts, ensure host has `~/.claude/.credentials.json`; if auth still stalls, also verify the sibling `~/.claude.json` exists when your local Claude login created it.
  - Runtime now syncs only those Claude auth files before launch, avoiding recursive copy of all `.claude` state.
  - For Gemini auth mounts, ensure host has `~/.gemini/settings.json` plus the expected auth files such as `oauth_creds.json`; runtime now syncs only those stable files and intentionally skips `.gemini/tmp`, `history`, and other mutable runtime trees.
  - Runtime merges generated Gemini and Claude MCP config into the copied auth settings, and appends the Codex MCP stanza into `~/.codex/config.toml` only when it is not already present, so enabling Docker auth mounts does not wipe host-side provider config.
  - Runtime strips local MCP declarations from copied provider auth/config files before merging generated MCP config. Only Code UX-managed MCP servers enabled on the MCP settings page, including the default Playwright server, are injected into Docker provider homes. For Codex this avoids duplicate `[mcp_servers.playwright]` tables when the host `~/.codex/config.toml` already defines Playwright.
  - Docker Runtime memory limits apply to every CLI provider container. `containerMemoryLimitMb` defaults to `6144`; positive values are passed as both Docker `--memory` and `--memory-swap`, while `0` omits those flags. If full-suite tests or browser-heavy validation hit the cap, raise this setting for the affected project or sprint instead of increasing provider concurrency.
  - For WORKER-profile routes, a saved worker model is only forwarded when it belongs to the selected provider. If you switch a planning or worker run from Codex to Gemini/Claude, Code UX now falls back to that provider's own model instead of sending an incompatible model id like `gpt-5.3-codex` to Gemini or Claude.
  - Codex websocket `HTTP 5xx` failures are transport/server errors, not auth failures. If you see `responses_websocket` + `HTTP error: 500`, treat that as a transient provider-side failure rather than a stale local login.
  - If auth is expected from host login state, is the relevant Docker auth mount enabled and is its mount path valid? Docker uses dedicated, isolated credential mounts per provider to keep raw tokens and key paths out of the broader workspace and process arguments.
  - Docker mode requires daemon-visible workspace paths. Runtime now prefers repo-scoped worktree paths for Docker sessions and mounts them as dedicated volumes alongside runtime volumes that hold provider home paths and package manager caches (`code-ux.workspace-runtime=true`).
  - Docker runtime state is stored under `~/.code-ux/runtime/docker/<repo-hash>/` by default (override with `JULES_DOCKER_RUNTIME_ROOT`). Cached setup image build contexts and build locks live under that root so setup-cache images survive dashboard restarts and concurrent post-restart jobs wait on the same build instead of starting duplicate builds.
  - Startup pruning clears orphaned helper containers, login containers, temp credential dirs, and stale workspace/runtime volumes that are no longer referenced by active tracking.
  - During normal Code UX shutdown (`SIGINT`, `SIGTERM`, `SIGHUP`, or Electron quit), the server requests active dispatch aborts, drains persistent Git/workspace helper pools (including helpers that were still starting), and then kills any still-running Docker containers with `code-ux.*` labels or deterministic `code-ux-*` runtime names. It does not remove Docker workspace/runtime volumes. On the next start, recovery follows `Settings -> General -> Restart Behavior`: continue resumes active sprint runs by default, pause/cancel applies sprint-level policy before watch-loop recovery, and invocation restart/cancel removes labelled active containers without deleting preserved volumes.
  - Pausing a sprint run also pauses or stops active task dispatch rows, cancels linked provider and QA runtime rows, releases task and sprint leases, and resets affected project tasks to `pending`. Resuming that run uses existing-run recovery and will not create a second sprint run.
  - Dashboard and MCP HTTP listeners track and destroy open sockets during shutdown, including upgraded dashboard WebSocket sockets, so open browser tabs do not delay process exit or leave ports bound during rapid restarts.
  - Docker workspace/runtime volumes for tracked CLI sessions are preserved across startup pruning after recovery marks the interrupted session `CANCELLED`; the next retry can still resume the old workspace volume when `Resume failed task in same workspace` is enabled.
  - Rerun resume uses the latest `cli_workspace_bound` event as the source of truth for the workspace session id. If the latest interrupted provider invocation has a different `session_id`, Code UX still resumes the Docker volume named by the recorded workspace binding.
  - Codex uses per-session container home directories under that runtime root to prevent stale state from previous Codex runs.
  - `RuntimeCleanupService` performs a periodic sweep for stale/offline connections, expired leases, terminal dispatch reconciliation, stale sprint runs, and runtime artifacts.
- During shutdown, Code UX disposes the command-spawner host before Docker cleanup (`DockerRuntimePruneService` and `DockerAssetPruneService`). `DockerRuntimePruneService` safely prunes stale per-runtime paths and shared temp paths after their age threshold while preserving active roots/Codex homes. `DockerAssetPruneService` cleans up orphaned workspace volumes, login containers, helper containers, and temporary credential directories on startup. Workspace volume helpers use `code-ux.managed=true` and `code-ux.helper=volume` on both persistent helpers and `docker run --rm` fallback helpers. Do not instruct operators to run broad manual `docker system prune` commands.
- Docker provider launches use readable container names such as `code-ux-codex-<session>` and mount provider arguments through a generated argv file instead of passing the full prompt through the host `docker run` command line. Secret-bearing provider environment variables are written to temporary `0600` env-files and supplied with `--env-file`, so `ps`/process-list inspection should show only the env-file path and not API key values. If Docker reports that the deterministic provider container name is already in use, Code UX force-removes that named container with volumes and retries the launch once; repeated conflicts usually mean an external Docker daemon or another runtime is recreating the same session container. Packaged Windows Electron builds that fail with `spawn ENAMETOOLONG` during provider launch are using an older build or a non-provider launch path that still embeds a large payload in command arguments.
- When setup-image caching is enabled, the first Docker provider or preview run for a base image/setup-script combination may spend several minutes building a content-addressed `code-ux-setup-cache-*` image. Activity logs now call out the cache miss, stream Docker build steps, and report bounded progress; later runs reuse the cached image until the base image, setup script content, Dockerfile template, or Playwright-browser setting changes. If Playwright preinstall is enabled, the cached image stores Chromium under `/ms-playwright` and exposes `PLAYWRIGHT_BROWSERS_PATH` so non-root provider runs can use the baked browser without rerunning setup. If the build fails, Code UX logs the fallback and runs the setup script at container runtime instead.
- Provider login uses a separate content-addressed `code-ux-login-base-node-24-bookworm-slim:*` image with curl and keyring prerequisites baked in. The image is prewarmed after dashboard logging is available, but this is best-effort: failures should be treated as startup warnings, not as a reason to block the dashboard or provider login.
- Backend Git commands and snapshot workspace bootstrap use public helper images such as `alpine/git`. Snapshot bootstrap verifies or pulls these helpers automatically, and if Docker reports a broken host credential helper while pulling a public helper image, Code UX retries that helper pull with an isolated empty Docker client config; provider/container images still use the normal Docker configuration. Persistent helper containers are removed with `docker rm -f -v` so image-declared anonymous volumes are cleaned with the container. Startup Docker pruning is scheduled in the background and only queries Code UX labels, so a large Docker daemon does not delay dashboard boot with full volume/container scans.
- Snapshot workspace bootstrap creates the temporary Git bundle through the containerized Git helper using a portable `/mnt/code-ux/git-paths/*` target, then streams the bundle directly into `docker run` stdin. Packaged Windows Electron builds should not route `C:\...AppData\Local\Temp\code-ux-bundle-*` paths through `bash -lc` or use those paths as Docker mount targets; seeing `cat: 'C:\...\repo.bundle': No such file or directory` or `invalid mount path: 'C:/Users/.../code-ux-bundle-*'` indicates an older build.
- Packaged Windows Electron runs use an opaque desktop window to avoid Chromium tile-memory exhaustion (`tile_manager.cc:1012 WARNING: tile memory limits exceeded`). All animated backgrounds, patterns, and images render normally. Performance mitigations are applied at the WebGL layer (0.5× render scale, `powerPreference: "low-power"`, `contain: strict` on background layers, Chromium `--force-gpu-mem-available-mb` flag).
- If a Git URL project reports "No file changes produced" even though the provider edited files, verify the project `baseDir` is an exact Git checkout root. New Git URL projects are cloned to `~/.code-ux/projects/<repo-name>` by default; older relative paths nested under the Code UX repo should be re-added or updated to the real clone path.
- Relative local project paths are resolved against the user home directory, not the Code UX process working directory. A local project created with `myproject` now stores `baseDir` as `<homedir>/myproject`, and a relative Git `cloneDir` is normalized the same way before the repo name is appended.
- GitHub credential sync still copies mount contents into a fixed dir (`~/.config/gh`); Gemini sync is now auth-only to avoid concurrent Docker sessions racing on shared `.gemini/tmp/tool-outputs`.
- If provider output says "No file changes produced", runtime now still checks for unpushed worker-branch commits and will push/create (or reuse) the feature PR when commits exist.
- CI autofix and merge-conflict virtual-worker runs now perform the same unpublished-commit check before they mark the attention item resolved, so provider-created local commits are pushed to GitHub even when the workspace diff is empty by the end of the run. Merge-conflict publish also retries killed no-output `git push` attempts after the resolved commit has been materialized locally, preventing a transient helper/container termination from turning a valid resolution into a human handoff.
- Workspace patch export includes newly created untracked files by marking them in a temporary Git index before diffing. In Docker mode, Git-specific environment variables are forwarded into the helper container so the temporary index and HTTP auth config are applied inside the isolated workspace volume. Provider HOME lives in the paired runtime volume at `/code-ux-runtime-home`, outside `/workspace`; patch export still excludes the transient `.task-learnings.md`, legacy `.code-ux-home/`, root `.pnpm-store/`, and the entire `logs/openai/` directory (including nested logs) so memory capture, provider config, package-manager cache state, provider cache state, and transient OpenAI request/response logs cannot be committed. Export staging asks Git to discover untracked files with `git ls-files -z` and feeds them back through `git add --pathspec-from-file=- --pathspec-file-nul`, so large legitimate untracked file sets do not cross Docker or OS argument limits.
- For Docker-in-Docker or remote daemon path mismatches, configure:
    - `JULES_DOCKER_HOST_WORKSPACE_ROOT=<host-visible-repo-root>`
    - `JULES_DOCKER_HOST_HOME_ROOT=<host-visible-home-root>` (optional, for auth mounts)
- If logs show `Error executing tool read_file: File not found`, verify the retry setting:
  - `Settings -> CLI Workflow -> Retry once on read_file not found`
- If you need post-failure recovery work, keep failed worktrees:
  - `Settings -> CLI Workflow -> Cleanup worktree on failure` should remain disabled (recommended default).
- To continue retries in the same failed workspace:
  - `Settings -> CLI Workflow -> Resume failed task in same workspace` should remain enabled (default).
- Dashboard **Resume** for a paused sprint run reactivates that same run and starts the recovery/watch-loop path in place. It should not create a replacement sprint run or a second watch loop. If the old loop is still draining, resume schedules a short follow-up recovery attempt after the registry clears so a run is not left `running` without a heartbeat.
- Sprint deletion is rejected while the sprint has any queued/running/cancel-pending sprint run, active task dispatch, running provider/execution invocation, preserved invocation transcript, or a sprint run that finished in the last 30 seconds. Cancel, pause, or let runtime cleanup (`RuntimeCleanupService`) settle first; this prevents database cascades from deleting rows while an in-memory watch loop or provider callback is still unwinding.
- To clean up stale workspace branches that were merged or closed on origin, use `BranchReaperService` logic via the dashboard.
- `RuntimeStartupRecoveryService` closes active dispatch/task-run rows whose linked provider invocation already reached a terminal state. It reconciles persisted/runtime state after restart and cleans or marks stale execution artifacts according to service behavior. If the project task is already code-complete, the dispatch mirrors completion; otherwise the task is reset to pending for a clean retry instead of staying in a stale running state.
- Live provider telemetry refreshes the linked task-dispatch heartbeat (`HeartbeatService`) while the provider invocation is running. `HeartbeatService` acts to renew sprint-run heartbeat/lease on an interval and stops tracking when renewal fails. It is for liveness and lease maintenance, not a cleanup command. A dispatch heartbeat should not go stale when provider usage rows are still updating.
- In local-git mode, an existing worker-owned main-merge conflict attention item suppresses additional `feature -> default` merge attempts while the worker is resolving the conflict. Human-escalated main-merge attention pauses the sprint with local conflict instructions.

### 5. Planning retry message appears but no provider work is visible
Checks:
- A system message like "Retrying JSON parse in same <Provider> session..." indicates a parsing failure and a virtual planning JSON retry. If no new provider invocation record or response follows:
- Verify your Execution Mode (`Settings -> CLI Workflow -> Execution Mode`). If it's set to `DOCKER`:
  - Check whether Docker is running (`docker ps`).
  - Verify container settings (`Settings -> CLI Workflow`) like `Container setup script path` and `Container image` to ensure the container can launch properly.
  - Review dashboard server logs for container launch or permission errors that might have abruptly stopped the provider execution before a usage record could be created.
- If it's `HOST`:
  - Check if the provider CLI is still available and functioning on the host machine.
- Verify provider API keys or auth mounts are correct and the provider service is not experiencing downtime.

### 6. Restart or continue a failed/cancelled planning invocation
Checks:
- Open Chat -> Invocations, select the failed or cancelled planning invocation, then choose one of the header actions.
- **Restart** marks the original terminal transcript as preserved, creates a replacement invocation row, resumes the terminal provider session, and sends the full planning prompt again.
- **Continue** marks the original terminal transcript as preserved, creates a replacement invocation row, resumes the terminal provider session, and sends a continuation prompt that also embeds the original planning instructions so the run can still complete if the provider has lost the native conversation.
- Docker-backed planning runs use a stable project/sprint planning workspace and preserve the paired runtime volume while the run is failed, cancelled, or incomplete. Restart and Continue reuse that workspace so provider-local session files, caches, and runtime state remain available across quota/auth failures and operator cancellations. Fresh planning invocations in `REMOTE` git mode still refresh `origin` and build a new snapshot from `origin/<branch>`, using the explicit sprint feature branch when present or the effective runtime git default branch otherwise, so new planner runs do not start from a stale local branch or the host repo's current checkout. Successful planning cleans up the workspace and paired runtime volume.
- The same remote-only workspace policy applies to fresh Docker-backed provider invocations outside planning, including task coding, QA review/follow-up, CI autofix, merge-conflict repair, dashboard/chat replies, worker inbox replies, project setup, and node-flow provider prompts. These fresh invocations materialize from explicit `origin/<branch>` refs in `REMOTE` mode. `InvocationWorkspacePreparer` owns the shared snapshot/git-policy/lifecycle builder and continuation workspace resolver, so restart/continue/fresh materialization policy is not reimplemented per invocation path. Continuation/restart flows may reuse preserved workspaces, but if Code UX must recreate a missing workspace it applies the same remote-only materialization rules.
- Preserved sprint-scoped invocation rows block sprint deletion so the quota/error transcript is not removed by a cascade.
- If the restart or continuation fails, retry from the original failed row or inspect the new failed row depending on which invocation produced the latest error.

### 6a. Cancel a running invocation
Checks:
- Open Chat -> Invocations, select any running invocation, then choose **Cancel** in the detail header.
- Cancellation requests the active dispatch stop hook when the invocation is tied to task execution.
- For Docker-backed provider runs, Code UX locates containers with the `code-ux.session-id` label from the linked provider/task runtime and kills them directly.
- The execution invocation and linked provider usage row are marked `cancelled`, and a system message is appended to the transcript with the stopped Docker container ids when any were found.
- If the backing provider process reports a late error while unwinding, the cancelled invocation remains cancelled instead of being overwritten as failed.

### 7. Orchestration stuck with blocked tasks
Checks:
- Are dependencies in final `completed`, or in `coding_completed` with no remaining merge work?
- Any action-required session states (`AWAITING_*`, `PAUSED`)?
- Is merge protocol disabled in step toggles?
- For CLI-backed tasks, inspect the latest dispatch error. Code UX now treats unrecoverable Git auth/config failures as hard blockers instead of retryable failures.
  - Examples: unset GitHub token, `fatal: could not read Username for 'https://github.com'`, `Authentication failed`, or similar remote permission/auth errors during push/PR flow.
  - Expected behavior: the task run moves to `BLOCKED`, the sprint pauses, and the watch loop stops consuming tokens until credentials are fixed and the task or sprint is resumed manually.
- For tasks shown as `QUOTA`, inspect the dispatch error and retry-after metadata. Code UX preserves quota/rate-limit dispatch errors during session sync; exact Codex reset hints are honored when the provider returns a concrete reset time, while ambiguous clock-only hints fall back to a bounded 30-minute retry. The active retry timestamp is surfaced through execution invocation rows, system messages, and `cli_provider_quota_wait` task-run events; if no active retry timestamp remains, the task is requeued instead of staying in `QUOTA`. Cancelling a task-backed quota invocation from Chat -> Invocations closes the linked dispatch as `cancelled`, marks the task run with the retryable blocked sentinel, resets the project task to `pending`, and the next sprint cycle can dispatch it again with the current provider routing. If Code UX was offline while a provider invocation was waiting for a quota reset or rate-limit retry, startup recovery closes that stale running invocation as `cancelled` and requeues task-backed work so the recovered sprint loop can start a fresh continuation. Repeated quota failures without a reset timer are still bounded by `cliWorkflow.maxQuotaRetriesWithoutTimer`.
- To retry before the provider reset timestamp, open Chat -> Invocations and use **Reset timer** on the active quota/rate-limit invocation. This clears the invocation retry timestamp, records an audit message, and wakes the active provider retry loop so the same invocation can retry immediately.
- For tasks stuck in a CI/QA gate after QA requested fixes, compare the latest `qa_review_runs` row with later `execution_invocations` for the same task run. A completed `cli_task_followup` after the latest `changes_requested` QA result should trigger a verification QA run on the next orchestration cycle; if no follow-up exists, the task is intentionally waiting on fix work or human intervention.
- When a task has multiple QA reviewers configured, inspect all `qa_review_runs` rows for the latest `run_index`, not just one row. The task remains blocked if any reviewer row in that cycle is `running`, `failed`, or `completed` with `changes_requested`; the cycle clears only when every reviewer row passed. Reviewer-specific `agent_preset_id`, `agent_name`, and payload fields identify which reviewer blocked the cycle.
- For tasks stuck at `CODING_COMPLETED` with merge indicator `CI`, inspect the feature PR checks. Completed failed checks should move the task back to `RUNNING` and open a worker-owned `ci_fix_required` item until the CI-fix guardrail is reached. The `waitForJulesCiAutofix` toggle only controls whether Code UX first sends failed-check context to an existing Jules session; when it is disabled, Code UX should skip Jules and dispatch a worker CI fix instead. Human/agent intervention should appear only after the guardrail is exhausted.
- Do not treat a later full task run as task-QA follow-up work. Task QA fixes should continue the same task session and branch through `cli_task_followup`; sprint-review failures create follow-up tasks instead.
- For tasks showing `QA_PENDING` with a `running` `qa_review_runs` row but no matching provider container, check the latest `qa_review` row in `execution_invocations`. Code UX now fails stale running QA rows automatically when the invocation never linked provider runtime or when its Docker-backed `provider_invocations.session_id` is absent from running `code-ux.session-id` container labels; the next cycle should enqueue a fresh QA review.
- For Jules-backed tasks stuck in `RUNNING`, compare the recorded task session with the live Jules API. If the session is absent from both the list snapshot and a direct `getSession` lookup returns not found, session sync now fails the stale provider/execution/task-run rows and requeues the task when failed-task retry is enabled.
- If local state is terminal but the provider still reports the session as running, session sync treats it as a stale running session and keeps polling so renewed provider work can reactivate the task. If the list snapshot is stale but the recorded provider session fetch returns a terminal state, session sync maps that recovered terminal state through the normal provider-state mapping and completes or fails the local run consistently.
- If provider concurrency repeatedly logs that the cap is reached but no provider containers are running, inspect `provider_invocations` for old `status = running` rows. Code UX reconciles stale rows during provider slot waits and startup so orphaned provider slots do not permanently hold capacity. Docker-backed task-coding rows first consult their linked task run and dispatch: completed linked work releases the provider slot as `completed`, recently heartbeating dispatches stay active, and only genuinely idle/orphaned rows are failed for retry. This avoids misclassifying successful short-lived Docker CLI work as failed while still freeing abandoned slots.

### 8. Tasks completed but pipeline not progressing
Checks:
- Does the DB task record still show `coding_completed` because a feature PR or worker branch is still unresolved?
- Did the merge settle on the feature branch, or was this a no-output task that should auto-promote to final `completed`?
- Are CI / review gates still intentionally holding the task before final completion?
- If QA requested changes and the provider completed a same-session follow-up, Code UX should treat that `cli_task_followup` as fresh work even when the task run itself did not get a newer `finished_at` timestamp.
- QA budgets are counted by review cycle (`run_index`), not by the number of configured reviewers. Multiple reviewer rows in one cycle should not exhaust task or sprint QA budget by themselves.
- If task QA exhausted its review budget and no same-session follow-up is waiting for verification, the configured exhaustion policy applies. For new or unset policies, the default `FINISH_TASK` policy marks the task completed despite no QA pass; projects can still opt into `FAIL_TASK` or `ESCALATE_TO_HUMAN` when they need stricter handling.
- A task already parked in `QA_REVIEW_FAILED` should not start new automatic worker branches on later watch-loop cycles. If it does, inspect status derivation and task rerun/reset events; only explicit rerun/reset should move the task back to pending.
- If QA still appears running but no QA container exists, the watch loop should reconcile the stale QA invocation and retry the review rather than leaving `merge_indicator = QA_PENDING`.
- For sprint completion blocked by QA, inspect all latest-cycle `trigger_type = 'sprint_completion'` rows. The sprint can complete only when every configured sprint reviewer in that cycle passed; any running, failed, or changes-requested reviewer keeps completion blocked.
- If the provider session actually ended `FAILED`, Code UX should now clear the stale session/PR runtime state and requeue the task instead of treating the task as completed just because a PR artifact exists.

### 9. Tasks show RUNNING after MCP was interrupted
Symptoms:
- Old activity logs keep appearing.
- New orchestration cycles do not start fresh background CLI runs.

Checks:
- Restart MCP once to trigger startup recovery.
- Verify startup logs for a recovery line:
  - `Recovered runtime state on startup`
- Verify the affected sprint run returns to active monitoring without creating a brand-new sprint run record.

### 8a. Task shows a provider session or PR from another project/sprint
Symptoms:
- A task is marked `CODING_COMPLETED` with a PR that targets an unrelated feature branch.
- The task provider does not match the selected sprint's routing settings.
- The same `session_id` or `pr_url` appears under another project, sprint, or task in `task_runs`.

Checks:
- Query the local app database for the session or PR:
  - `SELECT tr.*, p.name, s.name, t.task_key, t.title FROM task_runs tr JOIN projects p ON p.id = tr.project_id JOIN sprints s ON s.id = tr.sprint_id JOIN tasks t ON t.id = tr.task_id WHERE tr.session_id = '<session>' OR tr.pr_url = '<pr-url>';`
- If more than one project/sprint/task owns the same session or PR, keep the original owner and clear the duplicate task run before rerunning the affected task.
- Current runtime sync rejects foreign session and PR artifacts before persisting them. If the duplicate row predates that guard, remove the duplicate `task_runs` row, reset the affected `tasks.status` to `pending`, clear merge flags, restart the dashboard server, then rerun the task.


### Transient Provider Failures
Transient provider failures are classified and managed in `src/shared/providers/provider-error-classifier.ts`. These shared helpers encapsulate the operational meaning of failures such as:
- **Codex transport errors**: Disconnections or channel closures (e.g., "stream disconnected before completion", "channel closed").
- **Claude missing conversations**: Attempts to resume a non-existent session resulting in "no conversation found". Code UX retries once with a fresh Claude session; planning continuations are self-contained so that fallback still has the original schema, sprint goal, and task-generation instructions.
- **OpenCode missing sessions**: Attempts to resume a removed native session resulting in "Session not found"; Code UX retries once as a fresh OpenCode session in the same workspace.
- **Silent quota signals**: Provider tools (like Antigravity) failing due to capacity limits without explicit failure output.

## Recovery Techniques

- Temporarily disable selected loop steps for diagnosis.
- Startup recovery is orchestrated centrally by `RuntimeStartupRecoveryService`. It handles reconciliation for interrupted CLI sessions, local/provider dispatches, retry waits, QA review runs, orphaned provider invocations, terminal dispatches, interrupted task runs, stale paused sprints, and recoverable sprint runs. Recovered-state logging surfaces these distinct outcomes to the dashboard.
- Use the dashboard live view to inspect state without starting new work.
- Use activities APIs to inspect detailed session trace.
- Re-enable steps after diagnosis to restore normal operation.
- On startup, interrupted local CLI sessions (`cli-*` with `RUNNING`) are auto-recovered to `CANCELLED` so invocation error-rate statistics do not treat app shutdown/restart as provider failure.
- On startup, active `queued` and `running` sprint runs are resumed automatically in place by default; Code UX restores the watch loop instead of requiring a manual sprint restart. Operators can change `Settings -> General -> Restart Behavior -> After app restart` to pause or cancel active runs before recovery resumes anything.
- `Settings -> General -> Restart Behavior -> Interrupted invocations` controls active/interrupted provider rows when sprint continuation is enabled: `Continue` preserves live labelled containers, `Restart` stops labelled containers without removing preserved volumes and requeues task-backed work, and `Cancel` stops labelled containers without automatic retry.
- If the dashboard shows a sprint as running after its latest run was paused, restart recovery should sync the parent sprint projection back to `paused` as long as there is no newer queued/running/cancel-pending run for the same sprint.
- If the dashboard shows a sprint as running but no queued/running/cancel-pending sprint run exists, restart recovery should repair the parent sprint projection from the latest run, or back to `idle` when no run exists.
- Startup recovery does not steal an unexpired sprint lease when the recorded `sprint_orchestrator:<pid>` owner is still alive. This prevents a second dashboard process from creating a duplicate watch loop for work another live process already owns.
- Manual dashboard resume uses the same existing-run recovery path as startup recovery, so paused runs keep their original run id and heartbeat history when monitoring restarts.
- Startup recovery also cancels older duplicate active dispatch rows for the same `(sprint_run_id, task_id)`, keeping the newest active dispatch and cancelling linked provider runtime rows for the duplicates. Live dispatch has the same guard before creating a new task dispatch, so repeated watch-loop cycles remain idempotent after restarts or lease drift.
- Dashboard sprint cancellation force-closes active task dispatch rows, task runs, and task status after the provider containers are stopped. Late provider callbacks from an already-cancelled sprint are ignored so cancelled work cannot revive stale `running` dispatch state.
- Local `docker_cli` task invocations and dispatches are closed as `cancelled` during that recovery, while the task itself is moved back to a retryable state. Durable Jules sessions and connected-worker dispatches remain attached to the resumed sprint run.
- If a restart finds active Jules task runs with persisted session ids but their sprint run was left `failed` or `cancelled` while the sprint is still active, startup recovery rehydrates a single sprint run, moves those durable Jules rows onto it, reopens their dispatch/provider runtime links, and resumes monitoring.
- Failed CLI sessions can preserve their worktree for manual follow-up or assisted retry, based on CLI Workflow settings.
- Dashboard task reruns now support a full clean reset:
  - the selected task always clears session, PR, merge, and intervention state before restart
  - normal reruns pass the previous CLI workspace binding into the next dispatch so the provider can continue from the same workspace when it still exists, even if restart recovery recorded a newer cancelled/interrupted provider session id
  - selecting **Clear worktree** removes the previous workspace using the active CLI execution mode and suppresses workspace resume, forcing a new workspace for the rerun
  - provider overrides target the exact provider instance from **Settings -> Integrations** and may include a model override, so reruns can switch between multiple logins/configs for the same provider type
  - optional downstream reset rewrites dependent tasks to fresh pending execution snapshots so old completed/running descendants do not keep stale runtime metadata
  - if a task already merged code, operators can check the **Undo the Git merge** option to automatically revert the merge commit programmatically in the feature branch before restarting the task cleanly.

### 10. Accidentally Exposed Dashboard or MCP Endpoints
Symptoms:
- Unexpected or unauthorized activities appearing in the dashboard logs.
- Connections originating from unknown IP addresses.

Failure Modes & Rollback Notes:
- **Failure Mode**: By default, Code UX binds only to the loopback interface (`127.0.0.1`). If bound to `0.0.0.0` without external authentication, any user on the network can execute arbitrary commands on the host machine.
- **Rollback / Recovery**:
  1. Immediately terminate the Code UX server process.
  2. Verify the configuration `HOST` or bind settings to ensure it restricts to `127.0.0.1`.
  3. Review the `ExecutionInvocations` logs to identify any unauthorized commands executed.
  4. If exposing Code UX to the network is required, **front it with a reverse proxy** (e.g., Nginx, Traefik, Caddy) that enforces authentication (such as Basic Auth, mTLS, or an OAuth proxy).
  5. For the MCP HTTP gateway, ensure a bearer token is active when binding beyond loopback. Code UX auto-generates one in `~/.code-ux/security.json`; explicit deployments can still use `--mcp-http-auth-token` or the legacy `--mcp-https-auth-token` flag.

### Subprocess Execution Limits

Subprocess execution restricts accumulated `stdout` (default 5MB) and `stderr` (default 4KB) memory growth by slicing long outputs and prepending `"..."`. Streaming callbacks (e.g., `onStdoutLine`, `onStderrLine`) still process the full, untruncated line output regardless of this cap, avoiding memory bloat while preserving line-by-line inspection. These bounds can be overridden via `maxStdoutChars` and `maxStderrChars` in command options.

## Useful Commands

```bash
pnpm test
pnpm run build
curl http://localhost:4444/api/status
curl http://localhost:4444/api/git-status
```

## CI And E2E Operations

GitHub validation is split by signal:
- `CI` runs `Typecheck & Lint`, `Backend Tests & Coverage`, `Dashboard Tests`, `Build`, and `Security Audit` on Node 22 with pnpm 10.33.0. It runs on pushes to `main` and `dev`, and on pull requests targeting any branch.
- `Playwright Tests` runs browser E2E validation on pushes and pull requests targeting `main`. This keeps the heavyweight OS-matrix lane on the release path while `dev` remains gated by core CI. Release and publish workflows remain separate from CI/E2E validation.
- `Release Checks` runs no-secret release validation on pull requests targeting `main` and manual dispatches. It remains separate from core CI and Playwright so desktop packaging or release-install failures do not hide test, audit, or browser failures.
- Superseded runs for the same branch or pull request are cancelled by workflow concurrency groups.
- Security validation is intentionally separated from build and Playwright lanes. The `Security Audit` job runs `pnpm run audit`, which is `pnpm audit --audit-level=high`; high-severity dependency findings fail that job without preventing typecheck, tests, build, or Playwright artifacts from reporting their own status.

Local equivalents:
- `pnpm run lint` mirrors the TypeScript validation portion of `Typecheck & Lint`.
- `pnpm run test:backend:coverage` mirrors the backend coverage job.
- `pnpm run test:dashboard` mirrors the dashboard Vitest job.
- `pnpm run audit` mirrors the independent security audit job.
- `pnpm run build` validates the compiled server and dashboard bundle.
- `pnpm run build` followed by `pnpm run test:e2e` runs the browser E2E suite locally against the compiled app after dependencies and Playwright browsers are installed. The wrapper delegates to `pnpm exec playwright test` after choosing isolated local ports.
- `node scripts/verify-release-install.mjs` mirrors the release install smoke check before Electron packaging.

Dependency and cache behavior:
- CI restores `node_modules` only as a speed hint and still runs `pnpm install --frozen-lockfile --ignore-scripts` in every job.
- Vitest, Vite, TypeScript, Playwright browser, and release-check caches are keyed to the runner OS, Node 22, pnpm 10.33.0, and dependency/config files that affect the cached output.
- Playwright restores the browser cache before running `pnpm exec playwright install chromium`; Linux runners also run `pnpm exec playwright install-deps chromium` so cached browser binaries cannot hide missing OS dependencies.
- The Build and Playwright jobs do not cache `.cache/tsc`; those jobs must emit a fresh `dist/` tree for package output and the E2E web server.
- `tests/backend/ci/workflow-health.test.ts` audits these workflow invariants so accidental drift in package manager version, Node version, install mode, cache keys, audit separation, concurrency cancellation, Playwright artifacts, or release-lane separation fails a focused backend test.

Artifacts:
- On Playwright failure, download the `playwright-artifacts` artifact from the workflow run. It contains `test-results/` traces/screenshots/videos when produced and `playwright-report/` for the HTML report.
- The artifact retention window is seven days. If no files were produced, artifact upload is allowed to continue without masking the original test failure.

## Escalation Notes

When reporting issues include:
- Action used (`plan`, `status`, `orchestrate`)
- Sprint number and feature branch
- Relevant dashboard warnings
- Latest protocol instructions
- Any recent settings changes
