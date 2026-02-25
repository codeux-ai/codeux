# Configuration and Storage

This guide explains runtime config sources, precedence, and persistence.

## Startup Config Sources

`src/config.ts` resolves API key in this order:

1. CLI `--api-key`
2. `JULES_API_KEY` or `JULES_KEY`
3. `.jules-subagents/settings.json` key fields

Additional startup config:
- `JULES_API_BASE_URL` (default: `https://jules.googleapis.com/v1alpha`)
- `DASHBOARD_PORT` (default: `4444`)

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
- `src/settings-repository.ts`

Storage:
- sqlite DB at `~/.jules-subagents/settings.db`
- provider session DB at `~/.jules-subagents/session-tracking.db`

Legacy migration:
- If new DB missing and `~/jules-subagents/settings.db` exists, it is copied to dot-dir.

## Persisted Dashboard Settings Model

Top-level fields:
- `automationLevel`
- `aiProvider`
- `git`
- `ciIntelligence`
- `sprintLoopSteps`
- `cliWorkflow`
- `skills`

`aiProvider` contains:
- `provider` (`jules|gemini|codex`)
- `strategy` (`MANUAL|WEIGHTED|ORCHESTRATOR`)
- `providers` map (enabled/model/weight/thinkingMode/apiKey per provider)
- `julesApiKey` (backward-compatible alias synced with `providers.jules.apiKey`)

Backend contract:
- `src/types.ts`

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
  - `containerSetupScriptPath` (optional; falls back to `.jules-subagents/container/setup.sh` in repo/home when empty)
  - `containerMountCredentials` (master toggle)
  - `containerMountGitConfig`
  - `containerMountGithubAuth`
  - `containerMountGeminiAuth`
  - `containerMountCodexAuth`
  - `containerGithubAuthPath` (default `~/.config/gh`)
  - `containerGeminiAuthPath` (default `~/.gemini`)
  - `containerCodexAuthPath` (default `~/.codex`)

Repository demo script:
- `.jules-subagents/container/setup.sh` is included as a baseline bootstrap script.
- It installs/updates `npm`, ensures `git` + `gh`, installs `pnpm`, `@google/gemini-cli`, `@openai/codex`, and Playwright Chromium (+ deps when root/apt is available).

## Default Values

Defined in:
- `src/settings-repository.ts` (backend canonical defaults)
- `dashboard/src/lib/settings.ts` (frontend default clone)

## External Settings Hints

`src/external-settings.ts` loads hints from:
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
