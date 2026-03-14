# Operations Runbook

This runbook covers day-to-day operation and incident handling for the MCP server and dashboard.

## Normal Startup Procedure

1. Confirm API key source is available (recommended, but startup is allowed without key).
2. Start server (`npm run dev` or `npm start`).
3. Open dashboard and verify settings.
4. Confirm `/api/status` and `/api/git-status` are responding.

If started without key:
- Configure `JULES_API_KEY` in `.env`, or `julesApiKey` in `.jules-subagents/settings.json`, or set it in dashboard settings.
- Retry API-backed commands after configuration.
- Dashboard key fields can stay empty when system-wide environment keys are already present.

## Sprint Execution Procedure

1. Verify the repo is a healthy git checkout. Sprint OS now prepares the local feature branch automatically on orchestration start and will try to push it to `origin` when that remote exists.
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
- Branch preflight blocker means Sprint OS could not prepare the local feature branch, or it could not push the branch to `origin` on a repo that expects a remote feature branch.
- Planning preflight blocker means subtask files are missing.

## Common Incidents

### 1. Dashboard unavailable
Checks:
- Is server process running?
- Is configured dashboard port free?
- Any startup warning for `EADDRINUSE`?

### 2. No PR/CI data in remote mode
Checks:
- `gh --version`
- `gh auth status`
- Token availability in settings/env

### 3. API-backed tools return key setup instructions
Checks:
- Is Jules API key configured in dashboard settings?
- Is `.env` loaded with `JULES_API_KEY`?
- Is `.jules-subagents/settings.json` containing `julesApiKey`?
- Was settings save applied after editing dashboard value?

### 4. Gemini/Codex task sessions fail immediately
Checks:
- Is the CLI installed and executable (`gemini`, `codex`)?
- Is auth available system-wide or via provider API key settings?
- Did child task branch creation succeed from feature branch?
- Are `git` and `gh` available in PATH for commit/push/PR steps?
- If `Settings -> CLI Workflow -> Execution Mode` is `Docker`:
  - Is Docker daemon available (`docker ps`)?
  - Is the configured image pullable/runnable?
  - If provider tools are not in the image, is a setup script configured (or present at `.jules-subagents/container/setup.sh`)?
  - Check session activity for setup resolution details:
    - `Configured container setup script not found: ...`
    - `No container setup script found. Checked: ...`
  - Provider runner now falls back to installing missing provider CLI in-container before failing:
    - `gemini`: `npm install -g @google/gemini-cli`
    - `codex`: `npm install -g @openai/codex`
    - `claude`: `curl -fsSL https://claude.ai/install.sh | bash`
  - Claude runner executes headless using `claude -p "<prompt>" --dangerously-skip-permissions`.
  - For Claude auth mounts, ensure host has `~/.claude/.credentials.json`; if auth still stalls, also verify `~/.claude.json` exists (runtime mounts it automatically when present).
  - Runtime now syncs only those Claude auth files before launch, avoiding recursive copy of all `.claude` state.
  - If auth is expected from host login state, is the relevant Docker auth mount enabled and is its mount path valid?
  - Docker mode requires daemon-visible workspace paths. Runtime now prefers repo-scoped worktree paths for Docker sessions.
  - Docker runtime state is stored under `~/.jules-subagents/runtime/docker/<repo-hash>/` by default (override with `JULES_DOCKER_RUNTIME_ROOT`).
  - Codex uses per-session container home directories under that runtime root to prevent stale state from previous Codex runs.
  - GitHub/Gemini credential sync copies mount contents into fixed dirs (`~/.config/gh`, `~/.gemini`) to avoid nested auth directories across repeated runs.
  - If provider output says "No file changes produced", runtime now still checks for unpushed worker-branch commits and will push/create (or reuse) the feature PR when commits exist.
  - For Docker-in-Docker or remote daemon path mismatches, configure:
    - `JULES_DOCKER_HOST_WORKSPACE_ROOT=<host-visible-repo-root>`
    - `JULES_DOCKER_HOST_HOME_ROOT=<host-visible-home-root>` (optional, for auth mounts)
- If logs show `Error executing tool read_file: File not found`, verify the retry setting:
  - `Settings -> CLI Workflow -> Retry once on read_file not found`
- If you need post-failure recovery work, keep failed worktrees:
  - `Settings -> CLI Workflow -> Cleanup worktree on failure` should remain disabled (recommended default).
- To continue retries in the same failed workspace:
  - `Settings -> CLI Workflow -> Resume failed task in same workspace` should remain enabled (default).

### 5. Orchestration stuck with blocked tasks
Checks:
- Dependencies completed and merged?
- Any action-required session states (`AWAITING_*`, `PAUSED`)?
- Is merge protocol disabled in step toggles?

### 6. Tasks completed but pipeline not progressing
Checks:
- `merged: true` updated in subtask markdown files?
- Merge actually integrated into feature branch?
- CI policy gates reflected in protocol text?

### 7. Tasks show RUNNING after MCP was interrupted
Symptoms:
- Old activity logs keep appearing.
- New orchestration cycles do not start fresh background CLI runs.

Checks:
- Restart MCP once to trigger startup recovery.
- Verify startup logs for a recovery line:
  - `[Recovery] Marked <N> interrupted CLI session(s) as FAILED ...`
- Restart the sprint from the dashboard so failed tasks are retried on a fresh orchestration attempt.

## Recovery Techniques

- Temporarily disable selected loop steps for diagnosis.
- Use the dashboard live view to inspect state without starting new work.
- Use activities APIs to inspect detailed session trace.
- Re-enable steps after diagnosis to restore normal operation.
- On startup, interrupted local CLI sessions (`cli-*` with `RUNNING`) are auto-recovered to `FAILED` so orchestration can safely retry them.
- Failed CLI sessions can preserve their worktree for manual follow-up or assisted retry, based on CLI Workflow settings.

## Useful Commands

```bash
npm test
npm run build
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
