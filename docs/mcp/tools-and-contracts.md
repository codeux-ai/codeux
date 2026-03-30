# MCP Tools and Contracts

This guide defines the MCP tool surface, behavior expectations, and key operational rules.

## Tool Handler Split

### Core tools
Implemented in:
- `src/mcp/core-tool-handler.ts`

These cover:
- `get_session`
- listen-mode connection registration and inbox/reply flow
- worker dispatch claim and completion flow

### Agent tools
Implemented in:
- `src/mcp/agent-tool-handler.ts`

These cover:
- `execute_worker_dispatch`
- `cancel_local_dispatch`
- `generate_dashboard_reply`

## Registered Tools

Defined in `src/contracts/mcp-tool-definitions.ts`.

Typed tool argument contracts and registry dispatch are defined in `src/api/mcp/tool-registry.ts`.

- `get_session`
### Listen mode
- `listen`
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
- `get_session` returns a compact session summary (state, provider, PR links, last activity summary) instead of full raw payload.

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

### Listen-mode behavior
- `listen` is now the primary listening contract for both normal stdio MCP clients and workers.
- `listen` registers or refreshes the connection, then blocks until one actionable event is available or timeout expires.
- `listen` returns exactly one event at a time: a dashboard message, a worker dispatch, or a timeout result with explicit "call listen again" continuation guidance.
- `listen` now returns compact event payloads instead of full connection/message records:
  - dashboard messages: `id`, `threadId`, `projectId`, `bodyMarkdown`, optional `metadata`
  - task dispatches: full dispatch claim payload
  - timeout: continuation only
- The default `listen` timeout is derived from dashboard settings `sprintLoopSteps.watchLoopOutputIntervalSeconds` and currently defaults to `300`.
- The default internal idle polling cadence inside one blocking `listen` call is now `3000ms`, which reduces idle listener churn without changing the external MCP loop contract.
- Connection heartbeat writes are throttled while listeners stay idle, so a healthy long-poll listener no longer rewrites connection state every second.
- Workers may set `include_task_dispatch = true` so the same blocking listener call can also claim and return the next queued worker dispatch.
- `listen` is exposed on both the normal stdio `project_manager` runtime and the remote Streamable HTTP `worker_gateway` runtime.
- `start_listen` registers or refreshes an MCP connection in sqlite and returns pending dashboard messages for the active project.
- `pull_inbox` is the pull-based inbox endpoint for listening MCPs.
- `post_listen_reply` writes a connection reply back into the project conversation thread and marks the handled dashboard message as processed.
- `post_listen_reply` now returns only `threadId` and `deliveryStatus`, because the caller already knows the reply body and thread context it just submitted.
- `start_listen` and `pull_inbox` now remain as low-level compatibility primitives and should not be the first-choice listener workflow for normal human-driven MCP clients.
- New dashboard threads should remain unassigned by default until explicitly targeted or claimed by a real listener.

### Worker-dispatch behavior
- Worker MCPs register through `listen` or `start_listen` with `role = worker`.
- `pull_task_dispatch` claims the next queued `mcp_worker` dispatch for one of the worker's active projects.
- Claiming a dispatch acquires a DB-backed lease on that dispatch and returns the full task payload plus project/sprint branch context.
- `execute_worker_dispatch` starts the claimed dispatch on a headless worker-host Sprint OS server using the existing provider execution path.
- `generate_dashboard_reply` generates a reply-only markdown response for a dashboard inbox message using the editable `Worker` agent plus the project repo context.
- `generate_dashboard_reply` also accepts `mode = compact_thread`, which treats the supplied markdown as a prepared compaction prompt and records the run as a `chat_compaction` invocation.
- `post_listen_reply` accepts optional `metadata`, which Sprint OS uses for hidden control-plane replies such as connected-worker thread compaction.
- `update_task_dispatch` is used for heartbeats and terminal worker outcomes (`RUNNING`, `COMPLETED`, `FAILED`, `BLOCKED`).
- `update_task_dispatch` now returns both the persisted dispatch state and an optional `controlAction`.
- When the dashboard cancels a running worker dispatch, the next worker heartbeat receives `controlAction = "cancel"` while the dispatch remains `cancel_requested`.
- `cancel_local_dispatch` is the worker-host side stop hook for active local execution.
- Workers are expected to stop promptly and send a terminal `update_task_dispatch` result to close the dispatch cleanly.
- Worker execution writes back into the same `task_dispatches`, `task_runs`, and `task_run_events` records used by the rest of Sprint OS.
- The external `sprint-os-worker` client now uses the same blocking `listen` contract for both inbox and dispatch work.
- In remote mode, the worker uses Streamable HTTP for the control plane and a local stdio `worker_host` runtime for execution hooks.

## Removed Legacy Surface

These legacy MCP tools are no longer registered:

- `get_source`
- `list_sources`
- `list_all_sources`
- `create_session`
- `list_sessions`
- `approve_session_plan`
- `send_session_message`
- `wait_for_session_completion`
- `get_activity`
- `list_activities`
- `list_all_activities`
- `task_agent`

Sprint OS now keeps orchestration inside its own DB-backed dispatch layer. External MCP clients interact through listener, inbox, dispatch, and control-plane tools instead of direct Jules session management.

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
- `worker_gateway`

Behavior:

- normal Sprint OS server processes expose the project-manager/listener tool surface
- headless worker-host processes expose only the worker-local execution tool surface they actually need
- the Streamable HTTP worker gateway exposes the remote worker control-plane tool surface
- worker-only tools such as `execute_worker_dispatch`, `cancel_local_dispatch`, and `generate_dashboard_reply` are no longer visible on normal human-driven MCP connections
- dashboard-only orchestration stays outside the worker gateway; the worker gateway exposes only the listener and worker-control-plane tools it actually needs

This keeps Gemini CLI and other regular MCP clients compatible without cluttering them with worker-local controls.
