# Configuration and Storage

This guide explains runtime config sources, precedence, and persistence.

## Startup Config Sources

`src/config/app-config.ts` resolves API key in this order:

1. CLI `--api-key`
2. `JULES_API_KEY` or `JULES_KEY`
3. `.jules-subagents/settings.json` key fields

Additional startup config:
- `JULES_API_BASE_URL` (default: `https://jules.googleapis.com/v1alpha`)
- `DASHBOARD_PORT` (default: `4444`)
- `JULES_DOCKER_HOST_WORKSPACE_ROOT` (optional path mapping for Docker-in-Docker/remote-daemon setups)
- `JULES_DOCKER_HOST_HOME_ROOT` (optional home-dir path mapping for Docker credential mounts)

External hint env keys used for dashboard import:
- `JULES_API_KEY` / `JULES_KEY`
- `GEMINI_API_KEY`
- `OPENAI_API_KEY` (Codex CLI)
- `GH_TOKEN` / `GITHUB_TOKEN`

## Settings JSON Search Paths

For `.jules-subagents/settings.json`, search roots include:
- current working directory
- project root
- home directory

## Dashboard Settings Persistence

Backend file:
- `src/repositories/settings-repository.ts`

Storage:
- sqlite DB at `~/.jules-subagents/settings.db`
- provider session DB at `~/.jules-subagents/session-tracking.db`

Legacy migration:
- If new DB missing and `~/jules-subagents/settings.db` exists, it is copied to dot-dir.

## Persisted Dashboard Settings Model

Top-level fields:
- `automationLevel`
- `automationInterventions`
- `aiProvider`
- `git`
- `ciIntelligence`
- `sprintLoopSteps`
- `cliWorkflow`
- `skills`
- `mcpTools`

`aiProvider` contains:
- `provider` (`jules|gemini|codex`)
- `strategy` (`MANUAL|WEIGHTED|ORCHESTRATOR`)
- `providers` map (enabled/model/weight/thinkingMode/apiKey per provider)
- `julesApiKey` (backward-compatible alias synced with `providers.jules.apiKey`)

`automationInterventions` contains:
- `autoApprovePlan` (default `true`): auto-approve `AWAITING_PLAN_APPROVAL` sessions in `SEMI_AUTO`
- `autoAnswerClarification` (default `false`): auto-answer `AWAITING_USER_FEEDBACK` sessions in `SEMI_AUTO`
- `autoResumePaused` (default `false`): auto-send resume nudge for `PAUSED` sessions in `SEMI_AUTO`
- `clarificationAnswerTemplate`: default response body used for clarification auto-replies

Backend contract:
- `src/contracts/app-types.ts`

Frontend contract:
- `dashboard/src/types.ts`

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
    - if empty, falls back to `.jules-subagents/container/setup.sh` in repo root, server working directory, then home directory
  - `containerMountCredentials` (master toggle)
  - `containerMountGitConfig`
  - `containerMountGithubAuth`
  - `containerMountGeminiAuth`
  - `containerMountCodexAuth`
  - `containerGithubAuthPath` (default `~/.config/gh`)
  - `containerGeminiAuthPath` (default `~/.gemini`)
  - `containerCodexAuthPath` (default `~/.codex`)

`sprintLoopSteps` also includes:
- `watchLoopIntervalSeconds` (default `120`, clamped to `1..3600`)
- `watchLoopOutputIntervalSeconds` (default `300`, clamped to `60..3600`): max watch-loop runtime before returning an in-progress status and rerun instruction

`ciIntelligence` also includes:
- `enableLivePrMonitoring` (default `true`): controls live PR/CI monitoring gates in sprint loop (`REMOTE` mode only; auto-disabled in `LOCAL` mode).
- `waitForJulesCiAutofix` (default `false`): when enabled with feature-branch CI gating, completed tasks stay in work status while feature PR checks are pending/failed so Jules can apply CI autofix before merge.
- `julesCiAutofixMaxRetries` (default `3`, clamped to `0..20`): max Jules CI autofix notify attempts before escalation to intervention (`FULL -> AGENT`, `SEMI_AUTO/ALWAYS_ASK -> HUMAN`) with explicit task IDs, PR links, and failed check names.
- `featurePrAutoMergeMode` (default `"OFF"`):
  - `"OFF"`: no feature PR auto-merge
  - `"WHEN_GREEN"`: auto-merge when merge gates are clear. If `waitForCiBeforeFeatureMerge` is enabled, this requires green checks; if disabled, CI status is not waited on.
  - `"ALWAYS"`: always attempt feature PR auto-merge (still subject to repository merge protection/rules)

`mcpTools` contains:
- `name` (MCP tool name from `src/contracts/mcp-tool-definitions.ts`)
- `enabled` (whether tool is visible in MCP `list_tools` and callable)
- `isInternal` (reserved/internal metadata; currently all built-in tools are internal)

Repository demo script:
- `.jules-subagents/container/setup.sh` is included as a baseline bootstrap script.
- It installs/updates `npm`, ensures `git` + `gh`, installs `pnpm`, `@google/gemini-cli`, `@openai/codex`, and Playwright Chromium (+ deps when root/apt is available).
- Docker provider runner stores runtime state outside the project under `~/.jules-subagents/runtime/docker/<repo-hash>/` by default:
  - `home/` (container `HOME`)
  - `npm-global/` (CLI fallback install prefix)
  - `npm-cache/` (npm cache)
  - Codex runs use isolated per-session homes (`home-codex-<session-id>`) to avoid stale local state interference between runs.
  - Optional override: `JULES_DOCKER_RUNTIME_ROOT` (absolute path, `~` supported, repo-relative when relative)
- If setup script is missing or does not provide the requested provider CLI, the runner attempts a provider-specific fallback install (`gemini`, `codex`, or `claude`) before failing.
  - `claude` fallback uses the official installer: `curl -fsSL https://claude.ai/install.sh | bash`
  - Claude runner uses explicit headless prompt mode (`claude -p "<prompt>"`) with `--dangerously-skip-permissions`.
  - When Claude credential mounts are enabled, runtime mounts `~/.claude` and also `~/.claude.json` when present.
  - Runtime syncs only Claude auth artifacts into container home before launch (`~/.claude/.credentials.json` and `~/.claude.json`) instead of recursively copying the full `.claude` state tree.
  - GitHub/Gemini sync now copies directory contents into fixed destinations (`~/.config/gh`, `~/.gemini`) to avoid nested paths on repeated runs.

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
- Use dashboard settings for behavior toggles, not hardcoded logic edits.
- Treat sqlite DB as local runtime state, not source-of-truth config for production deployment.
