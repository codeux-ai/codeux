# Configuration and Storage

This guide explains runtime config sources, precedence, and persistence.

## Startup Config Sources

`src/config/app-config.ts` resolves API key in this order:

1. CLI `--api-key`
2. `JULES_API_KEY` or `JULES_KEY`
3. `.sprint-os/settings.json` key fields

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

For `.sprint-os/settings.json`, search roots include:
- current working directory
- project root
- home directory

## Scoped Settings Persistence

Backend file:
- `src/repositories/settings-repository.ts`
- `src/repositories/settings-db-storage.ts`
- `src/services/settings-resolution-service.ts`

Storage:
- scoped settings DB at `~/.sprint-os/settings.db`
  - `system_settings`
  - `project_settings`
  - `sprint_settings`
  - `app_settings` is retained only as a one-time legacy migration source for development data that predates the scoped model
- provider session DB at `~/.sprint-os/session-tracking.db`
- Sprint OS app DB at `~/.sprint-os/app.db`
  - includes project planning tables (sprints with `original_prompt` and `goal`) plus selected-project runtime projection in `app_settings`, `task_runs`, and `task_run_events`

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
- the old global `/api/settings` contract is removed in favor of explicit scoped endpoints

## Persisted Scoped Settings Model

`system_settings` fields:
- `runtime`
  - `dashboardPort`
  - `enableDebugLogFile`
- `integrations`
  - `julesApiKey`
  - `geminiApiKey`
  - `codexApiKey`
  - `claudeCodeApiKey`
  - `githubToken`
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
  - `agents`
  - `skills`

`sprint_settings` fields:
- sparse overrides of the same project-level fields
- used only for sprint-local deviations from the resolved project baseline

System-level integrations are injected into effective dashboard settings at resolution time:
- provider API keys are system-scoped
- `git.githubToken` is system-scoped
- runtime fields like `dashboardPort` and `enableDebugLogFile` are system-scoped

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

The effective endpoints return:
- resolved `DashboardSettings`
- per-field source metadata (`system`, `project`, or `sprint`)

Dashboard behavior:
- project settings now render a per-setting override badge only when a control is actually overridden at project scope
- sprint override dialogs use the same field-level source metadata and show override badges only for sprint-local overrides

`aiProvider` contains:
- `provider` (`jules|gemini|codex|claude-code`)
- `strategy` (`MANUAL|WEIGHTED|ORCHESTRATOR`)
- `providers` map (enabled/model/weight/thinkingMode)
  - Jules remains routable with `enabled` and `weight`, but the current Jules REST API does not expose model-selection or thinking controls.
  - Dashboard settings editors therefore hide `model` and `thinkingMode` for Jules and show an informational note instead.
  - Gemini alias entries `pro`, `flash`, and `flash-lite` are labeled as recent aliases in selects so it is clear they track the latest model target.

`automationInterventions` contains:
- `autoApprovePlan` (default `true`): auto-approve `AWAITING_PLAN_APPROVAL` sessions in `SEMI_AUTO`
- `autoAnswerClarification` (default `false`): auto-answer `AWAITING_USER_FEEDBACK` sessions in `SEMI_AUTO`
- `autoResumePaused` (default `false`): auto-send resume nudge for `PAUSED` sessions in `SEMI_AUTO`
- `clarificationAnswerTemplate`: default response body used for clarification auto-replies
- `clarificationCooldownSeconds` (default `300`): wait time after an auto-reply/resume before Sprint OS sends another clarification nudge; during this cooldown the task stays in automated recovery and does not open a fresh `action_required` human-escalation path

`cliWorkflow` contains:
- Retry/cleanup toggles:
  - `cleanupWorktreeOnSuccess`
  - `cleanupWorktreeOnFailure`
  - `retryOnReadFileNotFound`
  - `resumeFailedTaskInSameWorkspace`
- Runtime mode:
  - `executionMode` (`HOST|DOCKER`)
- Docker runtime config:
  - `containerImage`
  - `containerSetupScriptPath` (optional; when set to a relative path, runtime checks both sprint repo root and current server working directory)
    - if empty, falls back to `.sprint-os/container/setup.sh` in repo root, then home directory, then the bundled Sprint OS default script
  - `containerCacheSetupScriptImage` (default `false`)
    - when enabled, Docker runtime builds and reuses a derived image keyed by the base image plus setup script contents
    - cache misses fall back to the current per-run setup script path if the image build fails
  - `containerMountGitConfig`
  - `containerMountGithubAuth`

`agents` contains:
- `saveToProjectDirectory` (default `true`)
  - when enabled, dashboard agent create/update writes project-local markdown companions under `.sprint-os/agents`
  - mirrored filenames use lowercase underscore-safe slugs such as `planning_agent.md`
  - default/home markdown sources are never modified by dashboard edits; Sprint OS creates a project-level override file instead
  - `containerMountGeminiAuth`
  - `containerMountCodexAuth`
  - `containerMountClaudeCodeAuth`
  - `containerGithubAuthPath` (default `~/.config/gh`)
  - `containerGeminiAuthPath` (default `~/.gemini`)
  - `containerCodexAuthPath` (default `~/.codex`)
  - `containerClaudeCodeAuthPath` (default `~/.claude`)

`workers` contains:
- `executionMode` (default `CONNECTED_MCP`)
  - `CONNECTED_MCP`: worker-owned dispatches and attention are routed only to connected MCP workers
  - `VIRTUAL`: Sprint OS spins up an internal one-shot CLI worker when worker work exists, handles one planning request, task dispatch, or worker-owned attention item, then tears it down
- `virtualWorkerProvider` (default `codex`)
  - allowed values: `gemini`, `codex`, `claude-code`
  - used only when `executionMode = VIRTUAL`
  - Jules is intentionally excluded from worker mode; virtual workers are CLI-only
- Dashboard worker-runtime editors now surface `virtualWorkerProvider` and worker-model override controls only while `executionMode = VIRTUAL`; connected MCP mode hides those virtual-only controls.
- In the dashboard, these controls are exposed in the active v2 settings page under `Sprint Engine -> Worker Runtime`

`sprintLoopSteps` also includes:
- `watchLoopIntervalSeconds` (default `120`, clamped to `1..3600`)
- `watchLoopOutputIntervalSeconds` (default `300`, clamped to `60..3600`): max watch-loop runtime before returning an in-progress status and rerun instruction

`ciIntelligence` also includes:
- `enableLivePrMonitoring` (default `true`): controls live PR/CI monitoring gates in sprint loop (`REMOTE` mode only; auto-disabled in `LOCAL` mode).
- `resolveMainMergeConflicts` (default `false`): when enabled, a `feature -> main` PR in `DIRTY` merge state opens a worker-owned `merge_conflict` attention item with repo path, working-directory hint, conflicting branches, PR metadata, sprint context, and merged task prompts already present on the feature branch.
- `resolveMergeConflicts` (default `false`): when enabled, feature PRs in `DIRTY` merge state open a dedicated worker-owned `merge_conflict` attention item instead of a generic merge-required item. The payload includes repo path, working directory hint, source/target branches, PR details, the current task prompt, and merged task prompts already on the feature branch so the connected worker can resolve the conflict with full context.
- worker-owned merge conflicts do not end the watch loop as manual merge work anymore; Sprint OS keeps the loop alive while the selected worker runtime is expected to handle the conflict, and the dashboard no longer projects those worker-owned conflict items as human intervention.
- feature PRs with `mergeStateStatus = DIRTY` short-circuit the feature-merge CI wait path; Sprint OS marks them as merge conflicts immediately instead of waiting for checks that cannot start until the conflict is resolved.
- completed tasks with no recorded worker branch or PR URL are treated as already settled for dependency unlocks and sprint finalization; only tasks with merge evidence enter the feature-merge wait path.
- when `waitForCiBeforeFeatureMerge` is enabled but a matched feature PR has no checks, Sprint OS inspects local `.github/workflows/*.yml` files and skips CI waiting only when it can confidently determine that no `pull_request` or `pull_request_target` workflow applies to that PR base branch.
- `waitForJulesCiAutofix` (default `false`): when enabled with feature-branch CI gating, completed tasks stay in work status while feature PR checks are pending/failed so Jules can apply CI autofix before merge.
- `julesCiAutofixMaxRetries` (default `3`, clamped to `0..20`): max Jules CI autofix notify attempts before escalation to intervention (`FULL -> AGENT`, `SEMI_AUTO/ALWAYS_ASK -> HUMAN`) with explicit task IDs, PR links, and failed check names.
- `featurePrAutoMergeMode` (default `"OFF"`):
  - `"OFF"`: no feature PR auto-merge
  - `"WHEN_GREEN"`: auto-merge when merge gates are clear. If `waitForCiBeforeFeatureMerge` is enabled, this requires green checks; if disabled, CI status is not waited on.
  - `"ALWAYS"`: bypass CI waiting only when `waitForCiBeforeFeatureMerge` is disabled. If CI waiting is enabled, Sprint OS still waits for green checks before attempting auto-merge.
- `mainBranchAutoMergeMode` (default `"OFF"`):
  - `"OFF"`: Sprint OS does not automatically open or merge the final `feature -> default` PR
  - `"WHEN_GREEN"`: when sprint work is complete, Sprint OS opens or resolves the main PR if needed, then auto-merges after the main merge gate is green
  - `"ALWAYS"`: when sprint work is complete, Sprint OS opens or resolves the main PR if needed and can merge without CI waiting when `waitForCiBeforeMainMerge` is disabled

`mcpTools` contains:
- `name` (MCP tool name from `src/contracts/mcp-tool-definitions.ts`)
- `enabled` (whether tool is visible in MCP `list_tools` and callable)
- `isInternal` (reserved/internal metadata; currently all built-in tools are internal)

Repository demo script:
- `.sprint-os/container/setup.sh` is included as a baseline bootstrap script.
- It installs/updates `npm`, ensures `git` + `gh`, installs `pnpm`, `@google/gemini-cli`, `@openai/codex`, and Playwright Chromium (+ deps when root/apt is available).
- Docker provider runner stores runtime state outside the project under `~/.sprint-os/runtime/docker/<repo-hash>/` by default:
  - `home/` (container `HOME`)
  - `npm-global/` (CLI fallback install prefix)
  - `npm-cache/` (npm cache)
  - `setup-image-cache/` (generated Docker build contexts for setup-script-derived images)
  - Codex runs use isolated per-session homes (`home-codex-<session-id>`) to avoid stale local state interference between runs.
  - Runtime cleanup automatically prunes stale per-session Codex homes and stale shared runtime temp directories after sessions are no longer active.
  - Optional override: `JULES_DOCKER_RUNTIME_ROOT` (absolute path, `~` supported, repo-relative when relative)
- If setup script is missing or does not provide the requested provider CLI, the runner attempts a provider-specific fallback install (`gemini`, `codex`, or `claude`) before failing.
  - CLI model settings continue to flow into Docker-backed providers:
    - Gemini: `GEMINI_MODEL`
    - Codex: `CODEX_MODEL` plus `--model` when applicable
    - Claude Code: `--model` when applicable
  - When `containerCacheSetupScriptImage` is enabled and a setup script is present, runtime first tries to reuse a prebuilt `sprint-os-setup-cache:<hash>` image instead of rerunning the setup script on every container launch.
  - An empty `containerSetupScriptPath` still participates in caching because runtime resolves the default script chain automatically, including the bundled Sprint OS setup script.
  - `claude` fallback uses the official installer: `curl -fsSL https://claude.ai/install.sh | bash`
  - Claude runner uses explicit headless prompt mode (`claude -p "<prompt>"`) with `--dangerously-skip-permissions`.
  - When Claude credential mounts are enabled, runtime mounts `~/.claude` and also `~/.claude.json` when present.
  - When Gemini credential mounts are enabled, runtime now syncs only stable top-level auth/config files into container home (`settings.json`, `oauth_creds.json`, `google_accounts.json`, `installation_id`, `state.json`, `trustedFolders.json`) instead of recursively copying mutable `.gemini/tmp` and history state.
  - Runtime syncs only Claude auth artifacts into container home before launch (`~/.claude/.credentials.json` and `~/.claude.json`) instead of recursively copying the full `.claude` state tree.
  - GitHub sync still copies directory contents into a fixed destination (`~/.config/gh`); Gemini now avoids recursive state copy so concurrent Docker sessions do not race on shared `.gemini/tmp` output files.
  - Provider auth mounts are controlled per credential type. When a Docker auth mount is enabled, the matching API key/token is no longer injected into the container environment.

Worker runtime notes:
- connected MCP workers remain the default worker mode
- virtual workers create ephemeral `worker_endpoints` rows with `endpoint_type = virtual_cli`
- virtual workers do not create MCP connection rows, so the connection tab remains MCP-only

Runtime cleanup notes:
- cleanup treats expired sprint leases as stale, not active ownership
- when a stale `running` sprint run has no active dispatches and its heartbeat is older than the cleanup cutoff, Sprint OS fails that run and releases the expired sprint lease in the same sweep
- startup now prunes orphaned virtual worker endpoints before new virtual cycles begin
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
3. `.sprint-os/settings.json` (`dashboardPort`)
4. `.env` (`DASHBOARD_PORT`)
5. `config.json`
6. Default `4444`

If the configured port is already occupied, startup automatically increments by one (`4444`, `4445`, `4446`, ...) until a free port is found.
