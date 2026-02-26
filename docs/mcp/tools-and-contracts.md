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
