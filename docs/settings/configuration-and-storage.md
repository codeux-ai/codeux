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

External hint env keys used for dashboard import:
- `JULES_API_KEY` / `JULES_KEY`
- `GEMINI_API_KEY`
- `OPENAI_API_KEY` (Codex CLI)
- `GH_TOKEN` / `GITHUB_TOKEN`

## Settings JSON Search Paths

For `.code-ux/settings.json`, search roots include:
- current working directory
- project root
- home directory

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

Runtime resolution:
- effective runtime settings always resolve as `system -> project -> sprint`
- project settings inherit live system defaults; they do not snapshot them
- project saves are diffed against the current system defaults, not hardcoded app defaults
- sprint settings are sparse temporary overrides on top of resolved project settings
- orchestration, worker dispatch, and selected-project CI tracking resolve effective settings for the active project or sprint at runtime instead of using only the startup system snapshot
- `git.defaultBranch` resolves with the following precedence:
  1. Sprint setting override (Dashboard)
  2. Project setting override (Dashboard)
  3. Project metadata `defaultBranch` field (Database)
  4. System setting default (Dashboard)
  5. Hardcoded default (`main`)
- In remote git mode, Code UX refreshes `origin` before sprint branch preflight and before each task start so branch resolution is based on current remote state instead of stale local refs.
- HTTPS GitHub remotes use the configured dashboard token as a temporary Git extraheader during origin refresh, remote branch checks, and branch pushes. HTTPS origin refreshes and branch preflight network checks run with interactive credential prompts disabled and a bounded timeout so orchestration cannot remain stuck waiting on local credential helpers. If direct remote inspection is unavailable, branch preflight can use an existing `refs/remotes/origin/<branch>` ref as remote-branch evidence. Local origin-refresh failures remain strict for CLI-backed work that needs local git state, but are best-effort for branch preflight and Jules dispatch because Jules works from the remote source and starting branch. SSH remotes continue to use the local SSH agent/key setup unchanged.
- In remote git mode, Code UX also refreshes `origin` before branch-sensitive recovery flows such as QA review, QA follow-up continuation, clarification auto-replies, CI fix runs, and merge-conflict resolution. Clarification auto-replies refresh the recorded task worker branch when available; if the task has no worker branch yet, they refresh the scoped `git.defaultBranch` so project-level default branch overrides are used instead of falling back to `main`.
- QA review execution uses an isolated snapshot workspace in Docker so review inspection does not mutate the task workspace directly.
- QA-requested CLI follow-up work continues in the original task workspace when that workspace is still available.
- CI autofix follow-up work reuses the existing task workspace for the same worker branch when available instead of always creating a fresh workspace.
- if Docker is unavailable during a CI autofix follow-up, Code UX falls back to a host-backed git worktree for that repair run instead of escalating immediately or creating another doomed Docker attempt.
- Merge-conflict resolution remains isolated in its own Docker workspace even when the underlying task already has a reusable task workspace.
- On startup, Code UX prunes stale Code UX Docker workspace volumes and cached setup-script images so finished, failed, unrecoverable, and outdated Docker assets do not accumulate across restarts.
- restart recovery also treats interrupted Docker sessions without a live backing container as failed, so abandoned workspaces are reclaimed instead of waiting forever for a callback that cannot arrive.
- startup recovery now also requeues task-level CLI follow-up runs that were left in `in_progress` after QA/repair `Fix` work lost its backing container, so the orchestrator can start the container again instead of leaving the sprint stuck after a server restart.
- When Code UX has to create a missing feature branch, it prefers `origin/<defaultBranch>` over the local `<defaultBranch>` ref when the remote-tracking base branch exists.
- `main` is only the final fallback when no sprint, project, or system base branch is configured. Normal sprint and task flows use the resolved `git.defaultBranch` value from settings and project metadata.
- the old global `/api/settings` contract is removed in favor of explicit scoped endpoints

## Persisted Scoped Settings Model

`system_settings` fields:
- `runtime`
  - `dashboardPort`
  - `enableDebugLogFile`
  - `consoleLogLevel` (`standard` by default; `full` also prints routine dashboard HTTP request logs)
- `integrations`
  - `julesApiKey`
  - `geminiApiKey`
  - `codexApiKey`
  - `claudeCodeApiKey`
  - `githubToken`
  - `gitlabToken`
- `defaults`
  - full inheritable project settings baseline
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
  - `agents`
  - `skills`

`sprint_settings` fields:
- sparse overrides of the same project-level fields
- used only for sprint-local deviations from the resolved project baseline

System-level integrations are injected into effective dashboard settings at resolution time:
- provider credentials are system-scoped under `integrations.providers`
  - each entry is a named provider instance with `{ provider, name, apiKey, mountAuth, authPath }`
  - default instance ids intentionally match the base provider ids (`jules`, `gemini`, `codex`, `claude-code`) for compatibility with older settings payloads
  - additional instances can coexist under the same CLI type
  - for CLI providers, `mountAuth` and `authPath` are instance-specific Docker auth-copy settings, so multiple Codex/Gemini/Claude entries can each point at different local credential directories
- `git.githubToken` and `git.gitlabToken` are system-scoped
- runtime fields like `dashboardPort` and `enableDebugLogFile` are system-scoped
- project and sprint scopes still own `cliWorkflow.containerMountGithubAuth`, `cliWorkflow.containerGithubAuthPath`, and `cliWorkflow.containerMountGitConfig`

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
- sprint override dialogs use the same field-level source metadata and show override badges only for sprint-local overrides
- the v2 settings page includes a quick-find field (keyboard shortcut `/`) that filters categories without changing the scoped settings model
- the main settings editor is composed of smaller panel modules for better maintainability (e.g., automation, provider, worker, QA controls) instead of one monolithic component.
- AI provider configuration and catalog metadata are centralized in `settings-view-models.ts` instead of directly within the editor.
- AI provider configuration now uses compact focused workspaces instead of only long card grids:
  - one provider is edited at a time in the provider deck detail panel
  - invocation routing is edited in a split-pane route workspace with resolved default, provider-pool, and override summaries
- common 2-3 option settings such as routing strategy, worker execution mode, execution runtime, and merge mode use pill controls for faster scanning than dropdown-heavy forms
- the Integrations panel restores the Git host workspace:
  - system scope edits the GitHub token, GitLab token, Jira connection, and per-instance CLI auth sources
  - project and sprint scopes edit GitHub auth-copy mounts and gitconfig sharing for Docker runs
- Jira integration settings include the site URL, account email, API token, default project key used by sprint import JQL, close transition name, and a Jira-specific linked-issue auto-close toggle. Effective dashboard settings project this system-owned Jira connection into `settings.jira` for Jira search, issue context loading, and completion transitions.
- integration and AI model provider tiles use vendored, pinned Lobe Icons SVG brand marks for Jules/Google, Gemini, Codex, Claude, Qwen, OpenCode, GitHub, and GitLab identity; Jira uses the in-app Jira mark.

`aiProvider` contains:
- `provider` (`ProviderConfigId|null`)
- `strategy` (`MANUAL|WEIGHTED|ORCHESTRATOR`)
- `providers` map keyed by provider config id
  - each provider config stores `provider`, `name`, `enabled`, `model`, `weight`, `thinkingMode`, and `maxConcurrentTasks`
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
  - each route contains:
    - `profile` (`GLOBAL|WORKER`)
      - `GLOBAL`: inherit the top-level `aiProvider.provider`, `aiProvider.strategy`, and per-provider defaults
      - `WORKER`: inherit the worker runtime preference (`workers.virtualWorkerProvider`) and worker model override (`workers.model`) as the default baseline for that invocation
    - `strategy` (`MANUAL|WEIGHTED|ORCHESTRATOR`)
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
  - dashboard replies, clarification auto-answer, and QA review runs in `WORKER` mode now follow the preferred worker CLI provider/model by default instead of accidentally inheriting whichever global provider happened to match.

`automationInterventions` contains:
- `autoApprovePlan` (default `true`): auto-approve `AWAITING_PLAN_APPROVAL` sessions in `SEMI_AUTO`
- `autoAnswerClarification` (default `false`): auto-answer `AWAITING_USER_FEEDBACK` sessions in `SEMI_AUTO`
- `autoResumePaused` (default `false`): auto-send resume nudge for `PAUSED` sessions in `SEMI_AUTO`
- `clarificationAnswerTemplate`: default response body used for clarification auto-replies
- `clarificationCooldownSeconds` (default `300`): retained for compatibility, but clarification dedupe now keys off the latest clarification content instead of elapsed time; once Code UX starts answering a specific clarification request, repeated cycles skip starting or sending another answer for the same question until Jules emits a different clarification prompt
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
- `qualityAssurance`
  - `enabled` (default `false`)
  - `maxTaskReviewRuns` (default `1`)
  - `taskCompletion`
    - `enabled`
    - `agentPresetId`
  - `sprintCompletion`
    - `enabled`
    - `agentPresetId`
  - `completedTaskWithoutPr`
    - `enabled`
    - `agentPresetId`

Quality assurance settings are project-scoped today and are edited from `Settings -> Agents`. When task-level QA is enabled, successful CLI task runs preserve their worktree long enough for a QA follow-up pass to resume the same session/worktree if fixes are required.

QA merge-gate notes:
- task QA now runs on code-complete tasks before Code UX auto-merges their feature PRs
- enabled task QA blocks feature merge until QA passes or `maxTaskReviewRuns` is exhausted
- while task QA is pending or retrying, the runtime merge indicator can be `QA_PENDING`
- the initial task review always counts as run `1`; later runs are only used for QA-requested fix checks
- `maxTaskReviewRuns = 1` means only the initial task or sprint review is checked by QA
- `maxTaskReviewRuns = 2` means the initial review plus one QA re-check after fixes
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
- Runtime mode:
  - `executionMode` (`HOST|DOCKER`)
- Docker runtime config:
  - `containerImage`
  - `containerSetupScriptPath` (optional; when set to a relative path, runtime checks both sprint repo root and current server working directory)
    - if empty, falls back to `.code-ux/container/setup.sh` in repo root, then home directory, then the bundled Code UX default script
  - `containerCacheSetupScriptImage` (default `false`)
    - when enabled, Docker runtime builds and reuses a derived image keyed by the base image plus setup script contents
    - cache misses fall back to the current per-run setup script path if the image build fails
  - `containerMountGitConfig` (default `true`)
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

`workers` contains:
- `executionMode` (default `VIRTUAL`)
  - `VIRTUAL`: Code UX spins up an internal one-shot CLI worker when worker-owned attention exists, handles one cycle in an isolated container workspace, then tears it down
- `virtualWorkerProvider` (default `codex`)
  - allowed values: `gemini`, `codex`, `claude-code`
  - Jules is intentionally excluded from worker mode; virtual workers are CLI-only
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
- Docker-volume workspace bootstrap uses public helper images such as `alpine/git`. Code UX verifies or pulls these helpers automatically, and if a stale host Docker credential helper blocks a public pull, retries that helper pull with an isolated empty Docker client config.
- Docker workspace bootstrap now rejects configured project paths that are nested inside a different Git checkout; this prevents Git from walking up to a parent repo and producing misleading no-change task completions.
- write-back from isolated CLI runs uses a Git patch artifact applied on the host branch, not direct file syncing from the container
- merge-conflict preparation and CI-fix Git commands must execute through the workspace runner; host-path Git invocations against `docker-volume://...` workspace handles are not valid

`sprintLoopSteps` also includes:
- `watchLoopIntervalSeconds` (default `10`, clamped to `1..3600`)
- `watchLoopOutputIntervalSeconds` (default `300`, clamped to `60..3600`): max watch-loop runtime before returning an in-progress status and rerun instruction

`ciIntelligence` also includes:
- `enableLivePrMonitoring` (default `true`): controls live PR/CI monitoring gates in sprint loop (`REMOTE` mode only; auto-disabled in `LOCAL` mode).
- Code UX state is currently backed by SQLite via `DatabaseAdapter`, but is staged for a Postgres migration (see [Postgres Migration Plan](../architecture/postgres-migration-plan.md)).
- `resolveMainMergeConflicts` (default `false`): when enabled, a `feature -> main` PR in `DIRTY` merge state opens a worker-owned `merge_conflict` attention item with repo path, working-directory hint, conflicting branches, PR metadata, sprint context, and merged task prompts already present on the feature branch.
- `resolveMergeConflicts` (default `false`): when enabled, feature PRs in `DIRTY` merge state open a dedicated worker-owned `merge_conflict` attention item instead of a generic merge-required item. The payload includes repo path, working directory hint, source/target branches, PR details, the current task prompt, and merged task prompts already on the feature branch so the virtual worker can resolve the conflict with full context.
- worker-owned merge conflicts do not end the watch loop as manual merge work anymore; Code UX keeps the loop alive while the selected worker runtime is expected to handle the conflict, and the dashboard no longer projects those worker-owned conflict items as human intervention.
- feature PRs with `mergeStateStatus = DIRTY` short-circuit the feature-merge CI wait path; Code UX marks them as merge conflicts immediately instead of waiting for checks that cannot start until the conflict is resolved.
- completed tasks with no recorded worker branch or PR URL are treated as already settled for dependency unlocks and sprint finalization; only tasks with merge evidence enter the feature-merge wait path.
- when `featurePrAutoMergeMode = "WHEN_GREEN"` but a matched feature PR has no checks, Code UX inspects local `.github/workflows/*.yml` files and skips CI waiting only when it can confidently determine that no `pull_request` or `pull_request_target` workflow applies to that PR base branch.
- `waitForJulesCiAutofix` (default `false`): when enabled with `featurePrAutoMergeMode = "WHEN_GREEN"`, completed tasks stay in work status while feature PR checks are pending/failed so Jules can apply CI autofix before merge.
- `julesCiAutofixMaxRetries` (default `3`, clamped to `0..20`): max Jules CI autofix notify attempts before escalation to intervention (`FULL -> AGENT`, `SEMI_AUTO/ALWAYS_ASK -> HUMAN`) with explicit task IDs, PR links, and failed check names.
- `featurePrAutoMergeMode` (default `"OFF"`):
  - `"OFF"`: no feature PR auto-merge
  - `"CREATE_PR"`: open or reuse the feature PR, then stop before auto-merge and mark the task settled with `PR_ONLY`
  - `"WHEN_GREEN"`: auto-merge when merge gates are clear, including green or confidently-not-applicable CI
  - `"ALWAYS"`: attempt auto-merge without waiting for CI, while still respecting merge conflicts and configured review-comment blockers
- `mainBranchAutoMergeMode` (default `"OFF"`):
  - `"OFF"`: Code UX does not automatically open or merge the final `feature -> default` PR
  - `"CREATE_PR"`: when sprint work is complete, Code UX opens or resolves the main PR but does not auto-merge it
  - `"WHEN_GREEN"`: when sprint work is complete, Code UX opens or resolves the main PR if needed, then auto-merges after the main merge gate is green
  - `"ALWAYS"`: when sprint work is complete, Code UX opens or resolves the main PR if needed and attempts the merge without waiting for CI

`mcpTools` contains:
- `name` (MCP tool name from `src/contracts/mcp-tool-definitions.ts`)
- `enabled` (whether tool is visible in MCP `list_tools` and callable)
- `isInternal` (reserved/internal metadata; currently all built-in tools are internal)

Repository demo script:
- `.code-ux/container/setup.sh` is included as a baseline bootstrap script.
- It verifies `npm`, ensures `git` + `gh`, installs `pnpm` when needed, and leaves provider CLI installation to the runtime's provider-specific fallback.
- `npm` refresh is now opt-in via `CODE_UX_REFRESH_NPM=1` instead of happening on every container start.
- Playwright bootstrap is now opt-in via `CODE_UX_INSTALL_PLAYWRIGHT=1` instead of downloading Chromium during every fresh container bootstrap.
- Docker CLI execution now uses isolated Docker volumes as the workspace backing store instead of repo-local worktrees or persistent host-side runtime homes.
  - container `HOME` lives inside the isolated workspace at `/workspace/.code-ux-home`
  - write-back happens via Git patch artifacts applied on the host, not direct file sync from the container
  - patch export preserves raw `git diff --binary` output byte-for-byte so whitespace-only EOF hunks and `\ No newline at end of file` markers still apply cleanly on the host branch
  - patch export always excludes `/workspace/.code-ux-home` so provider home/cache state cannot be committed, even when the target repository does not ignore `.cache/` or `.code-ux-home/`
  - the remaining persistent Docker-side cache is the optional setup-image cache, not per-session provider home directories under `~/.code-ux/runtime/docker`
- If setup script is missing or does not provide the requested provider CLI, the runner attempts a provider-specific fallback install (`gemini`, `codex`, or `claude`) before failing.
  - CLI model settings continue to flow into Docker-backed providers:
    - Gemini: `GEMINI_MODEL`
    - Codex: `CODEX_MODEL` plus `--model` when applicable
    - Claude Code: `--model` when applicable
  - When `containerCacheSetupScriptImage` is enabled and a setup script is present, runtime first tries to reuse a prebuilt `code-ux-setup-cache:<hash>` image instead of rerunning the setup script on every container launch.
  - An empty `containerSetupScriptPath` still participates in caching because runtime resolves the default script chain automatically, including the bundled Code UX setup script.
  - `claude` fallback uses the official installer: `curl -fsSL https://claude.ai/install.sh | bash`
  - Claude runner uses explicit headless prompt mode (`claude -p "<prompt>"`) with `--dangerously-skip-permissions`.
  - When Claude credential mounts are enabled, runtime mounts `~/.claude` and also the sibling `~/.claude.json` when present.
  - When Gemini credential mounts are enabled, runtime now syncs only stable top-level auth/config files into container home (`settings.json`, `oauth_creds.json`, `google_accounts.json`, `installation_id`, `state.json`, `trustedFolders.json`) instead of recursively copying mutable `.gemini/tmp` and history state.
  - Provider-specific auth mount settings (`mountAuth` and `authPath`) are part of the resolved provider route and must be forwarded by every CLI invocation path, including task coding, QA review, QA follow-up implementation, dashboard chat, native-MCP dashboard replies, and chat compaction. This keeps Gemini Docker runs on copied local OAuth credentials instead of falling back to an unrelated API-key or Google Cloud project path.
  - Runtime syncs only Claude auth artifacts into container home before launch (`~/.claude/.credentials.json` and `~/.claude.json`) instead of recursively copying the full `.claude` state tree.
  - GitHub sync still copies directory contents into a fixed destination (`~/.config/gh`); Gemini now avoids recursive state copy so concurrent Docker sessions do not race on shared `.gemini/tmp` output files.
  - Provider auth mounts are controlled per credential type. When a Docker auth mount is enabled, the matching API key/token is no longer injected into the container environment.
  - Provider-generated MCP/config files are no longer bind-mounted directly into `/workspace/.code-ux-home/...`; runtime stages them under `/opt/provider-config/*` and merges or appends them into the writable home during bootstrap so provider CLIs can keep existing auth/config state while still receiving runtime MCP wiring.
  - Gemini bootstrap now pre-seeds `~/.gemini/projects.json` plus the `tmp/`, `history/`, and `memory/` directories so the CLI does not hit its first-write race on a brand-new isolated home.

Worker runtime notes:
- virtual workers are now the only supported worker mode
- virtual workers create ephemeral `worker_endpoints` rows with `endpoint_type = virtual_cli`
- virtual workers do not create MCP connection rows, so the connection tab remains MCP-only

Runtime cleanup notes:
- cleanup treats expired sprint leases as stale, not active ownership
- when a stale `running` sprint run has no active dispatches and its heartbeat is older than the cleanup cutoff, Code UX fails that run and releases the expired sprint lease in the same sweep
- startup now prunes orphaned virtual worker endpoints before new virtual cycles begin
- startup prunes stale Docker workspaces and cached setup images for failed, finished, unrecoverable, and outdated sessions
- terminal sprint completion/failure/cancellation also removes resumable CLI task workspaces immediately instead of waiting for the next restart sweep
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
