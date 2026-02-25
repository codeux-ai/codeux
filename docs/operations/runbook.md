# Operations Runbook

This runbook covers day-to-day operation and incident handling for the MCP server and dashboard.

## Normal Startup Procedure

1. Confirm API key source is available.
2. Start server (`npm run dev` or `npm start`).
3. Open dashboard and verify settings.
4. Confirm `/api/status` and `/api/git-status` are responding.

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

### 3. Orchestration stuck with blocked tasks
Checks:
- Dependencies completed and merged?
- Any action-required session states (`AWAITING_*`, `PAUSED`)?
- Is merge protocol disabled in step toggles?

### 4. Tasks completed but pipeline not progressing
Checks:
- `merged: true` updated in subtask markdown files?
- Merge actually integrated into feature branch?
- CI policy gates reflected in protocol text?

## Recovery Techniques

- Temporarily disable selected loop steps for diagnosis.
- Run `status` action to inspect state without creating tasks.
- Use activities APIs to inspect detailed session trace.
- Re-enable steps after diagnosis to restore normal operation.

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
