# Management actions

The `manage_code_ux` MCP tool dispatches into 8 management **domains**, each containing one or more **actions**. This page is the complete matrix.

The shape of every call is:

```jsonc
{
  "domain": "<name>",
  "action": "<name>",
  "payload": { /* action-specific */ },
  "approval": { "confirmed": true }   // required for destructive actions on second call
}
```

**Approval handshake:** Destructive actions return `{ approvalRequired: true, approvalMessage: "..." }` on first call. Re-call with `approval: { confirmed: true }` to proceed.

---

## `projects`

Domain for project CRUD and selection.

| Action | Destructive | Required payload | Description |
| --- | --- | --- | --- |
| `list` | – | – | List all projects. |
| `get` | – | `projectId` | Get a specific project. |
| `create` | – | `CreateProjectInput` | Create a new project. |
| `update` | – | `projectId`, `UpdateProjectInput` | Update a project. |
| `select` | – | `projectId \| null` | Set the active project. |
| `delete` | ✅ | `projectId` | Delete a project (+ approval). |

`CreateProjectInput` includes: `name`, `repositoryPath`, optional `defaultBranch`, `featureBranchPrefix`, `description`, `githubMode`.

---

## `sprints`

| Action | Destructive | Required payload | Description |
| --- | --- | --- | --- |
| `list` | – | `projectId` | List sprints for a project. |
| `get` | – | `sprintId` | Get a sprint. |
| `create` | – | `projectId`, `CreateSprintInput` | Create a sprint. |
| `update` | – | `sprintId`, `UpdateSprintInput` | Update a sprint. |
| `delete` | ✅ | `sprintId` | Delete a sprint. |
| `start` | – | `projectId`, `sprintId` | Begin a sprint run (orchestrate). |
| `pause` | – | `sprintRunId` | Pause an active run. |
| `cancel` | – | `sprintRunId` | Cancel gracefully. |
| `force_cancel` | – | `sprintRunId` | Force-cancel (immediate). |
| `inspect_run` | – | `projectId`, `sprintId`, `sprintRunId?` | Inspect run(s). |

---

## `tasks`

| Action | Destructive | Required payload | Description |
| --- | --- | --- | --- |
| `list` | – | `projectId`, `sprintId` | List tasks. |
| `get` | – | `taskId` | Get a task. |
| `create` | – | `projectId`, `sprintId`, `title`, optional: `promptMarkdown`, `description`, `priority`, `dependsOnTaskIds` | Create a task. |
| `update` | – | `taskId`, optional: `title`, `promptMarkdown`, `description`, `priority`, `dependsOnTaskIds` | Update a task. |
| `delete` | ✅ | `taskId` | Delete a task. |
| `start` | – | `taskId`, optional `provider` | Start / rerun. |
| `stop` | – | `taskId` | Stop the active dispatch. |
| `force_stop` | – | `taskId` | Force-stop. |
| `pause` | – | `taskId` | Pause the active dispatch. |
| `inspect_run` | – | `taskId` | Inspect runs and the latest dispatch. |

---

## `settings`

| Action | Destructive | Required payload | Description |
| --- | --- | --- | --- |
| `get_system` | – | – | Get system settings. |
| `get_project_override` | – | `projectId` | Get project override. |
| `resolve_project_effective` | – | `projectId` | Get merged effective settings for project. |
| `get_sprint_override` | – | `sprintId` | Get sprint override. |
| `resolve_sprint_effective` | – | `projectId`, `sprintId` | Get merged effective sprint settings. |
| `replace_system_settings` | ✅ | `settings` | Replace all system settings. |
| `patch_system_setting` | ✅ | `path`, `value` | Patch one field by JSON path. |
| `replace_project_settings` | ✅ | `projectId`, `settings` | Replace project settings. |
| `patch_project_setting` | – | `projectId`, `path`, `value` | Patch a project setting. |
| `reset_project_settings` | ✅ | `projectId` | Reset project to defaults. |
| `replace_sprint_settings` | ✅ | `projectId`, `sprintId`, `settings` | Replace sprint settings. |
| `patch_sprint_setting` | – | `projectId`, `sprintId`, `path`, `value` | Patch a sprint setting. |
| `reset_sprint_settings` | ✅ | `projectId`, `sprintId` | Reset sprint to defaults. |

JSON path examples for `patch_*`:
- `aiProvider.providers.codex.model` → string
- `ciIntelligence.featurePrAutoMergeMode` → enum
- `automationLevel` → enum

See [Settings schema reference](./settings-reference.md) for the full path tree.

---

## `agents`

Manages agent presets per project.

| Action | Destructive | Required payload | Description |
| --- | --- | --- | --- |
| `list` | – | `projectId` | List agent presets. |
| `get` | – | `projectId`, `presetId` | Get a preset. |
| `sync` | – | `projectId` | Sync agents from `.code-ux/agents/*.md`. |
| `create` | – | `projectId`, `name`, optional `instructionMarkdown`, `labels`, `avatarConfig`, `memoryTemplateOverrideEnabled`, `memoryTemplateMarkdown` | Create a preset. |
| `update` | – | `projectId`, `presetId`, update fields | Update a preset. |
| `delete` | ✅ | `projectId`, `presetId` | Delete a preset. |

---

## `memory`

| Action | Destructive | Required payload | Description |
| --- | --- | --- | --- |
| `search` | – | `projectId`, `query`, optional `scope`, `sprintId`, `agentPresetId`, `limit`, `minSimilarity` | Vector search. |
| `list` | – | `projectId`, optional scope filters | List memories. |
| `get` | – | `memoryId` | Get one. |
| `create` | – | `projectId`, `content`, optional `category` (default `context`), `scope` (default `project`), `strength` (default `1.0`), `sprintId`, `agentPresetId` | Create. |
| `update` | – | `memoryId`, optional `content`, `category`, `strength` | Update. |
| `delete` | ✅ | `memoryId` | Delete. |
| `promote` | – | `projectId`, `memoryIds`, optional `reason` | Promote memories. |
| `start_reembed` | – | `projectId` | Trigger re-embed with active model. |
| `get_map` | – | `projectId`, optional `scope`, `sprintId`, `agentPresetId`, `topKPerNode` | Get embedding-map graph. |
| `count` | – | `projectId`, `scope` | Count by scope. |
| `model_status` | – | – | Get embedding model status. |

---

## `preview`

Sprint preview browser sessions.

| Action | Destructive | Required payload | Description |
| --- | --- | --- | --- |
| `list_sessions` | – | `projectId` | List preview sessions. |
| `start_session` | – | `projectId`, `sprintId` | Start a session. |
| `rebuild_session` | – | `sessionId` | Rebuild from current worktree. |
| `stop_session` | – | `sessionId` | Stop the container. |
| `remove_session` | ✅ | `sessionId` | Remove session row. |
| `get_script` | – | `projectId`, `sprintId` | Get the preview script content. |

---

## `telemetry`

Read-only execution telemetry.

| Action | Destructive | Required payload | Description |
| --- | --- | --- | --- |
| `get_project_execution_snapshot` | – | `projectId` | Snapshot of current execution state. |
| `get_project_stats_snapshot` | – | `projectId` | Snapshot of stats (pre-aggregated). |
| `list_sprint_runs` | – | `projectId`, `sprintId` | Compact run list. |
| `list_task_dispatches` | – | `projectId`, `sprintId`, `taskId` | Per-task dispatch list. |
| `list_execution_invocations` | – | `projectId`, optional `sprintId`, `taskId`, `type` | Filter MCP invocations. |

---

## Common error patterns

- **`InvalidParams`** — payload missing a required field, or violates the per-action schema.
- **`approvalRequired: true`** — first call to a destructive action; re-call with `approval.confirmed: true`.
- **`error.code: NOT_FOUND`** — referenced ID does not exist.
- **`error.code: CONFLICT`** — operation cannot proceed in the current state (e.g. starting a sprint that is already running).

## Idempotency

- `create` actions are *not* idempotent — repeated calls create multiple rows. Track returned IDs.
- `update`, `select`, `start`, `pause`, `cancel`, `stop` are idempotent within their state class.
- `delete` is idempotent after the first successful call (subsequent calls return NOT_FOUND).
