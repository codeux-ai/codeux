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

1. Validate feature branch exists locally and on origin.
2. Run `sprint_agent(action: "plan")`.
3. Create or verify subtask markdown files.
4. Run `sprint_agent(action: "orchestrate")`.
5. Follow merge and action-required protocol until terminal state.

## Safety Controls

### Emergency stop
If consecutive task creation failures reach threshold:
- New task creation stops.
- Review credentials, source ID, branch state, Jules API availability.
- Re-run after corrective actions.

### Preflight blockers
- Branch preflight blocker means local/remote branch setup is incomplete.
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
- Run `sprint_agent(action: "orchestrate")` again so failed tasks are retried.

## Recovery Techniques

- Temporarily disable selected loop steps for diagnosis.
- Run `status` action to inspect state without creating tasks.
- Use activities APIs to inspect detailed session trace.
- Re-enable steps after diagnosis to restore normal operation.
- On startup, interrupted local CLI sessions (`cli-*` with `RUNNING`) are auto-recovered to `FAILED` so orchestration can safely retry them.

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
