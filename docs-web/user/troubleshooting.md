# Troubleshooting

Solutions to the most common issues. If your problem is not covered here, see the [Operations runbook](../architecture/system-overview.md) or open an issue.

## Code UX won't start

### `JULES_API_KEY is required` (or similar)

You launched without a Jules key and without enabling a virtual worker provider.

**Fix:** set `JULES_API_KEY` in `.env`, pass `--api-key`, or add it to `~/.code-ux/settings.json`. Alternatively, set `workers.virtualWorkerProvider` in settings to a configured CLI provider — Code UX can run entirely on virtual workers.

### Port 4444 already in use

Another process holds the dashboard port.

**Fix:** set `DASHBOARD_PORT` to a free port, or kill the offender. On Linux: `lsof -i :4444`.

### Permission denied on Git operations

The user running Code UX cannot write to the repo.

**Fix:** Ensure the process has write permissions to the project's `repository path` and to the `.code-ux/` directory therein.

## Dashboard issues

### Dashboard loads but data is empty

You haven't created a project yet, **or** the active project pointer is stale.

**Fix:** open **Projects** page, create or select a project. Refresh.

### Real-time updates stopped

The WebSocket disconnected and reconnection failed.

**Fix:** refresh the page. If it persists, check browser console for `WebSocket` errors; verify the dashboard process is alive and the port is reachable.

### "Failed to fetch" on every API call

The dashboard process died or the browser is on a different host than the server (e.g. `0.0.0.0` binding but firewall blocks the inbound).

**Fix:** verify the server is running; if accessing remotely, ensure your firewall allows the port and you are using the correct hostname.

## MCP integration

### Client never sees `code-ux` tools

The MCP server failed to start. Common causes:

- The `command` in client config is wrong (typo in `npx jules-subagents`).
- The `JULES_API_KEY` is missing in the client-supplied env block, and the server exited.
- The npx command needed network access at first launch and the network was unavailable.

**Fix:** run the same command manually in a terminal — `npx -y jules-subagents --help` — and observe the output. Then check your MCP client's error log.

### `listen` returns no message and the call hangs

This is normal. `listen` is a long-poll: it blocks until a message is available or `timeout_seconds` elapses (default = `watchLoopOutputIntervalSeconds`, i.e. ~5 minutes).

**Fix:** call `listen` in a loop. The call returns immediately when a dashboard user posts to the connection.

### HTTP gateway returns 401

You enabled `--mcp-http-auth-token` but the client did not send `Authorization: Bearer <token>`, or the token mismatches.

**Fix:** include the header. Tokens are case-sensitive.

### HTTP gateway returns 400 "must be initialize"

You called the endpoint without an `mcp-session-id` header, but with a non-`initialize` JSON-RPC method.

**Fix:** the *first* call on a new session must be `{"method": "initialize"}`. The response carries the session ID via `mcp-session-id` header — include it on subsequent calls.

## Sprint orchestration

### `CRITICAL: Emergency stop active`

The orchestrator hit `maxFailures` consecutive task-start failures.

**Fix:** read the latest few cycle logs. Common causes:

- `JULES_API_KEY` invalid or expired.
- A virtual worker CLI not installed / not authenticated.
- The repo has uncommitted state preventing branch creation.

Re-run the sprint after fixing — the counter resets on each run.

### Tasks stay BLOCKED forever

A dependency is `COMPLETED` but `is_merged: false`. Code UX gates on merge, not just completion.

**Fix:** open the dependency's PR; merge it. Then set `merged: true` in the subtask file (or use auto-merge so this is automated).

### CI autofix loops

A `ci_fix` worker keeps trying and failing.

**Fix:** the underlying CI failure is structural. Check the PR's CI log, fix manually, push, mark the attention item resolved. Optionally lower `julesCiAutofixMaxRetries` to fail faster next time.

### Sprint paused at finalisation

`mainBranchAutoMergeMode` is `OFF`, so the engine is waiting for you to merge the feature branch into `main` manually.

**Fix:** run the printed `gh pr merge` command. Code UX detects the merge on the next cycle and transitions the sprint to `completed`.

## Provider errors

### "Provider quota exceeded" / `QUOTA` status

Your API key hit a rate or token quota.

**Fix:** wait, raise the quota, or route the affected invocation to a different provider via Settings → Routing. Tasks in `QUOTA` are retried automatically each cycle.

### "Provider auth not detected" badge in settings

The CLI is installed but not logged in.

**Fix:** run the CLI's auth command directly (e.g. `gemini auth login`, `codex login`, `claude login`). Refresh Settings.

### Docker mode fails to start a container

The Docker daemon is unreachable, or the worker image cannot be pulled.

**Fix:** verify `docker ps` works. Pre-pull the image: `docker pull node:24-bookworm`.

## Memory & embeddings

### Search returns no results

The active embedding model has no memories embedded with it (you switched models without re-embedding).

**Fix:** open **Memory → Embedding models** and click **Re-embed all**.

### Embedding model download stuck

The download failed mid-stream.

**Fix:** click **Cancel download**, then **Download** again. Check disk space.

## Where to find logs

- **Dashboard process stdout/stderr** — the terminal you launched `jules-subagents` from. Logs are JSON-structured.
- **MCP client logs** — depends on client. Gemini CLI: `~/.gemini/logs/`. Claude Desktop: app log directory per OS.
- **Per-task activity** — visible in the dashboard task detail panel; also at `/api/live-activities` and `/api/execution/invocations/:id/messages`.
- **Cycle telemetry** — `/api/projects/:projectId/execution/invocations` (typed by `type`).

## Recovery & reset

If state is corrupted or unrecoverable:

- **Soft reset (one project)** — Delete the project; re-create.
- **Hard reset (all data)** — Settings → System → **Reset database**. *Irreversible.*
- **Manual** — Stop Code UX. Delete `~/.code-ux/` and the project's `<repo>/.code-ux/`. Restart.

## Filing an issue

Include:

- Code UX version (`jules-subagents --help` shows the version banner).
- Node version (`node --version`).
- OS / shell.
- The exact MCP client and version.
- Relevant logs (last ~50 lines from the failing cycle, redacted of secrets).
- Steps to reproduce.

Issue tracker: https://github.com/numnx/jules-subagents-mcp/issues
