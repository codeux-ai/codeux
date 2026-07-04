# Operations Runbook

This runbook covers day-to-day operation and incident handling for the MCP server and dashboard.

## Normal Startup Procedure

Database maintenance runs automatically during normal startup. Operators can expect:
- `dbAutoVacuumOnStartup`: Triggers VACUUM on local databases. Can skip if set to false.
- `dbPruningEnabled`: Prunes old data matching `dbRetentionDays`. Can skip if set to false.
- `dbRetentionDays`: Bounded to a safe range (1-3650 days). Negative or zero values will be clamped.
- Startup logs will show a structured result detailing counts of pruned elements, failed vacuums, and WAL checkpoint failures (`checkpointFailures`). WAL checkpoint failures are non-fatal, busy checkpoints are safe to retry later.

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

### Provider Concurrency Controls
Provider concurrency is enforced globally across all projects using `ProviderSettings.maxConcurrentTasks`.
- **Pre-Launch Enforcement**: Slots are claimed atomically before any provider container or host process is launched. If no slot is available, the task dispatch waits and retries until a slot becomes free.
- **Unlimited Mode**: Setting `maxConcurrentTasks` to `0` disables concurrency enforcement for that provider (unlimited).
- **Terminal States**: Completed, failed, cancelled, or quota-wait terminal invocations do not count against the cap. Only 'running' invocations are counted.
- **Abort Handling**: If a task dispatch is cancelled while waiting for a slot, the wait loop exits immediately without creating a stale running invocation record.

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
- `/api/system/update-status` reports the running Code UX version plus the latest published npm version. It caches the npm lookup briefly, so repeated dashboard refreshes should not hammer the registry, and the dashboard logs a single startup notice when a newer release is available.
- The dashboard title bar shows a small "Update available" badge next to the version label whenever `/api/system/update-status` reports a newer published version. If the badge is missing, the check either found no newer release or the lookup failed and was suppressed.
- If the dashboard still degrades under load, inspect `runtime.debugLogFileLevel`; file logging defaults to `error` and uses async streams, but sustained log volume is still a useful signal that a hot loop is too noisy.

### 2. No PR/CI data in remote mode
Checks:
- Token availability in settings/env
- `/api/git-providers/available` reports token-backed provider availability only. It does not require or probe local `gh`/`glab` binaries.
- If a CLI task pushed code but cannot create a PR, the run now fails instead of completing as "without PR" while auto-create PRs are enabled. When a GitHub/GitLab token is configured, Code UX creates and finds PRs/MRs through the host API and does not require `gh` or `glab` on the machine.
- If no GitHub/GitLab token is configured, remote PR/CI/issue automation is unavailable until the matching token is configured. Code UX no longer falls back to local `gh`/`glab` for dashboard provider availability, new remote repository creation, PR/MR status, or GitHub issue import/close flows.
- Git subprocesses launched by the backend run through the `alpine/git` helper container by default, with Git-specific auth/config environment forwarded into the container. Extra host paths such as temporary bundle outputs and Git index files are mounted to Linux-style container paths under `/mnt/code-ux/git-paths/*`, so Windows paths like `C:\Users\...\AppData\Local\Temp\code-ux-bundle-*` are never used as Docker mount targets. The helper masks the image-declared `/git` volume with tmpfs so these commands do not leave anonymous Docker volumes behind. Set `CODE_UX_GIT_CONTAINER_MODE=host` or `CODE_UX_CONTAINERIZED_GIT=0` only for targeted diagnostics.
- Git host API reads are throttled and cached briefly to avoid rate-limit bursts when multiple sprints poll PR/CI state at the same time. Failed-run job/log enrichment is still limited, so Git/CI panels may trail live task state under heavy activity.
- "Workflow completed without PR" is only expected when `git.autoCreatePr` is disabled for the resolved system/project/sprint settings.

### 2a. Models catalog workflow cannot push to a protected branch
Checks:
- The Models Catalog workflow runs on pushes to `main` and `dev`, fetches `models.dev`, and compares the result with `assets/models-dev/catalog.json`.
- When the catalog changes, the workflow must not push directly back to `main` or `dev`; branch protection requires PR-based changes. It pushes `chore/models-catalog-<target-branch>` instead and opens or updates a PR against the branch that triggered the workflow.
- If the job reports a push rejection for `refs/heads/main` or `refs/heads/dev`, the workflow is running an older definition. Re-run it after the branch includes the PR-based catalog update workflow.
- If PR creation fails, check the workflow token permissions include both `contents: write` and `pull-requests: write`.

### 3. API-backed tools return key setup instructions
Checks:
- Is Jules API key configured in dashboard settings?
- Is `.env` loaded with `JULES_API_KEY`?
- Is `.jules-subagents/settings.json` containing `julesApiKey`?
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
  - For WORKER-profile routes, a saved worker model is only forwarded when it belongs to the selected provider. If you switch a planning or worker run from Codex to Gemini/Claude, Code UX now falls back to that provider's own model instead of sending an incompatible model id like `gpt-5.3-codex` to Gemini or Claude.
  - Codex websocket `HTTP 5xx` failures are transport/server errors, not auth failures. If you see `responses_websocket` + `HTTP error: 500`, treat that as a transient provider-side failure rather than a stale local login.
  - If auth is expected from host login state, is the relevant Docker auth mount enabled and is its mount path valid?
  - Docker mode requires daemon-visible workspace paths. Runtime now prefers repo-scoped worktree paths for Docker sessions.
  - Docker runtime state is stored under `~/.code-ux/runtime/docker/<repo-hash>/` by default (override with `JULES_DOCKER_RUNTIME_ROOT`). Cached setup image build contexts and build locks live under that root so setup-cache images survive dashboard restarts and concurrent post-restart jobs wait on the same build instead of starting duplicate builds.
  - During normal Code UX shutdown (`SIGINT`, `SIGTERM`, `SIGHUP`, or Electron quit), the server requests active dispatch aborts, drains persistent Git/workspace helper pools (including helpers that were still starting), and then kills any still-running Docker containers with `code-ux.*` labels or deterministic `code-ux-*` runtime names. It does not remove Docker workspace/runtime volumes. On the next start, recovery closes shutdown-interrupted local CLI invocations and dispatches as `cancelled`, moves task-backed work back to a retryable state, and can retry from the preserved workspace volume when `Resume failed task in same workspace` is enabled.
  - Dashboard and MCP HTTP listeners track and destroy open sockets during shutdown, including upgraded dashboard WebSocket sockets, so open browser tabs do not delay process exit or leave ports bound during rapid restarts.
  - Docker workspace/runtime volumes for tracked CLI sessions are preserved across startup pruning after recovery marks the interrupted session `CANCELLED`; the next retry can still resume the old workspace volume when `Resume failed task in same workspace` is enabled.
  - Rerun resume uses the latest `cli_workspace_bound` event as the source of truth for the workspace session id. If the latest interrupted provider invocation has a different `session_id`, Code UX still resumes the Docker volume named by the recorded workspace binding.
  - Codex uses per-session container home directories under that runtime root to prevent stale state from previous Codex runs.
  - Runtime cleanup prunes stale `home-codex-*` session homes and stale shared runtime temp directories automatically once those sessions are no longer active.
- Docker provider launches use readable container names such as `code-ux-codex-<session>` and mount provider arguments through a generated argv file instead of passing the full prompt through the host `docker run` command line. Secret-bearing provider environment variables are written to temporary `0600` env-files and supplied with `--env-file`, so `ps`/process-list inspection should show only the env-file path and not API key values. Packaged Windows Electron builds that fail with `spawn ENAMETOOLONG` during provider launch are using an older build or a non-provider launch path that still embeds a large payload in command arguments.
- Backend Git commands and snapshot workspace bootstrap use public helper images such as `alpine/git`. Snapshot bootstrap verifies or pulls these helpers automatically, and if Docker reports a broken host credential helper while pulling a public helper image, Code UX retries that helper pull with an isolated empty Docker client config; provider/container images still use the normal Docker configuration. Persistent helper containers are removed with `docker rm -f -v` so image-declared anonymous volumes are cleaned with the container. Startup Docker pruning is scheduled in the background and only queries Code UX labels, so a large Docker daemon does not delay dashboard boot with full volume/container scans.
- Snapshot workspace bootstrap creates the temporary Git bundle through the containerized Git helper using a portable `/mnt/code-ux/git-paths/*` target, then streams the bundle directly into `docker run` stdin. Packaged Windows Electron builds should not route `C:\...AppData\Local\Temp\code-ux-bundle-*` paths through `bash -lc` or use those paths as Docker mount targets; seeing `cat: 'C:\...\repo.bundle': No such file or directory` or `invalid mount path: 'C:/Users/.../code-ux-bundle-*'` indicates an older build.
- Packaged Windows Electron runs use an opaque desktop window to avoid Chromium tile-memory exhaustion (`tile_manager.cc:1012 WARNING: tile memory limits exceeded`). All animated backgrounds, patterns, and images render normally. Performance mitigations are applied at the WebGL layer (0.5× render scale, `powerPreference: "low-power"`, `contain: strict` on background layers, Chromium `--force-gpu-mem-available-mb` flag).
- If a Git URL project reports "No file changes produced" even though the provider edited files, verify the project `baseDir` is an exact Git checkout root. New Git URL projects are cloned to `~/.code-ux/projects/<repo-name>` by default; older relative paths nested under the Code UX repo should be re-added or updated to the real clone path.
- Relative local project paths are resolved against the user home directory, not the Code UX process working directory. A local project created with `myproject` now stores `baseDir` as `<homedir>/myproject`, and a relative Git `cloneDir` is normalized the same way before the repo name is appended.
- GitHub credential sync still copies mount contents into a fixed dir (`~/.config/gh`); Gemini sync is now auth-only to avoid concurrent Docker sessions racing on shared `.gemini/tmp/tool-outputs`.
- If provider output says "No file changes produced", runtime now still checks for unpushed worker-branch commits and will push/create (or reuse) the feature PR when commits exist.
- CI autofix and merge-conflict virtual-worker runs now perform the same unpublished-commit check before they mark the attention item resolved, so provider-created local commits are pushed to GitHub even when the workspace diff is empty by the end of the run. Merge-conflict publish also retries killed no-output `git push` attempts after the resolved commit has been materialized locally, preventing a transient helper/container termination from turning a valid resolution into a human handoff.
- Workspace patch export includes newly created untracked files by marking them in a temporary Git index before diffing. In Docker mode, Git-specific environment variables are forwarded into the helper container so the temporary index and HTTP auth config are applied inside the isolated workspace volume. Provider HOME lives in the paired runtime volume at `/code-ux-runtime-home`, outside `/workspace`; patch export still excludes the transient `.task-learnings.md`, legacy `.code-ux-home/`, and the entire `logs/openai/` directory (including nested logs) so memory capture, provider config, provider cache state, and transient OpenAI request/response logs cannot be committed.
- For Docker-in-Docker or remote daemon path mismatches, configure:
    - `JULES_DOCKER_HOST_WORKSPACE_ROOT=<host-visible-repo-root>`
    - `JULES_DOCKER_HOST_HOME_ROOT=<host-visible-home-root>` (optional, for auth mounts)
- If logs show `Error executing tool read_file: File not found`, verify the retry setting:
  - `Settings -> CLI Workflow -> Retry once on read_file not found`
- If you need post-failure recovery work, keep failed worktrees:
  - `Settings -> CLI Workflow -> Cleanup worktree on failure` should remain disabled (recommended default).
- To continue retries in the same failed workspace:
  - `Settings -> CLI Workflow -> Resume failed task in same workspace` should remain enabled (default).
- Dashboard **Resume** for a paused sprint run reactivates that same run and starts the recovery/watch-loop path in place. It should not create a replacement sprint run. If another queued/running/cancel-pending run already exists for the same sprint, resume is rejected until that active run is cancelled or completed.

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

### 6. Restart a failed planning invocation
Checks:
- Open Chat -> Invocations, select the failed planning invocation, then choose one of the header actions.
- **Restart** marks the original failed transcript as preserved, creates a replacement invocation row, resumes the failed provider session, and sends the full planning prompt again.
- **Continue** marks the original failed transcript as preserved, creates a replacement invocation row, resumes the failed provider session, and sends a continuation prompt that also embeds the original planning instructions so the run can still complete if the provider has lost the native conversation.
- Docker-backed planning runs use a stable project/sprint planning workspace and preserve the paired runtime volume while the run is failed/incomplete. Restart and Continue reuse that workspace so provider-local session files, caches, and runtime state remain available across quota/auth failures. Successful planning cleans up the workspace and paired runtime volume.
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
- For tasks shown as `QUOTA`, inspect the dispatch error and retry-after metadata. Code UX preserves quota/rate-limit dispatch errors during session sync; exact Codex reset hints are honored when the provider returns a concrete reset time, while ambiguous clock-only hints fall back to a bounded 30-minute retry. The active retry timestamp is surfaced through execution invocation rows, system messages, and `cli_provider_quota_wait` task-run events; if no active retry timestamp remains, the task is requeued instead of staying in `QUOTA`. If Code UX was offline while a provider invocation was waiting for a quota reset or rate-limit retry, startup recovery closes that stale running invocation as `cancelled` and requeues task-backed work so the recovered sprint loop can start a fresh continuation. Repeated quota failures without a reset timer are still bounded by `cliWorkflow.maxQuotaRetriesWithoutTimer`.
- For tasks stuck in a CI/QA gate after QA requested fixes, compare the latest `qa_review_runs` row with later `execution_invocations` for the same task run. A completed `cli_task_followup` after the latest `changes_requested` QA result should trigger a verification QA run on the next orchestration cycle; if no follow-up exists, the task is intentionally waiting on fix work or human intervention.
- Do not treat a later full task run as task-QA follow-up work. Task QA fixes should continue the same task session and branch through `cli_task_followup`; sprint-review failures create follow-up tasks instead.
- For tasks showing `QA_PENDING` with a `running` `qa_review_runs` row but no matching provider container, check the latest `qa_review` row in `execution_invocations`. Code UX now fails stale running QA rows automatically when the invocation never linked provider runtime or when its Docker-backed `provider_invocations.session_id` is absent from running `code-ux.session-id` container labels; the next cycle should enqueue a fresh QA review.
- For Jules-backed tasks stuck in `RUNNING`, compare the recorded task session with the live Jules API. If the session is absent from both the list snapshot and a direct `getSession` lookup returns not found, session sync now fails the stale provider/execution/task-run rows and requeues the task when failed-task retry is enabled.
- If provider concurrency repeatedly logs that the cap is reached but no provider containers are running, inspect `provider_invocations` for old `status = running` rows. Code UX now reconciles stale rows via a shared recovery helper during provider slot waits and startup so orphaned provider slots are failed and new work can claim the slot. Recovery waits for linked execution activity to go idle, so a newly claimed provider slot is not failed merely because its container has not appeared yet.

### 8. Tasks completed but pipeline not progressing
Checks:
- Does the DB task record still show `coding_completed` because a feature PR or worker branch is still unresolved?
- Did the merge settle on the feature branch, or was this a no-output task that should auto-promote to final `completed`?
- Are CI / review gates still intentionally holding the task before final completion?
- If QA requested changes and the provider completed a same-session follow-up, Code UX should treat that `cli_task_followup` as fresh work even when the task run itself did not get a newer `finished_at` timestamp.
- If task QA exhausted its review budget and no same-session follow-up is waiting for verification, the configured exhaustion policy applies. For new or unset policies, the default `FINISH_TASK` policy marks the task completed despite no QA pass; projects can still opt into `FAIL_TASK` or `ESCALATE_TO_HUMAN` when they need stricter handling.
- A task already parked in `QA_REVIEW_FAILED` should not start new automatic worker branches on later watch-loop cycles. If it does, inspect status derivation and task rerun/reset events; only explicit rerun/reset should move the task back to pending.
- If QA still appears running but no QA container exists, the watch loop should reconcile the stale QA invocation and retry the review rather than leaving `merge_indicator = QA_PENDING`.
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
- Startup recovery responsibilities are split into focused modular routines (QA review recovery, invocation recovery, etc.), while preserving centralized orchestration order. Recovered-state logging surfaces these distinct outcomes to the dashboard.
- Use the dashboard live view to inspect state without starting new work.
- Use activities APIs to inspect detailed session trace.
- Re-enable steps after diagnosis to restore normal operation.
- On startup, interrupted local CLI sessions (`cli-*` with `RUNNING`) are auto-recovered to `CANCELLED` so invocation error-rate statistics do not treat app shutdown/restart as provider failure.
- On startup, active `queued` and `running` sprint runs are resumed automatically in place; Code UX now restores the watch loop instead of requiring a manual sprint restart.
- Startup recovery does not steal an unexpired sprint lease when the recorded `sprint_orchestrator:<pid>` owner is still alive. This prevents a second dashboard process from creating a duplicate watch loop for work another live process already owns.
- Manual dashboard resume uses the same existing-run recovery path as startup recovery, so paused runs keep their original run id and heartbeat history when monitoring restarts.
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
  5. For the MCP HTTP gateway, ensure `--mcp-http-auth-token` is configured when binding beyond loopback.

### Subprocess Execution Limits

Subprocess execution restricts accumulated `stdout` (default 5MB) and `stderr` (default 4KB) memory growth by slicing long outputs and prepending `"..."`. Streaming callbacks (e.g., `onStdoutLine`, `onStderrLine`) still process the full, untruncated line output regardless of this cap, avoiding memory bloat while preserving line-by-line inspection. These bounds can be overridden via `maxStdoutChars` and `maxStderrChars` in command options.

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
