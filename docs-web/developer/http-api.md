# HTTP API reference

The Code UX dashboard process exposes a REST API on the same port as the dashboard UI (default `4444`). All endpoints return JSON unless otherwise noted.

This page lists every endpoint, grouped by domain. Path parameters use `:name` notation. Required query parameters are listed inline.

> **Authentication:** The dashboard REST API is intended for trusted local consumption. It is not authenticated. Bind only to loopback (default) or front it with a reverse proxy when exposing remotely.

> **MCP HTTP gateway** (`--mcp-http`) is a *separate* listener for JSON-RPC and is documented in [MCP server](../architecture/mcp-server.md).

---

## Health & runtime

| Method | Path | Returns |
| --- | --- | --- |
| `GET` | `/health` | `{ "status": "UP" }` — liveness. |
| `GET` | `/ready` | `{ "components": { "settingsDb", "dashboardBind", "mcpService" } }` — readiness. |
| `GET` | `/api/status` | High-level system status snapshot. |
| `GET` | `/api/execution` | Current execution state across all sprints. |
| `GET` | `/api/live?projectId=` | Combined live snapshot. Optional project filter. |
| `GET` | `/api/telemetry/overview` | Overview metrics for the home page. |
| `GET` | `/api/live-activities` | Live agent activities (cached 10 s). |
| `GET` | `/api/git-status` | Git status (cached 10 s) — branches, PRs, CI. |

---

## Projects

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/projects` | List projects. |
| `POST` | `/api/projects` | Create. Body: `CreateProjectInput`. |
| `GET` | `/api/projects/:projectId` | Get one. |
| `PATCH` | `/api/projects/:projectId` | Update. |
| `DELETE` | `/api/projects/:projectId` | Delete. |
| `PUT` | `/api/projects/:projectId/select` | Set active project. |
| `PUT` | `/api/projects/:projectId/selected-sprint` | Set selected sprint for project. |
| `GET` | `/api/projects/:projectId/execution` | Project execution state. |
| `GET` | `/api/projects/:projectId/stats?window=24h\|7d\|30d\|custom` | Stats. |
| `PUT` | `/api/projects/:projectId/preferred-worker` | Set preferred worker connection. |
| `POST` | `/api/projects/:projectId/attention-items/:id/claim` | Claim an attention item. |
| `POST` | `/api/projects/:projectId/attention-items/:id/resolve` | Resolve an attention item. |

---

## Sprints

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/projects/:projectId/sprints` | List. |
| `POST` | `/api/projects/:projectId/sprints` | Create. |
| `PATCH` | `/api/sprints/:sprintId` | Update. |
| `DELETE` | `/api/sprints/:sprintId` | Delete. |
| `POST` | `/api/projects/:projectId/sprints/import` | Import from a markdown bundle. |
| `GET` | `/api/projects/:projectId/sprints/:sprintId/export` | Export as a markdown bundle. |

---

## Tasks

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/projects/:projectId/tasks?sprintId=` | List. |
| `POST` | `/api/projects/:projectId/tasks` | Create. |
| `PATCH` | `/api/tasks/:taskId` | Update. |
| `DELETE` | `/api/tasks/:taskId` | Delete. |

---

## Execution control

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/api/tasks/:taskId/rerun` | Body: `{ provider?, clearWorktree?, resetDependents? }`. |
| `POST` | `/api/projects/:projectId/sprints/:sprintId/orchestrate` | Start a sprint run. |
| `POST` | `/api/sprint-runs/:sprintRunId/pause` | Pause. |
| `POST` | `/api/sprint-runs/:sprintRunId/cancel` | Graceful cancel. |
| `POST` | `/api/sprint-runs/:sprintRunId/force-cancel` | Force cancel. |
| `POST` | `/api/task-dispatches/:dispatchId/cancel` | Cancel a dispatch. |
| `POST` | `/api/task-dispatches/:dispatchId/force-cancel` | Force cancel. |
| `POST` | `/api/task-dispatches/:dispatchId/retry` | Retry a failed dispatch. |

---

## Sprint planning

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/api/projects/:projectId/planning/improve-sprint-prompt` | AI improves the prompt before planning. |
| `POST` | `/api/projects/:projectId/sprints/:sprintId/plan` | AI plans the sprint. Aborts via signal. |
| `POST` | `/api/planning-requests/:clientRequestId/cancel` | Cancel an in-flight plan request. |

---

## Settings

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/system-settings` | Get system settings. |
| `PUT` | `/api/system-settings` | Replace system settings. |
| `GET` | `/api/projects/:projectId/settings` | Get project override. |
| `PUT` | `/api/projects/:projectId/settings` | Replace project settings. |
| `DELETE` | `/api/projects/:projectId/settings` | Reset project settings. |
| `GET` | `/api/projects/:projectId/settings/effective` | Merged effective settings. |
| `GET` | `/api/sprints/:sprintId/settings` | Get sprint override. |
| `PUT` | `/api/sprints/:sprintId/settings` | Replace sprint settings. |
| `DELETE` | `/api/sprints/:sprintId/settings` | Reset sprint settings. |
| `GET` | `/api/projects/:projectId/sprints/:sprintId/settings/effective` | Merged effective. |
| `GET` | `/api/settings/import-sources` | External settings hints (env, gh CLI). |
| `POST` | `/api/system/reset-database` | **Destructive.** Wipe all state. |

---

## Conversations & chat

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/projects/:projectId/conversations/threads` | List threads. |
| `POST` | `/api/projects/:projectId/conversations/threads` | Create thread. |
| `GET` | `/api/conversations/threads/:threadId/messages` | List messages. |
| `POST` | `/api/projects/:projectId/conversations/messages` | Post message. |
| `PATCH` | `/api/conversations/threads/:threadId` | Update thread (title, etc.). |
| `PUT` | `/api/conversations/threads/:threadId/route` | Update routing config. |
| `POST` | `/api/conversations/threads/:threadId/compact` | Compact thread. |
| `DELETE` | `/api/conversations/threads/:threadId` | Delete thread. |

---

## Execution invocations

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/projects/:projectId/execution/invocations` | Filterable invocation log. |
| `GET` | `/api/execution/invocations/:invocationId/messages` | Messages for one invocation. |

---

## MCP connections

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/projects/:projectId/connections` | List connections bound to the project. |
| `PATCH` | `/api/connections/:connectionId` | Update metadata (display name etc.). |

---

## Agent presets

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/projects/:projectId/agent-presets` | List. |
| `POST` | `/api/projects/:projectId/agent-presets` | Create. |
| `PATCH` | `/api/agent-presets/:agentPresetId` | Update. |
| `DELETE` | `/api/agent-presets/:agentPresetId` | Delete. |
| `POST` | `/api/agent-presets/:agentPresetId/import-markdown` | Import from a single file. |
| `POST` | `/api/projects/:projectId/agent-presets/sync-markdown` | Bulk-sync from `.code-ux/agents/`. |

---

## Quicksprint templates

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/projects/:projectId/quicksprints/templates` | List. |
| `GET` | `/api/projects/:projectId/quicksprints/templates/:templateId` | Get one. |
| `POST` | `/api/projects/:projectId/quicksprints/templates` | Create. |
| `PATCH` | `/api/projects/:projectId/quicksprints/templates/:templateId` | Update. |
| `DELETE` | `/api/projects/:projectId/quicksprints/templates/:templateId` | Delete. |
| `POST` | `/api/projects/:projectId/quicksprints/execute` | Execute, returns the new sprint. |

---

## Memory

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/projects/:projectId/memories` | List. |
| `POST` | `/api/projects/:projectId/memories` | Create. |
| `PATCH` | `/api/memories/:memoryId` | Update. |
| `DELETE` | `/api/memories/:memoryId` | Delete. |
| `POST` | `/api/projects/:projectId/memories/search` | Vector search. |
| `POST` | `/api/projects/:projectId/memories/promotion/analyze` | Analyse promotion candidates. |
| `POST` | `/api/projects/:projectId/memories/promotion/execute` | Promote. |
| `POST` | `/api/projects/:projectId/memories/reembed` | Trigger re-embed. |
| `GET` | `/api/projects/:projectId/memories/reembed/progress` | Re-embed progress. |
| `GET` | `/api/projects/:projectId/memories/embedding-map` | Embedding graph. |
| `GET` | `/api/projects/:projectId/memories/stats` | Memory statistics. |

### Embedding models

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/embedding-models` | List. |
| `POST` | `/api/embedding-models/:modelId/download` | Download. |
| `POST` | `/api/embedding-models/:modelId/cancel` | Cancel download. |
| `POST` | `/api/embedding-models/:modelId/select` | Activate. |
| `DELETE` | `/api/embedding-models/:modelId` | Delete. |
| `GET` | `/api/embedding-models/:modelId/status` | Download / load status. |

---

## Sprint preview

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/projects/:projectId/preview/sessions` | List sessions. |
| `POST` | `/api/projects/:projectId/sprints/:sprintId/preview/start` | Start. |
| `POST` | `/api/browser/sessions/:sessionId/rebuild` | Rebuild. |
| `POST` | `/api/browser/sessions/:sessionId/stop` | Stop. |
| `DELETE` | `/api/browser/sessions/:sessionId` | Remove. |
| `GET` | `/api/projects/:projectId/sprints/:sprintId/preview/script` | Get script. |
| `PUT` | `/api/projects/:projectId/sprints/:sprintId/preview/script` | Save script. |
| `GET` | `/api/browser/sessions/:sessionId/logs` | Stream logs. |

---

## Docker

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/docker/containers` | List Code UX-related Docker containers. |

---

## Real-time WebSocket

| Path | Protocol |
| --- | --- |
| `/api/realtime` | WebSocket — see [Realtime protocol](./websocket-realtime.md). |

---

## Response conventions

- All responses are JSON.
- Successful response: 200 / 201 / 204 with the resource body or `{ "ok": true }`.
- Validation error: 400 with `{ "error": { "code": "VALIDATION", "message": "...", "details": ... } }`.
- Not found: 404 with `{ "error": { "code": "NOT_FOUND" } }`.
- Conflict: 409 with `{ "error": { "code": "CONFLICT", "message": "..." } }`.
- Internal error: 500 with `{ "error": { "code": "INTERNAL", "message": "..." } }`.

## Pagination

List endpoints that may return many rows accept:

- `?limit=N` (default 100, max 500).
- `?cursor=opaque-string` returned in the previous response under `nextCursor`.

Endpoints that do not paginate return the full list in `items`.

## Caching headers

`/api/live-activities` and `/api/git-status` set `Cache-Control: max-age=10` to align browser caching with the server-side cache TTL.
