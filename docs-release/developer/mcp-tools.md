# MCP tools

Code UX is also an MCP server. When connected, it advertises a set of **management tools** that an
MCP client (or another agent) can call to drive projects, sprints, tasks, agents, memory, settings,
previews, and telemetry. This page is the exact contract: the tool list, each tool's `action` enum,
input shape, approval rules, and the error model.

> **Server identity:** the server identifies as `code-ux`, with the version matching the installed
> package (the `0.8.x` line). The package on npm is `@codeuxai/codeux`. Capabilities advertised at
> `initialize`: `tools`, `resources`, `prompts`.

## Tool availability

Tools are filtered before being advertised on `ListTools`:

1. **Runtime role** — every tool declares `runtimeRoles`. The server role is set with `--runtime-role`
   (default and only functional role: `project_manager`).
2. **Toggle** — each tool has an entry under `settings.mcpTools`. Disabled tools are not advertised
   and return `MethodNotFound` if called.

All inputs are validated against their declared JSON Schema (AJV) before dispatch; validation
failures return `InvalidParams` with the failing JSON path.

## The tools

Code UX exposes **one tool per management domain**, plus `search_knowledge`. Each `manage_*` tool
takes an `action` (from a fixed enum) plus action-specific fields, and an optional `approval` object
for destructive actions.

| Tool | Category | Purpose |
| --- | --- | --- |
| `manage_projects` | orchestration | List, get, create, update, select, set up, and delete projects. |
| `manage_sprints` | orchestration | Plan, start, pause, cancel, inspect, import issues into, and edit sprints. |
| `manage_tasks` | orchestration | Create, edit, start, stop, pause, and inspect tasks. |
| `manage_quicksprints` | orchestration | Manage quicksprint templates and execute them. |
| `manage_scheduler` | orchestration | Create and run scheduled sprints, quicksprints, and messages. |
| `manage_agents` | agents & memory | Manage agent presets and sync them to project markdown. |
| `manage_memory` | agents & memory | Inspect, search, promote, and re-embed short/long-term memory. |
| `search_knowledge` | agents & memory | Semantic search over the knowledge base subscribed to the caller. |
| `manage_settings` | platform | Get/resolve/patch/replace/reset system, project, and sprint settings. |
| `manage_preview` | platform | Manage sprint preview containers (start/stop/rebuild, logs, scripts). |
| `manage_telemetry` | platform | Read execution snapshots, invocations, sprint runs, and dispatches. |
| `manage_code_ux` | advanced | **Deprecated** unified dispatcher (see below). Prefer the dedicated tools. |

Every tool requires `runtimeRoles: ["project_manager"]` and is enabled by default.

### Action enums

| Tool | `action` values |
| --- | --- |
| `manage_projects` | `list`, `get`, `create`, `update`, `select`, `setup`, `delete` |
| `manage_sprints` | `list`, `get`, `create`, `update`, `delete`, `start`, `pause`, `cancel`, `force_cancel`, `inspect_run`, `import_issues`, `plan` |
| `manage_tasks` | `list`, `get`, `create`, `update`, `delete`, `start`, `stop`, `force_stop`, `pause`, `inspect_run` |
| `manage_quicksprints` | `list_templates`, `get_template`, `create_template`, `update_template`, `delete_template`, `execute`, `start` |
| `manage_scheduler` | `list`, `create`, `update`, `delete`, `run_due`, `schedule_sprint`, `schedule_quicksprint`, `schedule_chat` |
| `manage_agents` | `list`, `get`, `create`, `update`, `delete`, `sync` |
| `manage_memory` | `list`, `get`, `count`, `create`, `update`, `delete`, `search`, `promote`, `get_map`, `model_status`, `start_reembed` |
| `manage_settings` | `get_system`, `get_project_override`, `resolve_project_effective`, `get_sprint_override`, `resolve_sprint_effective`, `replace_system_settings`, `patch_system_setting`, `replace_project_settings`, `patch_project_setting`, `reset_project_settings`, `replace_sprint_settings`, `patch_sprint_setting`, `reset_sprint_settings` |
| `manage_preview` | `list_sessions`, `start_session`, `stop_session`, `rebuild_session`, `remove_session`, `get_logs`, `get_url`, `get_script`, `update_script` |
| `manage_telemetry` | `get_project_stats_snapshot`, `get_project_execution_snapshot`, `list_execution_invocations`, `list_execution_invocation_messages`, `list_sprint_runs`, `list_task_dispatches` |

For the full per-action payloads and return shapes, see [Management actions](./management-actions.md).

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

## `manage_code_ux` (deprecated)

A single dispatcher that proxies to any domain via `{ domain, action, payload, approval }`. It still
works but is **deprecated** in favor of the dedicated `manage_*` tools, which carry typed schemas and
clearer enums.

```jsonc
{
  "domain": "projects",        // projects | sprints | tasks | quicksprints | scheduler |
                                //  settings | agents | memory | preview | telemetry
  "action": "list",
  "payload": { },
  "approval": { "confirmed": false }
}
```

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
