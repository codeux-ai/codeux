# Operations Runbook

This runbook covers day-to-day operation and incident handling for the MCP server and dashboard.

## Normal Startup Procedure

1. Confirm API key source is available (recommended, but startup is allowed without key).
2. Start server (`npm run dev` or `npm start`).
   - `npm run dev` runs the TypeScript entrypoint through Node's `ts-node` ESM register hook.
3. Open dashboard and verify settings.
4. Confirm `/api/status` and `/api/git-status` are responding.

If started without key:
- Configure `JULES_API_KEY` in `.env`, or `julesApiKey` in `.jules-subagents/settings.json`, or set it in dashboard settings.
- Retry API-backed commands after configuration.
- Dashboard key fields can stay empty when system-wide environment keys are already present.

## Sprint Execution Procedure

1. Verify the repo is a healthy git checkout. Code UX now prepares the local feature branch automatically on orchestration start and will try to push it to `origin` when that remote exists.
2. Create or verify sprint tasks in the dashboard, or import them from markdown when needed.
3. Ensure at least one worker is connected through `listen` for the project when you want supervised execution.
4. Start the sprint from the dashboard.
5. Follow merge and action-required protocol until terminal state, resuming from the dashboard after manual intervention.

## Safety Controls

### Emergency stop
If consecutive task creation failures reach threshold:
- New task creation stops.
- Review credentials, source ID, branch state, Jules API availability.
- Re-run after corrective actions.

### Preflight blockers
- Branch preflight blocker means Code UX could not prepare the local feature branch, or it could not push the branch to `origin` on a repo that expects a remote feature branch.
- Planning preflight blocker means subtask files are missing.

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
- If the dashboard still degrades under load, inspect whether debug file logging is enabled; file logging now uses async streams, but sustained log volume is still a useful signal that a hot loop is too noisy.

### 2. No PR/CI data in remote mode
Checks:
- `gh --version`
- `gh auth status`
- Token availability in settings/env
- If a CLI task pushed code but cannot create a PR, the run now fails instead of completing as "without PR" while auto-create PRs are enabled. When a GitHub/GitLab token is configured, Code UX creates and finds PRs/MRs through the host API and does not require `gh` or `glab` on the machine.
- If no GitHub/GitLab token is configured, PR creation falls back to the local host CLI (`gh`/`glab`), so Windows packaged builds need that CLI on the server process `PATH` and authenticated.
- "Workflow completed without PR" is only expected when `git.autoCreatePr` is disabled for the resolved system/project/sprint settings.

### 3. API-backed tools return key setup instructions
Checks:
- Is Jules API key configured in dashboard settings?
- Is `.env` loaded with `JULES_API_KEY`?
- Is `.jules-subagents/settings.json` containing `julesApiKey`?
- Was settings save applied after editing dashboard value?

### 3a. Jules task stays at "Started jules dispatch"
Checks:
- Inspect the latest task run. If it has `dispatch_started` but no `session_created`, the provider session has not been created yet.
- Check for a long-running `git fetch` child of `node dist/index.js`; Jules dispatch refreshes `origin` before calling the Jules API in remote git mode.
- HTTPS remotes should fail fast when credentials are missing. Code UX disables interactive Git credential prompts and bounds branch-preflight/fetch checks so orchestration settles instead of waiting indefinitely on a local credential helper. CLI-backed task dispatch still requires a remote refresh before branch preparation; when the starting branch is known, Code UX fetches that branch's remote-tracking ref instead of every branch on `origin`. Slow GitHub/GitLab smart HTTP connections can still take longer than 30 seconds, so the default fetch timeout is 120 seconds. Set `CODE_UX_GIT_FETCH_TIMEOUT_MS` higher when the network or remote regularly needs more time.
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
  - For WORKER-profile routes, a saved worker model is only forwarded when it belongs to the selected provider. If you switch a planning or worker run from Codex to Gemini/Claude, Code UX now falls back to that provider's own model instead of sending an incompatible model id like `gpt-5.3-codex` to Gemini or Claude.
  - Codex websocket `HTTP 5xx` failures are transport/server errors, not auth failures. If you see `responses_websocket` + `HTTP error: 500`, treat that as a transient provider-side failure rather than a stale local login.
  - If auth is expected from host login state, is the relevant Docker auth mount enabled and is its mount path valid?
  - Docker mode requires daemon-visible workspace paths. Runtime now prefers repo-scoped worktree paths for Docker sessions.
  - Docker runtime state is stored under `~/.code-ux/runtime/docker/<repo-hash>/` by default (override with `JULES_DOCKER_RUNTIME_ROOT`).
  - Codex uses per-session container home directories under that runtime root to prevent stale state from previous Codex runs.
  - Runtime cleanup prunes stale `home-codex-*` session homes and stale shared runtime temp directories automatically once those sessions are no longer active.
- Docker provider launches mount provider arguments through a generated argv file instead of passing the full prompt through the host `docker run` command line. Packaged Windows Electron builds that fail with `spawn ENAMETOOLONG` during provider launch are using an older build or a non-provider launch path that still embeds a large payload in command arguments.
- Snapshot workspace bootstrap pulls public helper images such as `alpine/git` automatically. If Docker reports a broken host credential helper while pulling a public helper image, Code UX retries that helper pull with an isolated empty Docker client config; provider/container images still use the normal Docker configuration.
- Snapshot workspace bootstrap streams the temporary Git bundle directly into `docker run` stdin. Packaged Windows Electron builds should not route `C:\...AppData\Local\Temp\code-ux-bundle-*` paths through `bash -lc`; seeing `cat: 'C:\...\repo.bundle': No such file or directory` indicates an older build.
- Packaged Windows Electron runs use an opaque desktop window to avoid Chromium tile-memory exhaustion (`tile_manager.cc:1012 WARNING: tile memory limits exceeded`). All animated backgrounds, patterns, and images render normally. Performance mitigations are applied at the WebGL layer (0.5× render scale, `powerPreference: "low-power"`, `contain: strict` on background layers, Chromium `--force-gpu-mem-available-mb` flag).
- If a Git URL project reports "No file changes produced" even though the provider edited files, verify the project `baseDir` is an exact Git checkout root. New Git URL projects are cloned to `~/.code-ux/projects/<repo-name>` by default; older relative paths nested under the Code UX repo should be re-added or updated to the real clone path.
- GitHub credential sync still copies mount contents into a fixed dir (`~/.config/gh`); Gemini sync is now auth-only to avoid concurrent Docker sessions racing on shared `.gemini/tmp/tool-outputs`.
- If provider output says "No file changes produced", runtime now still checks for unpushed worker-branch commits and will push/create (or reuse) the feature PR when commits exist.
- CI autofix and merge-conflict virtual-worker runs now perform the same unpublished-commit check before they mark the attention item resolved, so provider-created local commits are pushed to GitHub even when the workspace diff is empty by the end of the run.
- Workspace patch export includes newly created untracked files by marking them in a temporary Git index before diffing. In Docker mode, Git-specific environment variables are forwarded into the helper container so the temporary index and HTTP auth config are applied inside the isolated volume. The transient `.task-learnings.md` memory file and isolated provider home at `.code-ux-home/` are excluded from the exported patch so memory capture, provider config, and provider cache state cannot be committed.
- For Docker-in-Docker or remote daemon path mismatches, configure:
    - `JULES_DOCKER_HOST_WORKSPACE_ROOT=<host-visible-repo-root>`
    - `JULES_DOCKER_HOST_HOME_ROOT=<host-visible-home-root>` (optional, for auth mounts)
- If logs show `Error executing tool read_file: File not found`, verify the retry setting:
  - `Settings -> CLI Workflow -> Retry once on read_file not found`
- If you need post-failure recovery work, keep failed worktrees:
  - `Settings -> CLI Workflow -> Cleanup worktree on failure` should remain disabled (recommended default).
- To continue retries in the same failed workspace:
  - `Settings -> CLI Workflow -> Resume failed task in same workspace` should remain enabled (default).

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

### 6. Orchestration stuck with blocked tasks
Checks:
- Are dependencies in final `completed`, or in `coding_completed` with no remaining merge work?
- Any action-required session states (`AWAITING_*`, `PAUSED`)?
- Is merge protocol disabled in step toggles?
- For CLI-backed tasks, inspect the latest dispatch error. Code UX now treats unrecoverable Git auth/config failures as hard blockers instead of retryable failures.
  - Examples: unset GitHub token, `fatal: could not read Username for 'https://github.com'`, `Authentication failed`, or similar remote permission/auth errors during push/PR flow.
  - Expected behavior: the task run moves to `BLOCKED`, the sprint pauses, and the watch loop stops consuming tokens until credentials are fixed and the task or sprint is resumed manually.
- For tasks shown as `QUOTA`, inspect the dispatch error and retry-after metadata. Code UX preserves quota/rate-limit dispatch errors during session sync; if no active retry timestamp remains, the task is requeued instead of staying in `QUOTA`. If Code UX was offline while a provider invocation was waiting for a quota reset or rate-limit retry, startup recovery closes that stale running invocation and requeues task-backed work so the recovered sprint loop can start a fresh continuation. Repeated quota failures without a reset timer are still bounded by `cliWorkflow.maxQuotaRetriesWithoutTimer`.

### 7. Tasks completed but pipeline not progressing
Checks:
- Does the DB task record still show `coding_completed` because a feature PR or worker branch is still unresolved?
- Did the merge settle on the feature branch, or was this a no-output task that should auto-promote to final `completed`?
- Are CI / review gates still intentionally holding the task before final completion?
- If the provider session actually ended `FAILED`, Code UX should now clear the stale session/PR runtime state and requeue the task instead of treating the task as completed just because a PR artifact exists.

### 8. Tasks show RUNNING after MCP was interrupted
Symptoms:
- Old activity logs keep appearing.
- New orchestration cycles do not start fresh background CLI runs.

Checks:
- Restart MCP once to trigger startup recovery.
- Verify startup logs for a recovery line:
  - `Recovered runtime state on startup`
- Verify the affected sprint run returns to active monitoring without creating a brand-new sprint run record.

## Recovery Techniques

- Temporarily disable selected loop steps for diagnosis.
- Use the dashboard live view to inspect state without starting new work.
- Use activities APIs to inspect detailed session trace.
- Re-enable steps after diagnosis to restore normal operation.
- On startup, interrupted local CLI sessions (`cli-*` with `RUNNING`) are auto-recovered to `FAILED` so orchestration can safely retry them.
- On startup, active `queued` and `running` sprint runs are resumed automatically in place; Code UX now restores the watch loop instead of requiring a manual sprint restart.
- Local `docker_cli` task dispatches are rewritten to retryable failed state during that recovery, while durable Jules sessions and connected-worker dispatches remain attached to the resumed sprint run.
- Failed CLI sessions can preserve their worktree for manual follow-up or assisted retry, based on CLI Workflow settings.
- Dashboard task reruns now support a full clean reset:
  - the selected task always clears session, PR, merge, and intervention state before restart
  - normal reruns pass the previous CLI session/worktree into the next dispatch so the provider can continue from the same workspace when it still exists
  - selecting **Clear worktree** removes the previous workspace using the active CLI execution mode and suppresses workspace resume, forcing a new workspace for the rerun
  - provider overrides target the exact provider instance from **Settings -> Integrations** and may include a model override, so reruns can switch between multiple logins/configs for the same provider type
  - optional downstream reset rewrites dependent tasks to fresh pending execution snapshots so old completed/running descendants do not keep stale runtime metadata
  - if a task already merged code, operators must undo those landed changes before rerunning that task chain

## Useful Commands

```bash
pnpm test
pnpm run build
curl http://localhost:4444/api/status
curl http://localhost:4444/api/git-status
```

## Escalation Notes

When reporting issues include:
- Action used (`plan`, `status`, `orchestrate`)
- Sprint number and feature branch
- Relevant dashboard warnings
- Latest protocol instructions
- Any recent settings changes
