# MCP Tools and Contracts

This guide defines the MCP tool surface, behavior expectations, and key operational rules.

## Tool Handler Split

### Management tools
Implemented in:
- `src/mcp/management-tool-handler.ts`

These cover:
- `manage_code_ux`
- `manage_projects`
- `manage_sprints`
- `manage_tasks`
- `manage_quicksprints`
- `manage_scheduler`
- `manage_agents`
- `manage_memory`
- `search_knowledge`
- `manage_settings`
- `manage_preview`
- `manage_telemetry`

### Core tools
Implemented in:
- `src/mcp/core-tool-handler.ts`

These cover:
- `get_session`
- listen-mode connection registration and inbox/reply flow

### Agent tools
Implemented in:
- `src/mcp/agent-tool-handler.ts`

These cover:
- `generate_dashboard_reply`

### Management
- `manage_code_ux`
- `manage_projects`
- `manage_sprints`
- `manage_tasks`
- `manage_quicksprints`
- `manage_scheduler`
- `manage_agents`
- `manage_memory`
- `search_knowledge`
- `manage_settings`
- `manage_preview`
- `manage_telemetry`

## Registered Tools

Defined in `src/contracts/mcp-tool-definitions.ts`.

Typed tool argument contracts and registry dispatch are defined in `src/api/mcp/tool-registry.ts`.

- `get_session`
### Listen mode
- `listen`
- `start_listen`
- `pull_inbox`
- `post_listen_reply`

### Agent execution
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

### Destructive Action Approvals

Destructive actions (e.g., actions starting with `delete_`, `reset_`, `replace_`) executed via the `manage_code_ux` tool follow an explicit approval flow to prevent accidental data loss:
1. The initial call is sent without an `approval` block, or with `approval.confirmed: false`.
2. The server short-circuits the action, returning an early envelope with `approvalRequired: true` and an explanatory `approvalMessage`.
3. The agent reviews the message and issues the exact same call again, but with `approval.confirmed: true` added to the payload.
4. The server executes the operation and returns the `result` block.

### Settings Human Confirmation Gate

All mutating settings actions require a stateful human-confirmation step. This includes:
- `replace_system_settings`
- `patch_system_setting`
- `replace_project_settings`
- `patch_project_setting`
- `reset_project_settings`
- `replace_sprint_settings`
- `patch_sprint_setting`
- `reset_sprint_settings`

Runtime behavior:
1. The first mutating settings call never changes settings, even if it includes `approval.confirmed: true`.
2. The server records a pending approval for the exact settings action and normalized payload for 15 minutes.
3. The response returns `approvalRequired: true` with instructions to ask the user for confirmation.
4. The client must not call the same endpoint again with `approval.confirmed: true` unless the user explicitly confirms the exact change.
5. After user confirmation, the same action and same payload can be called once with `approval.confirmed: true`; the pending approval is consumed and cannot be reused.
6. A different settings payload, even for the same setting path, creates a separate pending approval and does not execute.

### Project Setup Action

`manage_projects` and `manage_code_ux` support project setup:

```json
{
  "action": "setup",
  "projectId": "project-id",
  "setup": {
    "enabled": true,
    "options": {
      "agents": true,
      "quicksprints": true,
      "previewScript": true,
      "ci": true
    }
  }
}
```

The action runs the Project Setup Agent and returns the applied artifact summary, including created agent IDs, created quicksprint template IDs, and written project-relative files.

Dashboard calls can add `background: true` to the HTTP setup request. In that mode Code UX returns the created `invocationId` immediately and the invocation rail becomes the live tracking surface while setup continues.

### Sprint, Task, and Settings Payload Normalization

For payload normalization in management tools, Code UX centralizes parsing behavior:
- **Required Strings**: Extracted via `parseRequiredString`. Must be present and non-blank (e.g. `"  "` is rejected). Returns trimmed string.
- **Optional Strings**: Extracted via `parseOptionalString`. Returns trimmed string, or `undefined` if blank.
- **Optional String Arrays**: Extracted via `parseOptionalStringArray`. Filters out non-string items and trims, returning `undefined` if the resulting array is empty.
- **Optional Numbers**: Extracted via `parseOptionalNumber`. Validates finiteness and optional min/max constraints.
- **Optional Enums**: Extracted via `parseOptionalEnum`. Normalizes case and whitespace to match allowed literal types.


The dedicated management tools (`manage_sprints`, `manage_tasks`, `manage_quicksprints`, `manage_scheduler`, `manage_settings`) and the legacy `manage_code_ux` dispatcher share the same action handlers.

For sprint create/update calls:
- `name` is the canonical repository field.
- `title` is accepted as a public MCP alias for `name`.
- `goal` is the canonical repository field.
- `goalMarkdown` is accepted as a public MCP alias for `goal`.
- Missing or blank `projectId`, `sprintId`, `sprintRunId`, `name`, and `title` values are rejected before repository calls so MCP clients receive a validation error instead of a low-level `.trim()` failure.

For task create/update calls:
- `title` is canonical; `name` is accepted as an alias.
- `projectId` is required for list/create, and `sprintId` is required for create. List can omit `sprintId` to return all project tasks.
- Supported edit fields include `promptMarkdown`, `description`, `status`, `priority`, `executorType`, `agentPresetId`, `model`, `sortOrder`, `dependsOnTaskIds`, `isIndependent`, and `isMerged`.

For quicksprint calls:
- `manage_quicksprints` supports `list_templates`, `get_template`, `create_template`, `update_template`, `delete_template`, `execute`, and `start`.
- `start` is an MCP-friendly alias for execution with `submitMode: "plan_and_start"`.
- `execute` defaults to `submitMode: "plan_only"` when no submit mode is supplied.
- `taskCount` is the canonical task-number field for execution. MCP accepts it as a number or numeric string.
- `delete_template` requires approval confirmation and only applies to custom templates; built-in templates remain protected by the quicksprint service.

For scheduler calls:
- `manage_scheduler` supports `list`, `create`, `schedule_sprint`, `schedule_quicksprint`, `schedule_chat`, `update`, `delete`, and `run_due`.
- Generic `create` requires `targetType: "sprint" | "quicksprint" | "chat"`.
- The `schedule_*` aliases infer the target type and accept flattened target fields.
- Scheduled quicksprints use the same `taskCount` number or numeric-string normalization as direct quicksprints.
- Scheduled chat messages use `bodyMarkdown`, optional `threadId`, optional `connectionId`, and optional `title`. When due, the scheduler posts through the same chat runtime used by dashboard conversations.
- `update` supports pausing and resuming entries via the `status` field. Resuming a `paused` entry to `scheduled` recomputes the next run time to the next future occurrence, preventing immediate execution of missed runs. Pause/resume acts as automation gating and does not manually trigger the target.
- `delete` requires approval confirmation.

For settings patch calls, `value` may be any JSON value, including strings, booleans, numbers, `null`, arrays, or objects.
Settings patch and replacement calls still require the stateful human-confirmation gate described above.

## Important Runtime Behaviors

### Listen-mode behavior
- `listen` is now the primary listening contract for both normal stdio MCP clients and workers.
- `listen` registers or refreshes the connection, then blocks until one actionable event is available or timeout expires.
- `listen` returns exactly one event at a time: a dashboard message or a timeout result with explicit "call listen again" continuation guidance.
- `listen` now returns compact event payloads instead of full connection/message records:
  - dashboard messages: `id`, `threadId`, `projectId`, `bodyMarkdown`, optional `metadata`
  - timeout: continuation only
- The default `listen` timeout is derived from dashboard settings `sprintLoopSteps.watchLoopOutputIntervalSeconds` and currently defaults to `300`.
- The default internal idle polling cadence inside one blocking `listen` call is now `3000ms`, which reduces idle listener churn without changing the external MCP loop contract.
- Connection heartbeat writes are throttled while listeners stay idle, so a healthy long-poll listener no longer rewrites connection state every second.
- `listen` is exposed on the project-manager runtime over both stdio and HTTP.
- `start_listen` registers or refreshes an MCP connection in sqlite and returns pending dashboard messages for the active project.
- `pull_inbox` is the pull-based inbox endpoint for listening MCPs.
- `post_listen_reply` writes a connection reply back into the project conversation thread and marks the handled dashboard message as processed.
- `post_listen_reply` now returns only `threadId` and `deliveryStatus`, because the caller already knows the reply body and thread context it just submitted.
- `start_listen` and `pull_inbox` now remain as low-level compatibility primitives and should not be the first-choice listener workflow for normal human-driven MCP clients.
- New dashboard threads should remain unassigned by default until explicitly targeted or claimed by a real listener.

### Agent reply behavior
- `generate_dashboard_reply` generates a reply-only markdown response for a dashboard inbox message using the editable `Worker` agent plus the project repo context.
- `generate_dashboard_reply` also accepts `mode = compact_thread`, which treats the supplied markdown as a prepared compaction prompt and records the run as a `chat_compaction` invocation.
- `post_listen_reply` accepts optional `metadata`, which Code UX uses for hidden control-plane replies such as connected-worker thread compaction.

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

Code UX now keeps orchestration inside its own DB-backed dispatch layer. External MCP clients interact through listener, inbox, dispatch, and control-plane tools instead of direct Jules session management.

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

Code UX now also filters tools by runtime role before applying dashboard toggles.

Current roles:

- `project_manager`

Behavior:

- Code UX now exposes only the project-manager tool surface
- the same tool list is used for stdio and HTTP transports

This keeps Gemini CLI and other regular MCP clients compatible without cluttering them with worker-local controls.
