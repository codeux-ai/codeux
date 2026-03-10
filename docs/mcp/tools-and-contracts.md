# MCP Tools and Contracts

This guide defines the MCP tool surface, behavior expectations, and key operational rules.

## Tool Handler Split

### Core tools
Implemented in:
- `src/mcp/core-tool-handler.ts`

These cover:
- Source APIs
- Session APIs
- Activity APIs
- Session wait/polling logic
- listen-mode connection registration and inbox/reply flow
- worker dispatch claim and completion flow

### Agent tools
Implemented in:
- `src/mcp/agent-tool-handler.ts`

These cover:
- `sprint_agent`
- `task_agent`
- `execute_worker_dispatch`
- `cancel_local_dispatch`
- `generate_dashboard_reply`

## Registered Tools

Defined in `src/contracts/mcp-tool-definitions.ts`.

Typed tool argument contracts and registry dispatch are defined in `src/api/mcp/tool-registry.ts`.

### Sources
- `get_source`
- `list_sources`
- `list_all_sources`

### Sessions
- `create_session`
- `get_session`
- `list_sessions`
- `approve_session_plan`
- `send_session_message`
- `wait_for_session_completion`

### Activities
- `get_activity`
- `list_activities`
- `list_all_activities`

### Listen mode
- `start_listen`
- `pull_inbox`
- `post_listen_reply`

### Worker execution
- `pull_task_dispatch`
- `update_task_dispatch`
- `execute_worker_dispatch`
- `cancel_local_dispatch`
- `generate_dashboard_reply`

### Output minimization
- `get_source` returns a compact source summary (`id`, `name`).
- `list_sources` returns compact source summaries (`id`, `name`) with page metadata.
- `list_all_sources` returns compact source summaries (`id`, `name`) with result count.
- `create_session` returns a compact session summary.
- `approve_session_plan` returns a compact action summary.
- `send_session_message` returns a compact action summary.
- `task_agent` (non-`wait` mode) returns a compact session summary.
- `get_session` returns a compact session summary (state, provider, PR links, last activity summary) instead of full raw payload.
- `list_sessions` returns compact session summaries with pagination metadata instead of full raw session objects.
- `wait_for_session_completion` returns the same compact session summary on terminal/action-required exit.
- `get_activity` returns a compact activity summary.
- `list_activities` returns compact activity summaries plus page metadata and kind counts.
- `list_all_activities` returns aggregate metadata plus a small recent-activity preview list, not the full activity objects.

### Agent workflows
- `sprint_agent`
- `task_agent`

## Common Response Shape

Successful responses return:

```json
{
  "content": [
    { "type": "text", "text": "..." }
  ]
}
```

Errors return:

```json
{
  "content": [
    { "type": "text", "text": "Error: ..." }
  ],
  "isError": true
}
```

Unknown tool names raise MCP `MethodNotFound`.

## Important Runtime Behaviors

### Emergency stop for creation failures
- Counter tracked in server state.
- Threshold from `settings.maxFailures` (default 5).
- Blocks new session/task creation when threshold reached.

### Session waiting logic
`wait_for_session_completion` returns when one of these is true:
- `COMPLETED`
- `FAILED`
- Action-required states (`AWAITING_PLAN_APPROVAL`, `AWAITING_USER_FEEDBACK`, `PAUSED`)
- PR output detected in session outputs

### `task_agent` behavior
- Injects `worker.md` into prompt when guide is found.
- Creates session with `AUTO_CREATE_PR`.
- `source_id` is optional; when provider is Jules and `source_id` is omitted, source is auto-resolved from the repo's `remote.origin.url`.
- For Jules sessions, explicit `source_id` values are validated against the repo remote and rejected on mismatch.
- `repo_path` is now optional and overrides `process.cwd()` when the task must run against an explicit project repository.
- Optional `wait: true` delegates to session completion wait flow.

### `sprint_agent` behavior
- Supports `plan`, `status`, `orchestrate`.
- Resolves execution scope from `project_id`, `sprint_id`, `sprint_number`, `repo_path`, and selected dashboard project state.
- Resolves feature branch from sprint DB state or the dashboard branch scheme when not explicitly passed.
- `source_id` is optional for orchestration; Jules source resolution only occurs when a Jules task is actually started.
- Loads tasks from sqlite and starts work through `sprint_runs`, `task_dispatches`, and `task_runs`.
- Acquires a sprint-scoped lease during `orchestrate` so duplicate sprint loops do not run concurrently.
- Markdown is no longer used as orchestration input; it remains import/export only.
- `status` is always single-cycle (instant output); wait-loop mode is only used by `orchestrate`.
- In automation modes, action-required Jules tasks can be auto-handled (plan approval, clarification replies, paused-session resume) or explicitly routed as `AGENT` vs `HUMAN` intervention in protocol output.

### Listen-mode behavior
- `start_listen` registers or refreshes an MCP connection in sqlite and returns pending dashboard messages for the active project.
- `pull_inbox` is the pull-based inbox endpoint for listening MCPs.
- `post_listen_reply` writes a connection reply back into the project conversation thread and marks the handled dashboard message as processed.
- The listen loop is intentionally pull-based because current MCP transport is stdio, not server-push.

### Worker-dispatch behavior
- Worker MCPs register through `start_listen` with `role = worker`.
- `pull_task_dispatch` claims the next queued `mcp_worker` dispatch for one of the worker's active projects.
- Claiming a dispatch acquires a DB-backed lease on that dispatch and returns the full task payload plus project/sprint branch context.
- `execute_worker_dispatch` starts the claimed dispatch on a headless worker-host Sprint OS server using the existing provider execution path.
- `generate_dashboard_reply` generates a reply-only markdown response for a dashboard inbox message using a local CLI-capable provider and the project repo context.
- `update_task_dispatch` is used for heartbeats and terminal worker outcomes (`RUNNING`, `COMPLETED`, `FAILED`, `BLOCKED`).
- `update_task_dispatch` now returns both the persisted dispatch state and an optional `controlAction`.
- When the dashboard cancels a running worker dispatch, the next worker heartbeat receives `controlAction = "cancel"` while the dispatch remains `cancel_requested`.
- `cancel_local_dispatch` is the worker-host side stop hook for active local execution and Jules soft-stop requests.
- Workers are expected to stop promptly and send a terminal `update_task_dispatch` result to close the dispatch cleanly.
- Worker execution writes back into the same `task_dispatches`, `task_runs`, and `task_run_events` records used by the rest of Sprint OS.
- The external `sprint-os-worker` client also polls `pull_inbox` and posts generated replies with `post_listen_reply`, so chat and dispatch execution now share the same worker connection identity.

## Stability Expectations

When modifying tool contracts:
1. Keep argument names backward compatible where possible.
2. Update both backend and dashboard types if shared payloads change.
3. Add or update tests in `tests/backend/**/*.test.ts` or `tests/dashboard/**/*.test.ts`.
4. Document changes in `docs/` and `README.md`.

## Jules API Client Typing Boundary

`src/integrations/jules-api-client.ts` is the typed transport boundary for Jules REST calls.

Current expectations:
- Request/response interfaces are explicit for all list and session APIs (for example `JulesListSourcesRequest`, `JulesListSessionsResponse`, `JulesCreateSessionRequest`).
- Pagination inputs remain MCP-friendly (`page_size`, `page_token`) and are translated to Jules REST query keys (`pageSize`, `pageToken`) inside the client.
- Session route normalization is centralized so all session-aware methods consistently accept either `123` or `sessions/123`.
- Client-level behavior is covered by `tests/backend/services/jules-api-client.test.ts` (query mapping, pagination, session normalization, API key handling).

## Runtime Tool Enablement

MCP tool availability is runtime-configurable from dashboard settings (`mcpTools`).

Behavior:
- Disabled tools are omitted from `ListToolsRequestSchema` responses.
- Calls to disabled tools return MCP `MethodNotFound`.
- Toggle state is persisted in settings storage and applied without server restart.

## Runtime Role Gating

Sprint OS now also filters tools by runtime role before applying dashboard toggles.

Current roles:

- `project_manager`
- `worker_host`

Behavior:

- normal Sprint OS server processes expose the project-manager/listener tool surface
- headless worker-host processes expose only the worker-loop tool surface they actually need
- worker-only tools such as `execute_worker_dispatch`, `cancel_local_dispatch`, `generate_dashboard_reply`, `pull_task_dispatch`, and `update_task_dispatch` are no longer visible on normal human-driven MCP connections

This keeps Gemini CLI and other regular MCP clients compatible without cluttering them with worker-local controls.
