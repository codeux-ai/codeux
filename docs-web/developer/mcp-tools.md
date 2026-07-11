# MCP tools

Code UX is also an MCP server. When connected, it advertises a set of **management tools** that an
MCP client (or another agent) can call to drive projects, sprints, tasks, agents, memory, persistent
skills, node flows, settings, previews, custom dashboards, chat connectors, and telemetry. This page is the exact contract: the tool list, each
tool's `action` enum, input shape, approval rules, and the error model.

> **Server identity:** the server identifies as `code-ux`, with the version matching the installed
> package. The package on npm is `@codeuxai/codeux`. Capabilities advertised at
> `initialize`: `tools`, `resources`, `prompts`.

## Tool availability

Tools are filtered before being advertised on `ListTools`:

1. **Runtime role** — every tool declares `runtimeRoles`. The server role is set with `--runtime-role`
   (default and only functional role: `project_manager`).
2. **Toggle** — each tool has an entry under `settings.mcpTools`. Disabled tools are not advertised
   and return `MethodNotFound` if called.
3. **Per-agent Code UX policy** — HTTP worker clients can advertise an agent preset. Unknown,
   malformed, or unconfigured agent identities fail closed and receive no built-in Code UX tools.
   Known agents can receive tool-specific overrides; for example, `search_skills` can stay enabled
   while `manage_skills` is disabled.
4. **Agent audience** — clarification tools have an additional fail-closed audience grant. Coding-task
   agents can request clarification only for their eligible project/task scope; project-manager reply
   agents can answer. The same check runs for listing and calls.

Agent-scoped provider runs are also default-deny for built-in Code UX tools. Newly synced Worker,
Project manager, and generated coding agents may link the default `playwright` custom MCP server,
but that custom-server link does not imply `code_ux` access. The dashboard chat reply route defaults
to the Project manager and is the only default exception: when the reply agent has no explicit MCP
access, Code UX enables the full built-in management surface, the restricted `scheduler_code_ux`
self-wakeup tool, the dedicated `add_long_term_memory` lane, and the default Playwright MCP server
for that dashboard chat turn. Explicitly narrowed dashboard reply policies still have both dedicated
lanes forced on.

All inputs are validated against their declared JSON Schema (AJV) before dispatch; validation
failures return `InvalidParams` with the failing JSON path.

## The tools

Code UX exposes **one tool per management domain**, plus retrieval tools such as `search_knowledge`
and `search_skills`. Each `manage_*` tool takes an `action` (from a fixed enum) plus
action-specific fields, and an optional `approval` object for destructive actions.

| Tool | Category | Purpose |
| --- | --- | --- |
| `request_clarification` | orchestration | Raise an idempotent, project-owned Markdown question from an eligible coding agent. |
| `reply_to_clarification` | orchestration | Answer a pending clarification as the eligible project-manager agent or an unscoped project-manager client. |
| `manage_projects` | orchestration | List, get, create, update, select, set up, and delete projects. |
| `manage_sprints` | orchestration | Plan, start, pause, cancel, inspect, import issues into, and edit sprints. |
| `manage_tasks` | orchestration | Create, edit, start, stop, pause, and inspect tasks. |
| `manage_quicksprints` | orchestration | Manage quicksprint templates and execute them. |
| `manage_scheduler` | orchestration | Create and run scheduled sprints, quicksprints, messages, and node flows. |
| `scheduler_code_ux` | orchestration | Agent-owned wakeups with restricted list/schedule/cancel actions. |
| `manage_agents` | agents & memory | Manage agent presets and sync them to project markdown. |
| `manage_node_flows` | agents & memory | Manage reusable node workflows, run them, and attach them as agent skills. |
| `manage_memory` | agents & memory | Inspect, search, promote, and re-embed short/long-term memory. |
| `add_long_term_memory` | agents & memory | Store one canonical durable project memory and return rich confirmation-widget data. |
| `manage_skills` | agents & memory | Manage persistent skill storages, skill markdown, and agent storage attachments. |
| `search_knowledge` | agents & memory | Semantic search over the knowledge base subscribed to the caller. |
| `search_skills` | agents & memory | Semantic retrieval over persistent project skills, optionally scoped to an agent or storage. |
| `manage_settings` | platform | Get/resolve/patch/replace/reset system, project, and sprint settings. |
| `manage_preview` | platform | Manage sprint preview containers (start/stop/rebuild, logs, scripts). |
| `manage_custom_dashboards` | platform | Manage project custom dashboard drafts, revisions, detached validation sessions, publication, archiving, and data catalog lookup. |
| `manage_chat_providers` | platform | Manage external chat provider setup definitions, connections, bindings, and outbound delivery state. |
| `manage_telemetry` | platform | Read execution snapshots, invocations, sprint runs, and dispatches. |

Every tool uses the existing `project_manager` gateway runtime role and is enabled by default. Clarification tools additionally require their worker or project-manager audience grant; unknown, cross-project, and unauthorized agent calls return `MethodNotFound`.

### Action enums

| Tool | `action` values |
| --- | --- |
| `manage_projects` | `list`, `get`, `create`, `update`, `select`, `setup`, `delete` |
| `manage_sprints` | `list`, `get`, `create`, `update`, `delete`, `start`, `pause`, `cancel`, `force_cancel`, `inspect_run`, `import_issues`, `plan` |
| `manage_tasks` | `list`, `get`, `create`, `update`, `delete`, `start`, `stop`, `force_stop`, `pause`, `inspect_run` |
| `manage_quicksprints` | `list_templates`, `get_template`, `create_template`, `update_template`, `delete_template`, `execute`, `start` |
| `manage_scheduler` | `list`, `create`, `update`, `delete`, `run_due`, `schedule_sprint`, `schedule_quicksprint`, `schedule_chat`, `schedule_node_flow` |
| `scheduler_code_ux` | `list`, `schedule_wakeup`, `cancel` |
| `manage_agents` | `list`, `get`, `create`, `update`, `delete`, `sync` |
| `manage_node_flows` | `list`, `get`, `create`, `update`, `delete`, `validate`, `run`, `list_runs`, `get_run`, `attach_to_agent`, `detach_from_agent` |
| `manage_memory` | `list`, `get`, `count`, `create`, `update`, `delete`, `search`, `promote`, `get_map`, `model_status`, `start_reembed` |
| `manage_skills` | `authoring_prompt`, `list_storages`, `get_storage`, `create_storage`, `update_storage`, `delete_storage`, `reset_storage`, `list_agent_storages`, `attach_storage`, `detach_storage`, `list_skills`, `get_skill`, `create_skill`, `update_skill`, `delete_skill`, `import_markdown`, `export_markdown` |
| `manage_settings` | `get_system`, `get_project_override`, `resolve_project_effective`, `get_sprint_override`, `resolve_sprint_effective`, `replace_system_settings`, `patch_system_setting`, `replace_project_settings`, `patch_project_setting`, `reset_project_settings`, `replace_sprint_settings`, `patch_sprint_setting`, `reset_sprint_settings`, `export_settings_bundle`, `apply_settings_bundle` |
| `manage_preview` | `list_sessions`, `start_session`, `stop_session`, `rebuild_session`, `remove_session`, `get_logs`, `get_url`, `get_script`, `update_script` |
| `manage_custom_dashboards` | `list`, `get`, `create`, `update`, `create_revision`, `validate_revision`, `validation_status`, `validation_logs`, `publish_revision`, `archive`, `data_catalog` |
| `manage_chat_providers` | `list_provider_definitions`, `list_connections`, `get_connection`, `create_connection`, `update_connection`, `delete_connection`, `list_channel_bindings`, `create_channel_binding`, `update_channel_binding`, `delete_channel_binding`, `list_outbound_deliveries` |
| `manage_telemetry` | `get_project_stats_snapshot`, `get_project_execution_snapshot`, `list_execution_invocations`, `list_execution_invocation_messages`, `list_sprint_runs`, `list_task_dispatches` |

For `manage_projects` setup, clients may send setup options either as `setup.options` or as top-level `options`. `options.docs: true` is opt-in and embeds discovered repository documentation into the Knowledge docs library.

For the full per-action payloads and return shapes, see [Management actions](./management-actions.md).

### Background sprint planning

`manage_sprints` with `action: "plan"` returns a `status: "started"` acknowledgement immediately after synchronous precondition validation, while planning continues server-side. The stable `result` fields are `status`, `message`, `projectId`, and `sprintId`; the acknowledgement does not mean generated tasks already exist or that optional auto-start has completed.

For dashboard chat-originated calls, Code UX queues a due-now, non-recurring `agent_wakeup` after planning settles. It targets the originating thread and asks the chat agent to recap the generated task count and whether execution actually started. Planning failures queue a same-thread wakeup containing the failure reason and a request for a concise failure recap.

Standalone MCP clients do not have originating dashboard chat-thread context. They receive the same acknowledgement without a completion wakeup and should poll `manage_sprints` and `manage_tasks`, or inspect relevant `manage_telemetry` state, for completion.

## `add_long_term_memory`

`add_long_term_memory` is the user-facing Project Manager's direct remember/learn lane. It is intentionally separate from the broad `manage_memory` lifecycle actions.

```jsonc
{
  "projectId": "project-123",
  "memory": "Use dependency factory composition for service wiring.",
  "category": "patterns",
  "confidence": 0.95,
  "durability": 0.9,
  "tags": ["architecture"],
  "appliesToPaths": ["src/services"]
}
```

`projectId` and non-blank `memory` are required. Category defaults to `learning`; confidence and durability default to `0.9`. Optional `sourceMemoryId` links project-owned short-term evidence. Success writes a canonical claim and searchable project-memory mirror, then returns `richWidget.type = "memory"`. The Project Manager re-emits those exact returned values in a `codeux:memory` fenced block for the dashboard to render; it must not invent the IDs.

## `scheduler_code_ux`

`scheduler_code_ux` is the restricted agent scheduler surface. It is separate from `manage_scheduler`, which
remains the broad project-manager scheduler management tool for sprints, quicksprints, chat entries,
updates, deletion, and due-entry execution.

Allowed actions:

- `list` — requires `projectId`; returns only `agent_scheduler` wakeup entries created by the calling agent.
- `schedule_wakeup` — requires `projectId`, `bodyMarkdown`, and exactly one timing mode: `scheduledFor`, `delaySeconds`/`delayMinutes`, `wakeAfterReply: true`, `afterSprintId`, or `afterTaskId`; optional `offsetMinutes`, `title`, `timezone`, `threadId`, and `connectionId`.
- `cancel` — requires `entryId`; changes the entry status to `cancelled` only when the entry was created by the calling agent through `scheduler_code_ux`.

`wakeAfterReply: true` creates a due-now wakeup that the dashboard chat runtime drains immediately after
the current reply is sent, allowing an agent to answer first and continue with MCP calls in the next
turn. `afterSprintId` and `afterTaskId` create one-time completion anchors; `offsetMinutes` delays the
wakeup after the source sprint or task finishes.

Security model: Code UX stamps restricted scheduler entries with `origin: "agent_scheduler"`,
`source: "agent_scheduler"`, and `createdByAgentId` from the current MCP agent context. The server
enforces this metadata on list and cancel, so an agent cannot cancel dashboard-created entries,
task entries, entries created through `manage_scheduler`, or entries created by another agent. The restricted tool
does not expose `run_due`, arbitrary updates, recurrence editing, sprint or quicksprint scheduling,
memory remediation, or global scheduler destructive controls.

## Node flows

`manage_node_flows` exposes project node workflows through MCP. It supports graph validation, CRUD,
runtime execution, run inspection, and flow-backed agent skill attachments.

Create and update calls validate the structured graph before repository writes. `run` delegates to the
node-flow runtime through `NodeFlowService.runFlow`, and `delete` requires the normal approval
handshake. Responses mask secret-shaped graph data, inputs, and outputs before returning them to MCP
clients.

Agents should build Code UX-adapted node flows rather than cloning n8n workflows one-to-one. Graphs
should include dynamic widget schemas for editable graph inputs and node fields; callers can provide
`widgets` as a graph-level `{ fields: [...] }` schema or as node-id keys mapped to node widget schemas.

Executable node types are currently `input`, `set_fields`, `template`, `provider_prompt`,
`http_request`, and `output`. Graph validation accepts structured drafts, but runtime execution rejects
unsupported node types.

Minimal create payload:

```jsonc
{
  "action": "create",
  "projectId": "project-123",
  "name": "Daily API Check",
  "graph": {
    "nodes": [
      { "id": "input", "type": "input", "title": "Run input" },
      {
        "id": "request",
        "type": "http_request",
        "title": "Fetch status",
        "data": {
          "method": "GET",
          "url": "{{ input.statusUrl }}",
          "headers": { "authorization": "Bearer {{ input.apiTokenRef }}" }
        }
      },
      { "id": "output", "type": "output", "title": "Output" }
    ],
    "edges": [
      { "fromNodeId": "input", "toNodeId": "request" },
      { "fromNodeId": "request", "toNodeId": "output" }
    ]
  },
  "widgets": {
    "fields": [
      { "id": "statusUrl", "type": "text", "label": "Status URL", "required": true },
      { "id": "apiTokenRef", "type": "secretRef", "label": "API token reference", "required": true }
    ]
  }
}
```

Attach and run:

```jsonc
{ "action": "attach_to_agent", "flowId": "flow-123", "agentPresetId": "agent-123", "skillAlias": "Daily API Check" }
```

```jsonc
{ "action": "run", "projectId": "project-123", "flowId": "flow-123", "input": { "statusUrl": "https://example.test/status", "apiTokenRef": "secret://status/token" } }
```

Use `validate` to inspect a draft graph without saving, `list_runs` for recent run summaries, and
`get_run` for the parent run plus per-node rows. Keep raw secrets out of MCP payloads; use references
and let Code UX redaction mask any secret-shaped keys in returned graph, input, trigger, and output
payloads.

## Approval handshake (destructive actions)

Destructive and mutating actions require a two-step confirmation. The first call returns an approval
requirement; you then retry the *same* action and payload with `approval: { "confirmed": true }`:

```jsonc
// 1) first call returns:
{ "approvalRequired": true, "approvalMessage": "Deleting project foo will orphan 5 sprints…" }

// 2) retry with confirmation:
{ "action": "delete", "projectId": "foo", "approval": { "confirmed": true } }
```

Settings mutations are stricter: only the same action and payload may execute once with
`approval.confirmed: true`, within a 15-minute window.

Secret-bearing settings synchronization also uses that one-use approval handshake:

- `export_settings_bundle` returns a schema-versioned bundle with `exportedAt`, `includedScopes`,
  a secret-redacted SHA-256 `fingerprint`, and `containsSecrets`. Export redacts provider API keys,
  git tokens, issue-tracker tokens, and login credential markers unless `includeSecrets: true` is
  approved for the exact export payload.
- `apply_settings_bundle` accepts a `bundle` and optional `scopes` for partial import. It persists
  through the same system, project, and sprint settings repository APIs used by the dashboard, so
  imported values are normalized before storage. Any bundle marked as containing secrets, or whose
  payload includes secret-bearing fields, requires approval before it is applied.

Chat provider management uses the same safety model for sensitive operations:

- `delete_connection` and `delete_channel_binding` require approval confirmation.
- `update_connection` requires a one-use approval handshake before replacing a non-empty `secrets`
  payload. Responses include redacted credential metadata and generated ingress URL guidance, never
  raw secret values.

## `manage_chat_providers`

`manage_chat_providers` configures external chat provider setup definitions, provider connections,
channel bindings, and outbound delivery inspection. It does not process inbound messages or force
outbound sends; those are runtime services behind authenticated ingress and delivery adapters.

Supported provider kinds are `whatsapp`, `imessage`, `telegram`, `slack`, `microsoft-teams`, and
`discord`. Supported bridge modes are `managed_bridge`, `webhook`, and `native_bridge`. Code UX does not
call those providers' official APIs directly; it talks to the configured managed bridge, webhook
gateway, or native bridge command.

Common actions:

- `list_provider_definitions` returns setup schemas, required secret fields, and ingress guidance.
- `create_connection` and `update_connection` save provider kind, bridge mode, setup fields, enabled
  state, status, and write-only secret replacements.
- `create_channel_binding` and `update_channel_binding` attach external channels to projects with
  optional routing hints, inbound/outbound flags, `agentPresetId`, and `suppressRichWidgets`.
- `list_outbound_deliveries` reads persisted outbound delivery state by connection, binding, channel,
  status, and limit.

Redaction rules:

- Raw `secrets` are never returned in success responses, validation errors, or approval envelopes.
- Public connection records return `credentials` entries that show only key, label, configured state,
  and redacted placeholder.
- Delivery payloads, bridge response metadata, and error text are redacted before MCP responses.

Approval behavior:

- `delete_connection` requires approval and cascades channel bindings and delivery rows.
- `delete_channel_binding` requires approval and stops routing for that channel/project pair.
- `update_connection` requires a one-use approval handshake before replacing a non-empty `secrets`
  payload. The approval fingerprint is bound to the redacted payload plus a secret hash.

Create a webhook-backed connection:

```jsonc
{
  "action": "create_connection",
  "providerKind": "slack",
  "displayName": "Team chat bridge",
  "bridgeMode": "webhook",
  "status": "active",
  "enabled": true,
  "setup": {
    "eventsUrl": "https://bridge.example.test/events",
    "appId": "app-generic"
  },
  "secrets": {
    "signingSecret": "replace-with-secret",
    "botToken": "replace-with-token"
  }
}
```

Bind a shared external channel to a project:

```jsonc
{
  "action": "create_channel_binding",
  "providerConnectionId": "connection-generic",
  "externalChannelId": "channel-shared",
  "externalChannelName": "Shared engineering channel",
  "projectId": "project-alpha",
  "routingHints": {
    "projectSelectorPrefix": "alpha",
    "aliases": ["alpha", "project-alpha"]
  },
  "inboundEnabled": true,
  "outboundEnabled": true,
  "suppressRichWidgets": true
}
```

Inspect retryable outbound delivery state:

```jsonc
{
  "action": "list_outbound_deliveries",
  "providerConnectionId": "connection-generic",
  "externalChannelId": "channel-shared",
  "deliveryStatus": "retryable_failure",
  "limit": 25
}
```

Delivery statuses include `pending`, `sending`, `delivered`, `retryable_failure`, `processed`,
`failed`, `duplicate`, and `cancelled`.

## `search_knowledge`

Semantic search over the knowledge base subscribed to the caller — scoped to the caller's own
subscriptions, so no project id is needed.

```jsonc
{
  "query": "string",          // required — natural-language query
  "limit": 5,                  // optional — max passages (default 5)
  "minSimilarity": 0.0         // optional — minimum cosine similarity (0–1)
}
```

Returns the most relevant passages with their source documents. See the
[Knowledge](../user/dashboard/knowledge.md) page for managing the underlying documents.

## Persistent skills

`manage_skills` is the storage and authoring surface for durable project skills. It supports:

- Storage CRUD: `list_storages`, `get_storage`, `create_storage`, `update_storage`, `delete_storage`.
- Skill CRUD: `list_skills`, `get_skill`, `create_skill`, `update_skill`, `delete_skill`.
- Agent attachment management: `list_agent_storages`, `attach_storage`, `detach_storage`.
- Markdown import/export: `import_markdown`, `export_markdown`.
- Authoring guidance: `authoring_prompt`.
- Destructive cleanup: `delete_storage`, `reset_storage`, and `delete_skill` require the approval handshake.

`update_skill` edits the existing skill in place: the request's `storageId` must match the skill's
current storage. If `sourceType` or `sourceRef` are omitted, Code UX preserves the skill's existing
provenance; callers can still explicitly supply those fields to replace provenance.

Skill markdown is saved through MCP payloads, not by writing files into the project workspace:

```md
---
title: Review Discipline
description: Keep review findings concrete.
tags: ["review", "quality"]
appliesTo: ["src/services", "tests/backend"]
version: 1.0.0
---

Focus on bugs, regressions, missing tests, and rollback risk.
```

`search_skills` is the retrieval-only surface. It accepts:

```jsonc
{
  "projectId": "project-123",      // required
  "query": "review checklist",      // required
  "agentPresetId": "agent-123",     // optional, searches attached storages
  "storageId": "skills-review",     // optional, narrows to one storage
  "limit": 5,                       // optional, capped by the handler
  "minSimilarity": 0.3              // optional, 0-1
}
```

Search results return concise ranked summaries with skill IDs and metadata. Full content retrieval
requires `manage_skills` via `export_markdown` or `get_skill` with `includeContent: true`.

Agent-authenticated MCP connections do not trust these optional scope fields to widen access. Code UX
requires the authenticated agent to belong to `projectId`, rejects a different caller-supplied
`agentPresetId`, and searches only that agent's enabled project-owned storage attachments. A direct
`storageId` must be one of those attachments. MCP connections without an agent identity preserve the
project-manager behavior: they may search the project, a project-owned agent's attachments, or one
project-owned storage.

## Error model

Tool handlers return one of:

- A structured success envelope.
- A standard MCP error: `InvalidParams`, `MethodNotFound`, or `InternalError`.
- A success envelope containing `{ "error": { code, message } }` for non-fatal action failures
  (e.g. a validation error inside an action).

JSON-RPC error codes used over the HTTP transport:

| Code | Meaning |
| --- | --- |
| `-32000` | Bad Request (HTTP 400) |
| `-32001` | Unauthorized (HTTP 401) |
| `-32600` | Invalid Request |
| `-32601` | Method Not Found |
| `-32602` | Invalid Params |
| `-32603` | Internal Error |

## Tool lifecycle

```
Client → ListTools → server returns enabled tools (filtered by role + toggles)
Client → CallTool(name, args)
  Server → AJV-validate args against the tool's inputSchema
  Server → dispatch to the management handler
  Server → return the wrapped result
```

The tool set is identical across the stdio and HTTPS transports. For client setup, see
[MCP clients](../user/mcp-clients.md); for transport internals, see
[Architecture → MCP server](../architecture/mcp-server.md).
