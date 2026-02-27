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

### Agent tools
Implemented in:
- `src/mcp/agent-tool-handler.ts`

These cover:
- `sprint_agent`
- `task_agent`

## Registered Tools

Defined in `src/tools.ts`.

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
- Optional `wait: true` delegates to session completion wait flow.

### `sprint_agent` behavior
- Supports `plan`, `status`, `orchestrate`.
- Resolves feature branch from dashboard branch scheme when not explicitly passed.
- Executes atomic loop pipeline and emits markdown protocol instructions.
- `status` is always single-cycle (instant output); wait-loop mode is only used by `orchestrate`.
- In automation modes, action-required Jules tasks can be auto-handled (plan approval, clarification replies, paused-session resume) or explicitly routed as `AGENT` vs `HUMAN` intervention in protocol output.

## Stability Expectations

When modifying tool contracts:
1. Keep argument names backward compatible where possible.
2. Update both backend and dashboard types if shared payloads change.
3. Add or update tests in `src/*.test.ts`.
4. Document changes in `docs/` and `README.md`.

## Runtime Tool Enablement

MCP tool availability is runtime-configurable from dashboard settings (`mcpTools`).

Behavior:
- Disabled tools are omitted from `ListToolsRequestSchema` responses.
- Calls to disabled tools return MCP `MethodNotFound`.
- Toggle state is persisted in settings storage and applied without server restart.
