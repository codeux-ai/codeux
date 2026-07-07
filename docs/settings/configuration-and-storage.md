# Configuration and Storage

This guide explains runtime config sources, precedence, and persistence.

## Startup Config Sources

`src/config/app-config.ts` resolves API key in this order:

1. CLI `--api-key`
2. `JULES_API_KEY` or `JULES_KEY`
3. `.code-ux/settings.json` key fields

Additional startup config:
- `JULES_API_BASE_URL` (default: `https://jules.googleapis.com/v1alpha`)
- `DASHBOARD_PORT` (default: `4444`)
  - if not set, `config.json` is checked (`dashboardPort`, `DASHBOARD_PORT`, `dashboard.port`, `dashboard.dashboardPort`)
- `JULES_DOCKER_HOST_WORKSPACE_ROOT` (optional path mapping for Docker-in-Docker/remote-daemon setups)
- `JULES_DOCKER_HOST_HOME_ROOT` (optional home-dir path mapping for Docker credential mounts)
- `CODE_UX_GIT_FETCH_TIMEOUT_MS` (optional timeout for mandatory Git remote refreshes; default `120000`, clamped between 10 seconds and 10 minutes)
- `CODE_UX_RUNTIME_LOCK_WAIT_MS` (optional; defaults to `30000`. Startup waits this long for an existing project-manager runtime lock holder to exit before rejecting the new process.)
- `CODE_UX_ALLOW_MULTIPLE_RUNTIMES=1` (diagnostic only; bypasses the project-manager PID lock that normally prevents duplicate local runtimes from driving the same Docker/session state)
- MCP Streamable HTTP config uses the existing `--mcp-https*` flags / `MCP_HTTPS_*` env names for compatibility. When enabled and no explicit auth token is supplied, startup creates or reuses `~/.code-ux/security.json` with `mcpHttpAuthToken`.

External hint env keys used for dashboard import:
- `JULES_API_KEY` / `JULES_KEY`
- `GEMINI_API_KEY`
- `OPENAI_API_KEY` (Codex CLI)
- `GH_TOKEN` / `GITHUB_TOKEN`

## Settings Overrides and Scoped Resolution

Code UX settings resolve through a scoped cascade: `system` (base) → `project` (inherits from system) → `sprint` (inherits from project effective). System settings are the base of the cascade.

System settings hold global state, runtime behavior (e.g., ports, `consoleLogLevel`, `debugLogFileLevel`, `consoleLogMode`), and system integration credentials (Jira tokens, GitLab/GitHub tokens). They are also populated with defaults.

Effective settings API endpoints include a `sources` dictionary mapping each JSON path to its originating scope (`system`, `project`, or `sprint`).

Many settings families are handled by specific sanitizers that ensure defaults are applied and invalid shapes are repaired (e.g., `aiProvider`, `ciIntelligence`, `guardrails`, `cliWorkflow`, `git`, `jira`, `sprintLoopSteps`, `memory`, `modelPricing`, `workers`).

Project and sprint scopes can override execution-specific settings, such as `aiProvider` routes (which now include provider instances and `invocationRouting` as first-class citizens instead of legacy top-level keys), `cliWorkflow` settings (like `gitMode`, `executionMode`, `containerImage`, `containerSetupScriptPath`), and preview defaults (like `sprintPreview.startupScriptPath` defaulting to `.code-ux/browser/start-preview.sh`). `git.defaultBranch` fallback is resolved based on scoped overrides too. Jira and GitLab integration configurations are also scoped and can be overridden.

Techstack settings are split across scopes:
- system settings own `techstackCatalog`, a catalog with `defaultTechstackId` and `entries`
- project and sprint settings own `techstack`, a selection with `selectedTechstackId` and `applicationKind`

The built-in catalog always includes the Code UX Stack (`code-ux-internal`) with Preact, TanStack Router, GSAP, Three.js, and Lucide Icons. Catalog sanitization trims ids and labels, drops malformed or duplicate ids, preserves the built-in entry, and falls back `defaultTechstackId` to `code-ux-internal` if the saved default is missing or invalid. Project defaults intentionally keep `techstack.selectedTechstackId = null` and `techstack.applicationKind = null`; existing and imported projects therefore do not inherit the built-in stack automatically. New-project flows must apply a catalog default explicitly when they need one.

For `.code-ux/settings.json` (used primarily for credential hints during initial onboarding), search roots include:
- current working directory
- project root
- home directory

Note: `.code-ux/settings.json` is not the primary configuration source; Code UX reads its execution settings from the SQLite `settings.db`.

## Scoped Settings Persistence

Backend file:
- `src/repositories/settings-repository.ts`
- `src/repositories/settings-db-storage.ts`
- `src/services/settings-resolution-service.ts`

Storage:
- scoped settings DB at `~/.code-ux/settings.db`
  - `system_settings`
  - `project_settings`
  - `sprint_settings`
  - `app_settings` is retained only as a one-time legacy migration source for development data that predates the scoped model
- provider session DB at `~/.code-ux/session-tracking.db`
- Code UX app DB at `~/.code-ux/app.db`
  - includes project planning tables (sprints with `original_prompt` and `goal`) plus sprint-scoped runtime projection in `app_settings`, `task_runs`, and `task_run_events`
  - runtime context rows are keyed by sprint (`runtime_context:<projectId>:<sprintId>`); legacy unscoped project-level runtime rows are deprecated and are no longer used for explicit sprint reads or rerun context
  - also stores sprint preview runtime state in `sprint_preview_sessions`
  - persistent agent skill storage uses separate `skill_storages`, `skills`, `skill_embeddings`, and `agent_skill_storage_bindings` tables. These are distinct from project workspaces, `memories`, and `knowledge_documents`; agent presets attach to named storage records through normalized bindings rather than by storing workspace paths on the preset row.

Runtime resolution:
- effective runtime settings always resolve as `system -> project -> sprint`
- project settings inherit live system defaults; they do not snapshot them
- project saves are diffed against the current system defaults, not hardcoded app defaults
- sprint settings are sparse temporary overrides on top of resolved project settings
- effective system, project, and sprint resolution uses an in-process typed cache owned by `SettingsRepository` and implemented in `SettingsResolutionService`. Cache entries are keyed by scope plus a process-wide settings resolution revision. Any system save, project save/reset, sprint save/reset, or test data reset increments that revision and clears the writer's local cache, so other repository instances can no longer hit entries created before the write. The cache is bounded by the repository service lifetime and does not retain provider secrets beyond the existing settings service lifetime.
- orchestration, worker dispatch, and selected-project CI tracking resolve effective settings for the active project or sprint at runtime instead of using only the startup system snapshot
- `git.defaultBranch` resolves with the following precedence:
  1. Sprint setting override (Dashboard)
  2. Project setting override (Dashboard)
  3. System setting default (Dashboard)
  4. Hardcoded default (`main`)
- Additional Git branching behaviors configured here include `git.featureBranchPrefix` (e.g. `feature/codeux/`), `git.sprintBranchScheme` (e.g. `feature/sprint{sprint_id}-implementation`), and `git.sprintKeyPrefix` (uppercase identifier such as `SPR`).
- The legacy project metadata `defaultBranch` column is retained for project records created before the scoped settings model and for display/initialization context, but sprint orchestration and final merge targets do not let that metadata override resolved scoped settings. A project inheriting a system default of `dev` must merge sprint completion PRs into `dev`, even if the older project row still says `main`.
- In remote git mode, Code UX refreshes `origin` before sprint branch preflight and before each task start so branch resolution is based on current remote state instead of stale local refs.
- HTTPS GitHub remotes use the configured dashboard token as a temporary Git extraheader during origin refresh, remote branch checks, and branch pushes. HTTPS origin refreshes and branch preflight network checks run with interactive credential prompts disabled and a bounded timeout so orchestration cannot remain stuck waiting on local credential helpers. Mandatory CLI task refreshes fetch the requested starting branch's remote-tracking ref when possible, avoiding a whole-origin fetch for every task dispatch. They use a 120 second default fetch timeout, configurable with `CODE_UX_GIT_FETCH_TIMEOUT_MS` for slow Git transports. If direct remote inspection is unavailable, branch preflight can use an existing `refs/remotes/origin/<branch>` ref as remote-branch evidence. Local origin-refresh failures remain strict for CLI-backed work that needs local git state, but are best-effort for branch preflight and Jules dispatch because Jules works from the remote source and starting branch. SSH remotes continue to use the local SSH agent/key setup unchanged.
- In remote git mode, Code UX also refreshes `origin` before branch-sensitive recovery flows such as QA review, QA follow-up continuation, clarification auto-replies, CI fix runs, and merge-conflict resolution. Clarification auto-replies refresh the recorded task worker branch when available; if the task has no worker branch yet, they refresh the scoped `git.defaultBranch` so project-level default branch overrides are used instead of falling back to `main`.
- When task finalization materializes a patch with `commit-tree` and `update-ref`, Code UX synchronizes the checkout if the project clone is currently on the worker branch and tracked files were clean before the ref update. This prevents remote-git project clones from showing staged changes solely because `HEAD` moved without the worktree/index moving with it.
- QA review execution uses an isolated snapshot workspace in Docker so review inspection does not mutate the task workspace directly.
- QA-requested CLI follow-up work continues in the original task workspace when that workspace is still available. Code UX resolves the worker branch from task metadata first and falls back to the preserved workspace branch when metadata is missing, then fast-forwards the preserved workspace against `origin/<worker-branch>` when possible without cleaning local QA state.
- If neither worker-branch metadata nor a resumable workspace branch is available, QA follow-up fails with an actionable error that names both missing branch metadata and the missing/non-resolvable resume workspace session.
- CI autofix follow-up work reuses the existing task workspace for the same worker branch when available instead of always creating a fresh workspace.
- if Docker is unavailable during a CI autofix follow-up, Code UX falls back to a host-backed git worktree for that repair run instead of escalating immediately or creating another doomed Docker attempt.
- Merge-conflict resolution remains isolated in its own Docker workspace even when the underlying task already has a reusable task workspace.
- Docker provider runs use readable container names such as `code-ux-codex-<session>` and stage provider argv in a temporary host file mounted at `/opt/code-ux/provider-argv.sh`; only the provider command name remains in the host `docker run` argv. This avoids Windows command-line length failures when prompts include large task context.
- When a Docker-backed provider run is cancelled, Code UX now kills the backing container directly on abort instead of relying on the local `docker run` client to tear it down. This keeps deterministic container names safe for retries while ensuring the daemon-side container stops promptly.
- Interactive provider login containers use readable names such as `code-ux-login-<provider>-<session>` and run on a small cached prerequisite image named like `code-ux-login-base-node-24-bookworm-slim:<hash>`.
- Packaged Windows Electron uses an opaque BrowserWindow and Chromium GPU memory hints to mitigate tile-memory pressure. All animated backgrounds render at full fidelity; WebGL backgrounds use `powerPreference: "low-power"` and 0.5× render scale, and all background layers apply CSS `contain: strict` to limit compositor tile scope.
- On startup, Code UX schedules Docker asset pruning in the background so dashboard boot is not blocked by Docker cleanup. The prune path uses label-filtered Docker queries for managed workspace/runtime volumes plus helper/login containers, removes containers and volumes in batches, and applies a short per-command timeout. Helper/login container cleanup uses `docker rm -f -v` so anonymous image-declared volumes are removed with the container. Cached setup-script images are content-addressed and are intentionally preserved across dashboard restarts so provider launches can reuse them until the base image, setup script content, or setup Dockerfile changes.
- On startup, Code UX also performs automated database maintenance, pruning old completed task runs (and their cascaded child tables), VM activities, attention items, and realtime events according to the configured retention policy. Released virtual-worker assignment history is purged during the same maintenance pass because virtual workers are ephemeral and live paths only depend on active assignments. Maintenance then runs `VACUUM` on database files to reclaim disk space. SQLite WAL auto-checkpointing is disabled on runtime connections so ordinary startup writes cannot synchronously checkpoint a large WAL on the dashboard thread; controlled maintenance checkpoints truncate WAL files on the maintenance cadence instead.
- restart recovery treats interrupted Docker sessions without a live backing container as cancelled/retryable, so app shutdowns and restarts do not inflate invocation failure statistics while abandoned runtime callbacks are still cleared.
- restart behavior is controlled from `Settings -> General -> Restart Behavior`:
  - `restartSprintPolicy` defaults to `continue`, which resumes queued/running sprint runs in place after startup recovery.
  - `restartSprintPolicy = pause` moves active sprint runs and dispatches to a paused state before watch-loop recovery starts, updates the parent sprint projection to `paused`, cancels linked provider/QA runtime rows, and leaves preserved Docker workspaces available for manual resume.
  - `restartSprintPolicy = cancel` cancels active sprint runs on startup, releases their sprint leases, and cancels linked provider/QA runtime rows without creating a replacement run.
  - `restartInvocationPolicy` defaults to `continue`, which keeps still-running Docker-backed CLI invocations attached when their labelled container is still alive and only requeues interrupted/no-container work.
  - `restartInvocationPolicy = restart` stops active labelled provider containers without removing preserved workspace/runtime volumes, closes the interrupted invocation rows, and moves task-backed work back to `pending` so orchestration can dispatch a fresh attempt.
  - `restartInvocationPolicy = cancel` stops active labelled provider containers without removing preserved workspace/runtime volumes, closes the interrupted invocation rows, and marks task-backed work as `QA_REVIEW_FAILED`/blocked so it is not retried automatically.
- startup recovery also repairs parent sprint projection drift for paused runs: if the latest run is paused and no queued/running/cancel-pending run exists for the sprint, the parent sprint row is synced back to `paused` instead of allowing the dashboard to show a false running state.
- restart recovery respects live sprint lease ownership: if an active run has an unexpired `sprint_orchestrator:<pid>` lease and that PID is still alive, the new process skips recovery instead of releasing the lease and starting a duplicate watch loop.
- QA review keepalives refresh the sprint-run heartbeat only; the orchestrator heartbeat owns sprint lease renewal with its original lease token.
- On Code UX shutdown (`SIGINT`, `SIGTERM`, `SIGHUP`, or Electron quit), the server first requests registered active dispatches to abort and then kills any still-running Docker containers with `code-ux.*` labels or deterministic `code-ux-*` runtime names. This prevents provider, preview, browser, login, and workspace-helper containers from surviving a normal app stop. Persistent workspace helper containers and their one-shot fallback containers both carry `code-ux.managed=true` and `code-ux.helper=volume` labels so cleanup and inspection can find either path. Shutdown does not remove Docker workspace/runtime volumes, and startup recovery can continue from the same workspace volume when `Resume failed task in same workspace` is enabled.
- Failed-task retry uses the latest `cli_workspace_bound` task-run event as the authoritative Docker workspace binding. This matters after restart recovery because the interrupted provider session id can differ from the workspace session id that actually names the preserved volume.
- startup recovery now also requeues task-level CLI follow-up runs that were left in `in_progress` after QA/repair `Fix` work lost its backing container, so the orchestrator can start the container again instead of leaving the sprint stuck after a server restart.
- startup recovery treats Jules task sessions as durable remote runtime. If Code UX restarts after a sprint run or task dispatch was incorrectly terminalized while the sprint itself is still active, recovery rehydrates one sprint run, reattaches active Jules task runs/dispatches/provider invocation rows to it, and resumes the watch loop instead of failing the sessions.
- startup recovery also reconciles dispatch rows linked to terminal task runs. If a task run is already `COMPLETED` or `FAILED` but its dispatch still says blocked/failed/running from an older recovery path, Code UX rewrites the dispatch to the terminal status so live dashboards do not show stale error indicators for completed work. Dispatch rows already closed as `cancelled` by shutdown/restart recovery are left cancelled even though their task run uses `FAILED` as the internal retry sentinel.
- Jules sessions that still report `AWAITING_USER_FEEDBACK` are kept locally `running` when the recent activity transcript shows a user reply after the latest agent clarification request. This clears stale blocked dispatch errors and attention indicators while Code UX waits for Jules to process the submitted reply.
- session sync uses the shared bounded Jules session snapshot for normal polling, but directly fetches any recorded task session missing from that snapshot or present only as a stale nonterminal snapshot copy. Older long-running sprints can otherwise keep local task runs marked `running` after Jules already completed the session and opened a PR.
- When Code UX has to create a missing feature branch, it prefers `origin/<defaultBranch>` over the local `<defaultBranch>` ref when the remote-tracking base branch exists.
- When a sprint does not yet have a persisted feature branch, the generated branch name is treated as a candidate. Code UX checks both local refs and `origin` before creating it, and appends a numeric suffix such as `-1` when the candidate already exists from an earlier deleted or abandoned sprint.
- `main` is only the final fallback when no sprint, project, or system base branch is configured. Normal sprint and task flows use the resolved `git.defaultBranch` value from scoped settings.
- the old global `/api/settings` contract is removed in favor of explicit scoped endpoints
- dashboard v2 settings queries clear both cached and in-flight effective-settings requests whenever system/project settings are saved or reset, which prevents stale AI model options immediately after integration updates.
- Settings actions that mutate state (replace, patch, reset) require human confirmation. Mutating settings actions first return an approval-required response; only the exact same action and payload may execute once with `approval.confirmed: true` within 15 minutes. Get/resolve actions are read-only.

## Persisted Scoped Settings Model

`system_settings` fields:
- `runtime`
  - `dashboardPort`
  - `consoleLogLevel` (`info` by default; one of `off`, `debug`, `info`, `warn`, `error`)
  - `debugLogFileLevel` (`error` by default for `.code-ux/debug.log`; `off` disables file logging)
  - `consoleLogMode` (`standard` by default; `full` also prints routine dashboard HTTP request logs)
  - `dbAutoVacuumOnStartup` (default `true`; executes SQL `VACUUM` on startup to reclaim disk space)
  - `dbPruningEnabled` (default `true`; enables automatic startup pruning of old data)
  - `dbRetentionDays` (default `14`; retention threshold in days for completed runs and logs)
  - `restartSprintPolicy` (default `continue`; one of `continue`, `pause`, `cancel`)
  - `restartInvocationPolicy` (default `continue`; one of `continue`, `cancel`, `restart`)
- `integrations`
  - `julesApiKey`
  - `geminiApiKey`
  - `codexApiKey`
  - `claudeCodeApiKey`
  - `githubToken`
  - `gitlabToken`
- `defaults`
  - full inheritable project settings baseline
- `techstackCatalog`
  - `defaultTechstackId` (`code-ux-internal` by default)
  - `entries`
    - each entry has `id`, `label`, and `items`
    - each item has `id` and `label`
- `mcpTools`

`project_settings` fields:
- sparse overrides of:
  - `automationLevel`
  - `automationInterventions`
  - `aiProvider`
  - `git`
  - `ciIntelligence`
  - `sprintLoopSteps`
  - `cliWorkflow`
  - `sprintPreview`
  - `techstack`
  - `agents`
  - `skills`

`sprint_settings` fields:
- sparse overrides of the same project-level fields
- used only for sprint-local deviations from the resolved project baseline

System-level integrations are injected into effective dashboard settings at resolution time:
- provider credentials are system-scoped under `integrations.providers`
  - each entry is a named provider instance with `{ provider, name, apiKey, mountAuth, authPath, authType, providerConfigMode, providerConfigPath }`
  - default instance ids intentionally match the base provider ids (`jules`, `gemini`, `codex`, `claude-code`) for compatibility with older settings payloads
  - additional instances can coexist under the same CLI type
  - for CLI providers, `mountAuth`, `authPath`, and `authType` are instance-specific Docker auth-copy/login settings. The `authType` property can be set to `"apiKey"` (uses API key text override), `"localAuth"` (mounts a custom local directory like `~/.gemini`), or `"dashboardAuth"` (launches an interactive terminal inside the container and saves tokens directly to a dedicated `~/.code-ux/credentials/<provider-name>` folder on the host). `providerConfigMode` is independent of auth mode and controls only Docker config-file materialization:
    - `"none"` copies no provider config file and stores `providerConfigPath` as an empty string.
    - `"copyHost"` copies the provider's standard host config file path and stores that standard path.
    - `"file"` copies the user-selected file from `providerConfigPath`; an empty path is normalized back to `"copyHost"`.
  - standard config file paths are Codex `~/.codex/config.toml`, Gemini `~/.gemini/settings.json`, Claude Code `~/.claude.json`, Qwen `~/.qwen/settings.json`, OpenCode `~/.config/opencode/opencode.json`, and Antigravity `~/.gemini/antigravity-cli/mcp_config.json`. Jules and mock providers ignore these fields and normalize to `"none"` with an empty path.
  - Docker-backed CLI runs mount selected config files separately from credential directories under `/opt/provider-config/host-*`, copy them into the provider's expected runtime-home destination, then strip local MCP declarations and apply Code UX generated MCP fragments from the existing `/opt/provider-config/*` mounts. This preserves managed MCP server injection while allowing provider instances to use no copied config, the normal host config, or a selected config file without changing API-key/local-auth/dashboard-auth mutual exclusion. Activity logs may mention resolved config paths but never print file contents.
  - For dynamically-generated unsaved provider configurations (e.g. during onboarding or settings setup prior to saving), the dashboard is directly able to launch interactive login containers by automatically resolving the underlying provider type via prefix-matching on the transient instance ID (such as `gemini-mptfvpkk-u1fui` prefix-matching to `gemini`). To guarantee a fresh login, launching a `dashboardAuth` terminal session automatically clears the target provider credentials directory on the host first, ensuring that stale tokens or cached sessions do not interfere.

    #### Interactive Login Container Lifecycle Management
    Interactive login containers have strict lifecycle gates:
    - **Dashboard Visibility**: Containers are named with `code-ux-login-${providerId}-${sessionId}` and tagged with standardized metadata labels (`code-ux.login=true`, `code-ux.session-id`, `code-ux.provider-id`, `code-ux.command`). As a result, the Docker status daemon filters and displays them under the **Active Containers** dropdown in the dashboard's navbar.
    - **Connection-Lost Cleanup**: If a user closes the browser tab, the terminal modal, or suffers a network drop, the server monitors the WebSocket connection. If all client connections are lost, a **1-second grace period** timer triggers. If no client reconnects, the backend SIGKILLs the spawned container process and invokes `docker rm -f` to clean up resources immediately.
    - **Orphan Pruning on Startup**: When the backend restarts, any leftover login containers (identified by the `code-ux.login=true` label) are considered orphaned and forcefully terminated. Additionally, any unsaved temporary credentials directories (of the form `${providerId}-temp-${sessionId}` under the host's `~/.code-ux/credentials/` path) are fully wiped to ensure a clean slate.
- `git.githubToken` and `git.gitlabToken` are system-scoped
- runtime fields like `dashboardPort`, `consoleLogLevel`, `debugLogFileLevel`, and `consoleLogMode` are system-scoped
- project and sprint scopes still own `cliWorkflow.containerMountGithubAuth`, `cliWorkflow.containerGithubAuthPath`, `cliWorkflow.containerMountGitConfig`, `cliWorkflow.containerGitUserName`, and `cliWorkflow.containerGitUserEmail`
- `agents.selfReflection` is default-off for both `planning` and `qualityAssurance`. Each loop stores an `enabled` flag, senior engineering criteria with per-criterion thresholds, and `maxImprovementAttempts`; sanitization dedupes criteria by id, clamps thresholds to `0..1`, clamps attempts to `0..10`, and falls back to default criteria for malformed legacy payloads. When enabled, structured planning and QA requests run the optional rate-and-improve loop through the same provider session while keeping the last valid parsed output if reflection fails. Planning reflection also gates `autoStart`: a non-passing final decision saves the plan without starting orchestration automatically.
- `techstackCatalog` is system-owned. It stores the available techstack records and the catalog default id. The built-in `code-ux-internal` entry is restored on every load even when saved settings omit or override it.
- `techstack` is project/sprint-owned. It stores `{ selectedTechstackId: string|null, applicationKind: "web"|"desktop"|null }`. The default project selection is null by design so imported projects remain unclassified until a later explicit project override selects a stack.

Backend contract:
- `src/contracts/app-types.ts`
- `src/contracts/settings-scope-types.ts`

Frontend contract:
- `dashboard/src/types.ts`

Effective settings APIs:
- `GET /api/system-settings`
- `PUT /api/system-settings`
- `GET /api/projects/:projectId/settings`
- `PUT /api/projects/:projectId/settings`
- `DELETE /api/projects/:projectId/settings`
- `GET /api/projects/:projectId/settings/effective`
- `GET /api/sprints/:sprintId/settings`
- `PUT /api/sprints/:sprintId/settings`
- `DELETE /api/sprints/:sprintId/settings`
- `GET /api/projects/:projectId/sprints/:sprintId/settings/effective`

Preview APIs:
- `GET /api/projects/:projectId/preview/sessions`
- `POST /api/projects/:projectId/sprints/:sprintId/preview/start`
- `POST /api/browser/sessions/:sessionId/rebuild`
- `POST /api/browser/sessions/:sessionId/stop`
- `GET /api/projects/:projectId/sprints/:sprintId/preview/script`
- `PUT /api/projects/:projectId/sprints/:sprintId/preview/script`
- `GET /api/browser/sessions/:sessionId/logs`
- `ALL /api/browser/sessions/:sessionId/proxy/*`

The effective endpoints return:
- resolved `DashboardSettings`
- per-field source metadata (`system`, `project`, or `sprint`)

Dashboard behavior:
- project settings now render a per-setting override badge only when a control is actually overridden at project scope
- settings UI path pickers can browse allowed local roots for custom container setup script paths. The local browser APIs are limited to the home directory, current working directory, and `CODE_UX_DIRECTORY_BROWSER_ROOTS`; `/api/local-files` returns navigation metadata plus directory and file names/absolute paths only, never file contents.
- sprint override dialogs use the same field-level source metadata and show override badges only for sprint-local overrides
- the v2 settings page includes a quick-find field (keyboard shortcut `/`) that filters categories without changing the scoped settings model. Smart Find uses a centralized typed settings search index spanning category metadata, provider and integration labels, invocation routes, instruction templates, and important field synonyms, so provider searches such as `claude` surface both AI model routing and Integrations matches with visible match context. Idle search copy stays quiet while keeping the exact category total available to assistive technology; active searches announce live result counts, matching-category counts, active-category context, match previews, no-match recovery suggestions, and keyboard-friendly quick category chips.
- settings scope selection is a radiogroup with explicit selected state and disabled project-scope guidance when no project is selected. Save, project reset, dirty, saved, and error states are announced in the active settings panel while visible form values stay mounted during pending operations.
- Settings category transitions use shared interaction motion tokens and snap directly to the selected category for reduced-motion users, avoiding intermediate fade states.
- settings field controls expose field-level confidence through error text and ready-to-save cues where validation is available. Single-choice pill controls keep radiogroup/radio semantics and wire helper, valid, pending, and error copy through `aria-describedby`, `aria-errormessage`, and `aria-busy` instead of relying on visual styling alone. Numeric fields derive local min/max validation from their mounted control metadata; Save Changes focuses the first visible invalid field and blocks the patch request until the value is corrected.
- settings category navigation uses tokenized selection movement and separates focus movement from selection: arrow keys move through categories, while Enter/Space commits the active category. Selected, pending, disabled, and search-match states remain visible and are also announced through ARIA relationships. Disabled category rails and Local Git mode controls expose persistent visible reasons so users do not have to infer why a field is unavailable.
- provider instance cards keep draft-only feedback visible for display-name edits, API key edits, auth-mode changes, enable/disable changes, dashboard-login completion, and remove confirmation state until the next local provider change or settings reload. Removal remains reversible in the draft with Cancel and Confirm actions, cancel restores focus to the remove trigger, and update failures are announced through alert regions without persisting any removal until Save Changes runs.
- the unsaved-changes dialog keeps focus inside the modal, exposes save/discard pending states, and labels discard as dropping pending edits without saving.
- dashboard theme selection is unified through `dashboard/src/v2/hooks/useThemeSetting.ts`: both the top-nav theme toggle and Settings > Appearance theme control persist through `saveSystemSettings` and react to the same `codeux:settings-updated` event stream.
- the main settings editor is composed of smaller panel modules for better maintainability (e.g., automation, provider, worker, QA controls) instead of one monolithic component.
- AI provider configuration and catalog metadata are centralized in `settings-view-models.ts` instead of directly within the editor.
- AI provider configuration now uses compact focused workspaces instead of only long card grids:
  - one provider is edited at a time in the provider deck detail panel
  - AI Models separates global/worker default anchors from base provider configuration, so provider instance defaults for model, thinking mode, weight, and concurrency are edited independently from routing strategy
  - invocation routing is edited in a split-pane route workspace with provider icons, resolved default, provider-pool, and override summaries
- common 2-3 option settings such as routing strategy, worker execution mode, execution runtime, and merge mode use pill controls for faster scanning than dropdown-heavy forms
- the Integrations panel restores the Git host workspace:
  - system scope edits the GitHub token, GitLab token, Jira connection, and per-instance CLI auth sources
  - project and sprint scopes edit GitHub auth-copy mounts plus Docker git identity; copying the local `.gitconfig` is available as an opt-in replacement for the editable identity fields
- Jira integration settings include the site URL, account email, API token, default project key used by sprint import JQL, close transition name, and a Jira-specific linked-issue auto-close toggle. Effective dashboard settings project this system-owned Jira connection into `settings.jira` for Jira search, issue context loading, and completion transitions.
- integration and AI model provider tiles use vendored, pinned Lobe Icons SVG brand marks for Jules/Google, Gemini, Codex, Claude, Qwen, OpenCode, GitHub, and GitLab identity; Jira uses the in-app Jira mark.
- provider instance removal is a draft-only operation until the existing Save Changes flow persists the system settings patch. Resetting the active settings scope discards local provider removals along with other unsaved edits.

`aiProvider` contains:
- `provider` (`ProviderConfigId|null`)
- `strategy` (`MANUAL|WEIGHTED|AGENT`, legacy compatibility field; invocation routes carry the active routing strategy)
- `providers` map keyed by provider config id
  - each provider config stores `provider`, `name`, `enabled`, `model`, `weight`, `thinkingMode`, and `maxConcurrentTasks`
  - provider config entries are base defaults for route inheritance; manual, weighted, or agent-based selection is controlled by each invocation route rather than by the base provider configuration panel
  - multiple entries may share the same underlying provider type, so weighted/manual routing can target separate Codex, Gemini, Claude, or Jules instances independently
  - Jules remains routable with `enabled` and `weight`, but the current Jules REST API does not expose model-selection or thinking controls.
  - Dashboard settings editors therefore hide `model` and `thinkingMode` for Jules and show an informational note instead.
  - Gemini alias entries `pro`, `flash`, and `flash-lite` are labeled as recent aliases in selects so it is clear they track the latest model target.
  - Code UX performs startup availability checks for Gemini, Codex, and Claude Code, looking for API-key hints and stable local auth artifacts to prepare future onboarding decisions.
  - Enabling local auth on a named provider instance in Integrations also marks that instance active in the dashboard so mount-based Docker setups show the expected connected state even without an API key.
  - Note: `available` means an API key is present from saved settings/import hints or that specific provider instance has `mountAuth = true`. Local host auth files alone do not mark a CLI provider or provider instance active unless the matching named instance has local auth enabled. `enabled` means user-approved routing participation. CLI providers are opt-in on fresh installs and disabled by default.
  - `invocationRouting` map
  - route ids:
    - `task_coding`
    - `planning`
    - `dashboard_reply`
    - `clarification_reply`
    - `qa_review`
    - `ci_fix`
    - `merge_conflict`
    - `remediation`
  - each route contains:
    - `profile` (`GLOBAL|WORKER`)
      - `GLOBAL`: inherit the top-level `aiProvider.provider` and per-provider base defaults
      - `WORKER`: inherit the worker runtime preference (`workers.virtualWorkerProvider`) and worker model override (`workers.model`) as the default baseline for that invocation
    - `strategy` (`MANUAL|WEIGHTED|AGENT`)
      - legacy `ORCHESTRATOR` values are normalized to `AGENT` on load
    - `provider` (`ProviderConfigId|null`)
      - `null` means "inherit the profile default provider"
    - `allowedProviders` (`ProviderConfigId[]`)
      - empty means "all enabled provider instances remain eligible"
    - `providers` sparse override map keyed by provider config id
      - supports per-invocation overrides for `enabled`, `model`, `weight`, and `thinkingMode`
  - default profiles:
    - `task_coding`: `GLOBAL`
    - `planning`: `WORKER`
    - `dashboard_reply`: `WORKER`
    - `clarification_reply`: `WORKER`
    - `qa_review`: `WORKER`
    - `ci_fix`: `WORKER`
    - `merge_conflict`: `WORKER`
    - `remediation`: `WORKER`
  - dashboard replies, clarification auto-answer, and QA review runs in `WORKER` mode now follow the preferred worker CLI provider/model by default instead of accidentally inheriting whichever global provider happened to match.

`memory` contains:
- `enabled`
- `embeddingProvider` (`in_app|external_api`)
- `embeddingModel` (`string|null`; in-app mode accepts only downloaded catalog model ids, external mode accepts provider model ids)
- `externalEmbedding`
  - `baseUrl`: OpenAI-compatible embeddings endpoint
  - `apiKey`: bearer token for the external embedding provider
  - `model`: model id sent to the external endpoint
  - `dimensions`: optional requested dimension count
- `autoCaptureSprint`
- `autoCaptureAgent`
- `autoPromote`
- `promotionThreshold` (default `0.5`; AI remediation may review candidates down to `0.45` before selecting durable promotions)
- `remediationMode` (`off|deterministic|ai`)
- `remediationMaxPromotions`
- `maxSprintMemories`
- `maxProjectMemories`
- `mapMaxEdgesPerNode`
- `workerLearningsInstruction`

`automationInterventions` contains:
- `autoApprovePlan` (default `true`): auto-approve `AWAITING_PLAN_APPROVAL` sessions in `SEMI_AUTO`
- `autoAnswerClarification` (default `false`): auto-answer Jules `AWAITING_USER_FEEDBACK` sessions in `SEMI_AUTO`; dashboard controls live under Settings -> Integrations -> Jules because this path sends replies back to the Jules session.
- `autoResumePaused` (default `false`): auto-send resume nudge for `PAUSED` sessions in `SEMI_AUTO`
- `clarificationAnswerTemplate`: default response body used for clarification auto-replies
- `clarificationCooldownSeconds` (default `300`): retained as the unresolved-clarification escalation window, while clarification dedupe keys off the latest clarification content and Jules activity identity. Once Code UX starts answering a specific clarification request, repeated cycles skip starting or sending another answer for the same question until Jules emits a different clarification prompt or a new non-user activity. If a user reply exists after the latest Jules request, cooldown escalation is suppressed so the task stays agent-owned while Jules processes the response.
- when `autoAnswerClarificationMode = WORKER`, Code UX now composes the clarification-answer prompt from the editable `Project manager` agent preset instead of prepending worker instructions
- worker-routed clarification prompts now include a dedicated Jules clarification section so the latest explicit `agentMessaged.agentMessage` is passed through when available instead of only broad sprint context
- worker-routed clarification replies normalize CLI provider envelopes before sending the answer to Jules; if package-manager/bootstrap logs surround a `{ "response": "..." }` provider envelope, only the `response` body is sent and stored as the assistant reply

`agents` contains:

- `saveToProjectDirectory`
- `instructionTemplates`
- `routing`
  - `planning.agentPresetId`
  - `taskCoding.mode`
  - `taskCoding.agentPresetId`
  - `taskCoding.orchestratorAgentPresetIds`
  - `ciFix.agentPresetId`
  - `mergeConflict.agentPresetId`
  - `dashboardReply.agentPresetId`
  - `clarificationReply.agentPresetId`
- agent presets also carry optional routing preferences:
  - `providerConfigId` (`ProviderConfigId|null`)
  - `model` (`string|null`)
  - `containerRunAsRoot` (`boolean|null`): when the resolved worker preset sets an explicit boolean, local CLI task execution uses that value instead of the scoped `cliWorkflow.containerRunAsRoot`; `null` or an omitted field inherits the scoped setting
  - provider and model preferences are only applied by invocation routes using the `AGENT` provider strategy; blank values inherit the route, worker, or global default
- `qualityAssurance`
  - `enabled` (default `true`)
  - `maxTaskReviewRuns` (default `3` for new or unset settings)
  - `maxSprintReviewRuns` (default `3` for new or unset settings)
  - `exhaustionPolicy` (default `FINISH_TASK` for new or unset settings)
  - `taskCompletion`
    - `enabled`
    - `agentPresetIds` (ordered list of review agent preset IDs; empty means the built-in/default QA agent fallback)
    - `agentPresetId`
  - `sprintCompletion`
    - `enabled`
    - `agentPresetIds` (ordered list of review agent preset IDs; empty means the built-in/default QA agent fallback)
    - `agentPresetId`
  - `completedTaskWithoutPr`
    - `enabled`
    - `agentPresetIds` (ordered list of review agent preset IDs; empty means the built-in/default QA agent fallback)
    - `agentPresetId`

Quality assurance settings are project-scoped today and are edited from `Settings -> Sprint & Git`, immediately below `Merge Gates & Autofix`. Each QA trigger can persist multiple review agent presets in `agentPresetIds`; Code UX still accepts the legacy single `agentPresetId` field and mirrors it to the first selected ID in sanitized and effective settings for compatibility. When task-level QA is enabled, successful CLI task runs preserve their worktree long enough for a QA follow-up pass to resume the same session/worktree if fixes are required.

QA merge-gate notes:
- task QA now runs on code-complete tasks before Code UX auto-merges their feature PRs
- enabled task QA blocks feature merge until QA passes or `maxTaskReviewRuns` is exhausted
- while task QA is pending or retrying, the runtime merge indicator can be `QA_PENDING`
- the initial task review always counts as run `1`; later runs are only used for QA-requested fix checks
- `maxTaskReviewRuns = 3` is the default task QA budget for new or unset settings: the initial task review plus up to two QA re-checks after fixes
- `maxSprintReviewRuns = 3` is the default sprint QA budget for new or unset settings: the initial sprint review plus up to two sprint-level follow-up reviews
- `exhaustionPolicy = FINISH_TASK` is the default for new or unset settings when task QA spends its budget without a pass; stricter projects can choose `FAIL_TASK` or `ESCALATE_TO_HUMAN`
- a passed task QA result is reused and does not restart by itself on the next orchestration cycle
- sprint QA now runs before the final `feature -> default` merge gate
- enabled sprint QA blocks main-branch merge until sprint QA passes
- sprint QA can resume an existing target task session and can also create new follow-up tasks with full `promptMarkdown` instructions when the review finds broader sprint work
- sprint QA reruns only after a prior `changes_requested` or failed result and meaningful sprint task state changes after the last sprint QA run
- a passed sprint QA result is reused and never restarts by itself without real work changes

`cliWorkflow` contains:
- Retry/cleanup toggles:
  - `cleanupWorktreeOnSuccess`
  - `cleanupWorktreeOnFailure`
  - `retryOnReadFileNotFound`
  - `resumeFailedTaskInSameWorkspace`
  - `maxPlanningJsonRetries` (default `3`): Maximum number of retry attempts inside a same-session virtual worker planning loop if the provider output cannot be parsed as valid JSON.
    - Planning provider transport failures such as `Command aborted` and empty structured output are retried as new provider attempts before the planning request fails. When guardrails are enabled, `guardrails.jobs.planning.cap` bounds the total planning provider attempts.
- Git onboarding mode:
  - `gitMode` (`remote` | `local`, default `remote`)
    - `remote` keeps the GitHub and GitLab onboarding cards visible and preserves CI/PR automation guidance
    - `local` hides the remote integration cards during onboarding while leaving git identity controls visible for repo-local workflows
- Runtime mode:
  - `executionMode` (`HOST|DOCKER`)
- Docker runtime config:
  - `containerImage`
  - `containerSetupScriptPath` (optional; saved as a string and not required to exist when settings are saved)
    - the dashboard picker is a convenience for selecting local absolute paths from allowed host roots
    - manually entered relative paths remain supported; Docker runtime resolves them later against the sprint repo root and current server working directory
    - if empty, Code UX first seeds missing bundled defaults into `~/.code-ux`, then falls back to `.code-ux/container/setup.sh` in repo root, then home directory, then the bundled Code UX default script
  - `containerMemoryLimitMb` (default `6144`): memory ceiling in MiB applied to all Docker-backed CLI provider containers. `0` disables Docker memory flags. Positive values are passed as both `--memory` and `--memory-swap`, so the configured value is a hard ceiling rather than silent swap overcommit.
  - `containerCacheSetupScriptImage` (default `true`)
    - when enabled, Docker runtime builds and reuses a derived image keyed by the base image plus setup script contents
    - cache misses fall back to the current per-run setup script path if the image build fails
  - `containerRunAsRoot` (default `false`): opt-in runtime mode for Docker provider containers that must run as root. Invalid or missing values sanitize back to `false`; unless this is explicitly `true`, provider containers run with the resolved host workspace UID/GID and receive a matching mounted `/etc/passwd` worker entry. A resolved worker agent preset can override this value for local CLI task execution with its nullable `containerRunAsRoot` field; hosted Jules sessions ignore the per-agent field because they do not run in local Docker provider containers.
  - `containerInstallPlaywrightBrowsers` (default `true`): provider coding containers set `CODE_UX_INSTALL_PLAYWRIGHT=1`, so the shared setup script installs Playwright Chromium plus OS dependencies for agent browser checks. With setup-image caching enabled, the setup-cache build also exports `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`, bakes Chromium into that image, and leaves the directory readable for non-root provider runs. Disable this setting to skip the browser download during setup; preview containers keep it disabled unless they opt into the provider setup path explicitly.
  - `containerMountGitConfig` (default `false`): copy the host `.gitconfig` into Docker. When disabled, Docker provider runs configure Git with `containerGitUserName` and `containerGitUserEmail` instead.
  - `containerGitUserName` (default `Code UX`)
  - `containerGitUserEmail` (default `agents@codeux.ai`)
    - the same identity is also passed to host-side `git commit-tree` during Docker workspace write-back, so final provider commits do not depend on the dashboard host's global git config
    - Docker snapshot workspaces do not hardcode a repo-local Git identity; provider containers use the copied `.gitconfig` or configured Code UX identity, and Git helper commands forward Git-specific environment such as temporary indexes and HTTP auth headers into the workspace container
    - backend Git commands run through the `alpine/git` helper container by default, so branch prep, clone, archive, write-back, and merge helpers do not depend on host Git being installed. When a Git command needs an absolute host path outside the mounted repository, Code UX binds that host directory to `/mnt/code-ux/git-paths/*` and rewrites Git args and path-like Git env vars to the container path; this keeps Docker mount targets portable on Windows, macOS, and Linux. Set `CODE_UX_GIT_CONTAINER_MODE=host` or `CODE_UX_CONTAINERIZED_GIT=0` only for diagnostics.
    - when `git.autoCreatePr` is enabled, a pushed CLI task branch must produce a PR URL; configured GitHub/GitLab tokens use API-backed PR/MR creation without requiring `gh`/`glab`, and missing tokens now fail remote automation instead of falling back to local host CLIs
  - `containerMountGithubAuth` (default `false`)
  - `containerMountGeminiAuth` (default `false`)
  - `containerMountCodexAuth` (default `false`)
  - `containerMountClaudeCodeAuth` (default `false`)
  - `containerGithubAuthPath` (default `~/.config/gh`)
  - `containerGeminiAuthPath` (default `~/.gemini`)
  - `containerCodexAuthPath` (default `~/.codex`)
  - `containerClaudeCodeAuthPath` (default `~/.claude`)

`sprintPreview` contains:
- `enabled`
- `showInAppBrowser`
- `autoStartOnRunningSprint`
- `rebuildOnTaskCompletion`
- `rebuildOnSprintCompletion`
- `autoStopOnTerminalSprint`
- `maxConcurrentContainers`
- `hostPortRangeStart`
- `hostPortRangeEnd`
- `containerAppPort`
- `startupScriptPath`

Preview runtime notes:
- preview settings participate in the same `system -> project -> sprint` resolution model as other project-scoped defaults
- preview session runtime state is stored in the app DB table `sprint_preview_sessions`, not the settings DB
- `startupScriptPath` points to the editable preview startup script and is separate from `cliWorkflow.containerSetupScriptPath`
- preview host ports are allocated from the configured range and bound to `127.0.0.1`
- `showInAppBrowser` controls whether Browser entry points stay visible in the dashboard shell for the selected project scope
- `enabled` disables new preview launches and causes reconciliation to stop active previews for that scope
- preview workspace export now uses the shared remote-branch sync rule: in `REMOTE` git mode it refreshes `origin` before start/rebuild export, and in `LOCAL` git mode it stays local-only
- `maxConcurrentContainers` caps active preview containers per project by stopping the oldest previews before starting another

`agents` contains:
- `saveToProjectDirectory` (default `true`)
  - when enabled, dashboard agent create/update writes project-local markdown companions under `.code-ux/agents`
  - mirrored filenames use lowercase underscore-safe slugs such as `planning_agent.md`
  - clarification auto-answer can read project-local `project_manager.md` as the editable instruction source for worker-routed Jules clarification replies
  - default/home markdown sources are never modified by dashboard edits; Code UX creates a project-level override file instead
  - when bundled defaults are available but missing from `~/.code-ux`, Code UX installs the base agent files into the user directory without overwriting existing files

`workers` contains:
- `executionMode` (default `VIRTUAL`)
  - `VIRTUAL`: Code UX spins up an internal one-shot CLI worker when worker-owned attention exists, handles one cycle in an isolated container workspace, then tears it down
- `virtualWorkerProvider` (default `codex`)
  - allowed values: `gemini`, `codex`, `claude-code`
  - Jules is intentionally excluded from worker mode; virtual workers are CLI-only
- `maxConcurrency` (default `100`)
  - caps how many worker-dispatched tasks can run in parallel for the selected scope
  - settings editors allow values from `1` through `100`
- Dashboard worker-runtime editors now expose only the virtual-worker provider and worker-model override controls because connected MCP worker mode has been removed.
- In the dashboard, these controls are exposed in the active v2 settings page under `Sprint Engine -> Worker Runtime`

Container execution notes:
- `cliWorkflow.executionMode` defaults to `DOCKER`, but Code UX still supports `HOST` worktrees for controlled fallback and legacy-safe paths
- task, planning, chat, and normal CI-fix flows execute inside isolated Docker-volume workspaces when Docker execution is available
- Git URL projects must have a local checkout. Dashboard project creation clones them into the selected clone directory, or `~/.code-ux/projects/<repo-name>` when no clone directory is provided.
- QA review execution uses a fresh snapshot workspace instead of the mutable task workspace
- QA-requested follow-up coding and CI autofix continue in the existing task workspace when that workspace is still reusable
- CI autofix falls back to a host-backed worktree only when Docker is unavailable for that follow-up repair attempt
- merge-conflict resolution remains Docker-only because it must run in an isolated throwaway workspace
- repo-local `.code-ux/worktrees/*` are no longer used for Docker execution
- `~/.code-ux/runtime/docker/` should now contain only cache-like artifacts such as reusable setup-image state, not per-session workspaces
- Docker-volume workspace bootstrap uses public helper images such as `alpine/git`; backend host-path Git commands use the same helper image by default. Code UX verifies or pulls workspace bootstrap helpers automatically, and if a stale host Docker credential helper blocks a public pull, retries that helper pull with an isolated empty Docker client config. Bootstrap creates the generated Git bundle through a portable `/mnt/code-ux/git-paths/*` container mount and sends it to `docker run` through stdin, so packaged Windows Electron builds do not depend on Bash or Docker accepting host temp paths such as `C:\Users\...\AppData\Local\Temp\code-ux-bundle-*` as container paths.
- Targeted Docker worktree preparation refreshes requested remote branches with explicit `refs/heads/* -> refs/remotes/origin/*` fetch refspecs before building the bundle. Merge-conflict repair depends on this because the virtual worker checks out the source task branch but must also seed the target feature branch; the isolated workspace merges `origin/<targetBranch>` into the source branch before invoking the provider.
- Windows host named pipe fallback: on Windows hosts, if the active Docker context (such as `desktop-linux`) points to an unreachable named pipe (e.g., `npipe:////./pipe/dockerDesktopLinuxEngine`), Code UX automatically detects this during startup and falls back to the default working named pipe (`npipe:////./pipe/docker_engine`) if responsive. This ensures Docker commands executed via CLI in child processes (like volume creation or container runs) can connect to the Docker Desktop daemon correctly without requiring manual context adjustments on the host.
- Docker workspace bootstrap now rejects configured project paths that are nested inside a different Git checkout; this prevents Git from walking up to a parent repo and producing misleading no-change task completions.
- write-back from isolated CLI runs uses a Git patch artifact applied on the host branch, not direct file syncing from the container
- merge-conflict preparation and CI-fix Git commands must execute through the workspace runner; host-path Git invocations against `docker-volume://...` workspace handles are not valid

`sprintLoopSteps` also includes:
- `watchLoopIntervalSeconds` (default `10`, clamped to `1..3600`)
- `watchLoopOutputIntervalSeconds` (default `300`, clamped to `60..3600`): max watch-loop runtime before returning an in-progress status and rerun instruction

`ciIntelligence` also includes:
- `enableLivePrMonitoring` (default `true`): controls live PR/CI monitoring gates in sprint loop (`REMOTE` mode only; auto-disabled in `LOCAL` mode).
- Code UX state is currently backed by SQLite via `DatabaseAdapter`, but is staged for a Postgres migration (see [Postgres Migration Plan](../architecture/postgres-migration-plan.md)).
- `resolveMainMergeConflicts` (default `true`): when enabled, a `feature -> main` PR in `DIRTY` merge state opens a worker-owned `merge_conflict` attention item with repo path, working-directory hint, conflicting branches, PR metadata, sprint context, and merged task prompts already present on the feature branch.
- `resolveMergeConflicts` (default `true`): when enabled, feature PRs in `DIRTY` merge state open a dedicated worker-owned `merge_conflict` attention item instead of a generic merge-required item. The payload includes repo path, working directory hint, source/target branches, PR details, the current task prompt, and merged task prompts already on the feature branch so the virtual worker can resolve the conflict with full context.
- worker-owned merge conflicts do not end the watch loop as manual merge work anymore; Code UX keeps the loop alive while the selected worker runtime is expected to handle the conflict, and the dashboard no longer projects those worker-owned conflict items as human intervention.
- if a merge-conflict repair item escalates to a human handoff, that handoff blocks new worker-owned repair items for the same task until it is resolved; this prevents guardrail-triggered or startup-failure cases from repeatedly launching more repair containers.
- feature PRs with `mergeStateStatus = DIRTY` short-circuit the feature-merge CI wait path; Code UX marks them as merge conflicts immediately instead of waiting for checks that cannot start until the conflict is resolved.
- completed tasks with no recorded worker branch or PR URL are treated as already settled for dependency unlocks and sprint finalization; only tasks with merge evidence enter the feature-merge wait path.
- when `featurePrAutoMergeMode = "WHEN_GREEN"` but a matched feature PR has no checks, Code UX inspects local `.github/workflows/*.yml` files and skips CI waiting only when it can confidently determine that no `pull_request` or `pull_request_target` workflow applies to that PR base branch.
- feature PR review blocking treats `CHANGES_REQUESTED` as authoritative and no longer blocks solely because GitHub reports incidental PR comments while `reviewDecision` is empty. This avoids Jules bot introduction comments holding otherwise merge-ready task PRs.
- remote GitHub polling keeps recorded task PR URLs in scope for merged-PR filtering and asks GraphQL for the maximum merged-PR page size, so older merged task PRs can still settle their tasks instead of falling back to an endless merge-required state.
- `waitForJulesCiAutofix` (default `false`): shown under Settings -> Integrations -> Jules. When enabled with `featurePrAutoMergeMode = "WHEN_GREEN"`, failed feature-PR checks on Jules-managed tasks are first sent back to the existing Jules session with CI context. When disabled, Code UX skips that Jules-specific notification path and dispatches a worker-owned `ci_fix_required` item instead. Pending/failed CI still keeps the task in work status until checks clear or guardrails escalate.
- `julesCiAutofixMaxRetries` (default `3`, clamped to `0..20`): shown under Settings -> Integrations -> Jules. Max CI autofix attempts before escalation to intervention (`FULL -> AGENT`, `SEMI_AUTO/ALWAYS_ASK -> HUMAN`) with explicit task IDs, PR links, and failed check names. The retry cap applies to the CI-fix guardrail whether the attempt is a Jules session notification or a worker repair.
- `featurePrAutoMergeMode` (default `"ALWAYS"`):
  - `"OFF"`: no feature PR auto-merge
  - `"CREATE_PR"`: open or reuse the feature PR, then stop before auto-merge and mark the task settled with `PR_ONLY`
  - `"WHEN_GREEN"`: auto-merge when merge gates are clear, including green or confidently-not-applicable CI
  - `"ALWAYS"`: attempt auto-merge without waiting for CI, while still respecting merge conflicts and configured review-comment blockers
- `mainBranchAutoMergeMode` (default `"ALWAYS"`):
  - `"OFF"`: Code UX does not automatically open or merge the final `feature -> default` PR
  - `"CREATE_PR"`: when sprint work is complete, Code UX opens or resolves the main PR but does not auto-merge it; the sprint run pauses until a human merges the PR and resumes the sprint
  - `"WHEN_GREEN"`: when sprint work is complete, Code UX opens or resolves the main PR if needed, auto-merges after the main merge gate is green, and keeps the sprint active until GitHub reports the PR as merged
  - `"ALWAYS"`: when sprint work is complete, Code UX opens or resolves the main PR if needed, attempts the merge without waiting for CI, and keeps the sprint active until GitHub reports the PR as merged

`mcpTools` contains:
- `name` (MCP tool name from `src/contracts/mcp-tool-definitions.ts`)
- `enabled` (whether tool is visible in MCP `list_tools` and callable)
- `isInternal` (reserved/internal metadata; currently all built-in tools are internal)

`customMcpServers` contains user-configurable provider MCP servers. New and sanitized settings include a default enabled `playwright` stdio server (`npx @playwright/mcp@latest`) for local CLI providers. Settings resolution treats a user or project server with the same stable id or `playwright` name as the same seeded server, so custom edits replace the default instead of creating duplicates. Docker provider runs do not inherit arbitrary MCP servers from copied local provider config files; runtime strips local `mcpServers` / `mcp_servers.*` entries from mounted auth config and injects only the Code UX-managed MCP servers that are enabled on the MCP settings page. The Settings → MCP local setup panel can also write the current Code UX HTTP MCP URL and bearer token into local CLI config files for Claude Code, Gemini, Codex, Qwen Code, OpenCode, and Antigravity.

Repository demo script:
- `.code-ux/container/setup.sh` is included as a baseline bootstrap script.
- Packaged desktop installs also ship this script as a default asset. On first use, Code UX copies it to `~/.code-ux/container/setup.sh` when that file does not already exist, so Docker can mount a normal user-directory script instead of relying on a repo checkout.
- It verifies `npm`, ensures `git` + `gh`, installs `pnpm` when needed, and leaves provider CLI installation to the runtime's provider-specific fallback.
- `npm` refresh is now opt-in via `CODE_UX_REFRESH_NPM=1` instead of happening on every container start.
- Playwright bootstrap is controlled by the Docker Runtime `containerInstallPlaywrightBrowsers` setting. Provider coding containers enable it by default through `CODE_UX_INSTALL_PLAYWRIGHT=1`, while preview containers keep it disabled by default. Cached setup images install Chromium and OS dependencies once during image build under `/ms-playwright`; later provider containers inherit `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright` and skip browser installation unless the cache is disabled or rebuilt.
- Docker CLI execution now uses isolated Docker volumes as the workspace backing store instead of repo-local worktrees or persistent host-side runtime homes.
  - container `/workspace` contains only the Git checkout used for the coding task
  - provider `HOME` lives in a sibling runtime volume mounted at `/code-ux-runtime-home`, so CLI auth/config/cache/session state does not appear inside the Git worktree
  - workspace and runtime volumes are created with deterministic Code UX names and labels; fresh provider containers should not create anonymous Docker volumes
  - provider runtime containers use Docker bridge networking without published ports, add `no-new-privileges`, and keep managed labels for cleanup. Loopback MCP URLs are rewritten to `host.docker.internal` for Docker Desktop/WSL-style host reachability; on Linux Docker Engine runs with loopback MCP endpoints also add `--add-host host.docker.internal:host-gateway` so the bridge-networked container can reach the host without exposing container ports. Set `CODE_UX_DOCKER_REWRITE_LOCALHOST=0` to opt out.
  - write-back happens via Git patch artifacts applied on the host, not direct file sync from the container
  - patch export preserves raw `git diff --binary` output byte-for-byte so whitespace-only EOF hunks and `\ No newline at end of file` markers still apply cleanly on the host branch
  - patch export still excludes legacy `/workspace/.code-ux-home` paths and root `/workspace/.pnpm-store` package-cache paths as a defense-in-depth guard for older preserved volumes, and untracked export staging asks Git to discover paths internally so large file sets do not exceed Docker command-line limits; fresh Docker workspaces should not contain provider home/cache state
  - the remaining persistent Docker-side cache is the optional setup-image cache, not per-session provider home directories under `~/.code-ux/runtime/docker`
- If setup script is missing or does not provide the requested provider CLI, the runner attempts a provider-specific fallback install (`gemini`, `codex`, or `claude`) before failing.
  - CLI model settings continue to flow into Docker-backed providers:
    - Gemini: `GEMINI_MODEL`
    - Codex: `CODEX_MODEL` plus `--model` when applicable
    - Claude Code: `--model` when applicable
  - When `containerCacheSetupScriptImage` is enabled and a setup script is present, runtime first tries to reuse a prebuilt image named like `code-ux-setup-cache-node-24-bookworm:<hash>` instead of rerunning the setup script on every container launch. The hash covers the base image, setup script content, Playwright browser install setting, and setup-cache Dockerfile content. Build contexts and lock directories live under the repo-scoped Docker runtime root, so cache hits survive dashboard restarts and concurrent launches wait for one build instead of triggering duplicate builds.
  - Docker-backed CLI provider containers honor `containerMemoryLimitMb`. A positive value becomes `--memory=<value>m --memory-swap=<value>m` for every provider runtime launched through `DockerRunner`, including task coding, QA, planning, CI-fix, merge-conflict, remediation, and dashboard-chat paths that use CLI providers. Set it to `0` only when the host should manage provider memory without a Docker hard limit.
  - An empty `containerSetupScriptPath` still participates in caching because runtime resolves the default script chain automatically, including the bundled Code UX setup script.
  - `claude` fallback uses the official installer: `curl -fsSL https://claude.ai/install.sh | bash`
  - Claude runner uses explicit headless prompt mode (`claude -p "<prompt>"`) with `--dangerously-skip-permissions`.
  - When Claude credential mounts are enabled, runtime mounts `~/.claude` and also the sibling `~/.claude.json` when present.
  - When Gemini credential mounts are enabled, runtime now syncs only stable top-level auth/config files into container home (`settings.json`, `oauth_creds.json`, `google_accounts.json`, `installation_id`, `state.json`, `trustedFolders.json`) instead of recursively copying mutable `.gemini/tmp` and history state.
  - Provider-specific auth mount settings (`mountAuth` and `authPath`) are part of the resolved provider route and must be forwarded by every CLI invocation path, including task coding, QA review, QA follow-up implementation, dashboard chat, native-MCP dashboard replies, and chat compaction. This keeps Gemini Docker runs on copied local OAuth credentials instead of falling back to an unrelated API-key or Google Cloud project path.
  - Runtime syncs only Claude auth artifacts into container home before launch (`~/.claude/.credentials.json` and `~/.claude.json`) instead of recursively copying the full `.claude` state tree.
  - GitHub sync still copies directory contents into a fixed destination (`~/.config/gh`); Gemini now avoids recursive state copy so concurrent Docker sessions do not race on shared `.gemini/tmp` output files.
  - Provider auth mounts are controlled per credential type. When a Docker auth mount is enabled, the matching API key/token is no longer injected into the container environment.
  - Provider-generated MCP/config files are not bind-mounted directly into provider home; runtime stages them under `/opt/provider-config/*` and merges or appends them into `/code-ux-runtime-home` during bootstrap so provider CLIs can keep existing auth/config state while still receiving runtime MCP wiring.
  - Gemini bootstrap now pre-seeds `~/.gemini/projects.json` plus the `tmp/`, `history/`, and `memory/` directories so the CLI does not hit its first-write race on a brand-new isolated home.

Worker runtime notes:
- virtual workers are now the only supported worker mode
- virtual workers create ephemeral `worker_endpoints` rows with `endpoint_type = virtual_cli`
- virtual workers do not create MCP connection rows, so the connection tab remains MCP-only
- virtual worker startup reconciliation only schedules projects with claimable queued dispatches; already-running dispatches are monitored by recovery/watch-loop paths and do not create new virtual worker cycles

Runtime cleanup notes:
- cleanup treats expired sprint leases as stale, not active ownership
- when a stale `running` sprint run has no active dispatches and its heartbeat is older than the cleanup cutoff, Code UX fails that run and releases the expired sprint lease in the same sweep
- startup now prunes orphaned virtual worker endpoints before new virtual cycles begin
- startup schedules a fast, label-filtered stale Docker workspace prune for untracked, unrecoverable, and outdated sessions while preserving content-addressed setup-cache images for reuse. Tracked CLI sessions marked `FAILED` or `CANCELLED` remain protected so same-workspace task retry can resume their Docker workspace/runtime volumes.
- successful CLI task runs now preserve their workspace while the owning sprint is still non-terminal (so QA follow-up and sprint-side retries can continue in the same workspace handle)
- preserved workspaces are tagged by persisted task-run workspace metadata (including Docker `docker-volume://...` handles) and cleaned when the sprint reaches a terminal state (`completed`, `failed`, or `cancelled`); cleanup removes both the workspace volume and its `-runtime` provider-state volume
- Docker-backed planning invocations also use a stable project/sprint snapshot workspace and paired provider runtime volume. Failed or incomplete planning runs leave it in place so Restart/Continue can resume provider-local session state instead of starting from a cleaned throwaway snapshot; successful planning removes the workspace and runtime volume.
- terminal sprint completion/failure/cancellation removes those retained CLI task workspaces immediately instead of waiting for the next restart sweep
- sprint planning and prompt improvement also honor worker mode, so `VIRTUAL` projects can plan without any live MCP listener

## Default Values

Defined in:
- `src/repositories/settings-defaults.ts` (backend canonical defaults)
- `src/repositories/settings-sanitizer.ts` (backend sanitization + normalization)
- `src/repositories/settings-db-storage.ts` (sqlite persistence and migration path resolution)
- `dashboard/src/lib/settings.ts` (frontend default clone)

## External Settings Hints

`src/config/external-settings.ts` loads hints from:
- environment
- settings json

Used to prefill missing values in dashboard import flow:
- `GET /api/settings/import-sources`

## Skill Enablement

Internal skills are persisted with `enabled` flags.
Git manager skill toggles are mode-aware:
- `REMOTE` mode enables `git_manager_remote` and disables `git_manager_local`
- `LOCAL` mode does the reverse
- `git_manager` base skill remains enabled

## Recommended Policy

- Keep secrets in environment or local secured settings.
- Use system settings for secrets/runtime behavior and project or sprint overrides for execution behavior.
- Treat sqlite DB as local runtime state, not source-of-truth config for production deployment.

## Dashboard Port Resolution

Runtime precedence for dashboard port is:
1. Bound runtime port (actual listening port; may differ when fallback increments)
2. Dashboard settings (`dashboardPort`) in sqlite settings
3. `.code-ux/settings.json` (`dashboardPort`)
4. `.env` (`DASHBOARD_PORT`)
5. `config.json`
6. Default `4444`

If the configured port is already occupied, startup automatically increments by one (`4444`, `4445`, `4446`, ...) until a free port is found.
