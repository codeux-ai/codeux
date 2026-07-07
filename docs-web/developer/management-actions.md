# Management actions

Code UX exposes grouped MCP tools per management domain — `manage_projects`, `manage_sprints`,
`manage_tasks`, `manage_quicksprints`, `manage_scheduler`, `manage_agents`, `manage_memory`,
`search_knowledge`, `manage_settings`, `manage_preview`, and `manage_telemetry`. The deprecated
`manage_code_ux` tool remains available for compatibility, but the grouped tools are the primary
surface. Each domain has a set of **actions**. This page is the complete matrix. (See
[MCP tools](./mcp-tools.md) for the tool list and schemas.)

A dedicated-tool call takes the `action` plus action-specific fields:

```jsonc
{
  "action": "<name>",
  /* action-specific fields, e.g. "projectId", "sprintId", ... */
  "approval": { "confirmed": true }   // required for destructive actions on the second call
}
```

**Approval handshake:** Destructive actions return `{ approvalRequired: true, approvalMessage: "..." }` on first call. Re-call with `approval: { confirmed: true }` (or `--payload-json '{"approval":{"confirmed":true}}'` in the CLI) to proceed.

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
| `setup` | – | `projectId`, optional `setup` | Run the Project Setup Agent to generate agents, templates, and guidance. |
| `delete` | ✅ | `projectId` | Delete a project (+ approval). |

`CreateProjectInput` includes: `name`, `repositoryPath`, optional `defaultBranch`, `featureBranchPrefix`, `description`, `githubMode`.

---

## `sprints`

| Action | Destructive | Required payload | Description |
| --- | --- | --- | --- |
| `list` | – | `projectId` | List sprints for a project. |
| `get` | – | `sprintId` | Get a sprint. |
| `create` | – | `projectId`, `name \| title` | Create a sprint. Accepts `goal` or `goalMarkdown`, plus optional sprint metadata. |
| `update` | – | `sprintId`, update fields | Update a sprint. Accepts `name` or `title`, and `goal` or `goalMarkdown`. |
| `delete` | ✅ | `sprintId` | Delete a sprint. |
| `start` | – | `projectId`, `sprintId` | Begin a sprint run (orchestrate). |
| `pause` | – | `sprintRunId` | Pause an active run. |
| `cancel` | – | `sprintRunId` | Cancel gracefully. |
| `force_cancel` | – | `sprintRunId` | Force-cancel (immediate). |
| `inspect_run` | – | `projectId`, `sprintId`, `sprintRunId?` | Inspect run(s). |
| `import_issues` | – | `projectId`, optional `sprintId`, filters | Search provider issues, and optionally replace sprint linked issues. |
| `plan` | – | `projectId`, `sprintId` | Run the planning agent. Optional `autoStart`, `replan`, `planningAgentPresetId`, and `overrides`. Planning self-reflection gates `autoStart` when enabled; non-passing reflection saves the plan without starting the sprint. |

`title` and `goalMarkdown` are MCP-friendly aliases. The repository stores sprint `name` and `goal`.

---

## `tasks`

| Action | Destructive | Required payload | Description |
| --- | --- | --- | --- |
| `list` | – | `projectId`, optional `sprintId` | List all project tasks or filter to one sprint. |
| `get` | – | `taskId` | Get a task. |
| `create` | – | `projectId`, `sprintId`, optional fields | Create a task. `title` is canonical; `name` is accepted as an alias. |
| `update` | – | `taskId`, optional fields | Update a task. |
| `delete` | ✅ | `taskId` | Delete a task. |
| `start` | – | `taskId`, optional `provider` | Start / rerun. |
| `stop` | – | `taskId` | Stop the active dispatch. |
| `force_stop` | – | `taskId` | Force-stop. |
| `pause` | – | `taskId` | Pause the active dispatch. |
| `inspect_run` | – | `taskId` | Inspect runs and the latest dispatch. |

Task create/update fields include `title`, `name`, `promptMarkdown`, `description`, `status`, `priority`, `executorType`, `agentPresetId`, `model`, `sortOrder`, `dependsOnTaskIds`, `isIndependent`, and `isMerged`.

---

## `quicksprints`

| Action | Destructive | Required payload | Description |
| --- | --- | --- | --- |
| `list_templates` | – | `projectId` | List built-in and custom quicksprint templates. |
| `get_template` | – | `projectId`, `templateId` | Get one quicksprint template. |
| `create_template` | – | `projectId`, `name`, `description`, `icon`, `category`, `agentInstructionMarkdown` | Create a custom project template. Optional `categoryColor`, `defaultTaskCount`, `agentPresetId`. |
| `update_template` | – | `projectId`, `templateId`, update fields | Update a custom template. Built-in templates cannot be updated. |
| `delete_template` | ✅ | `projectId`, `templateId` | Delete a custom template. Built-in templates cannot be deleted. |
| `execute` | – | `projectId`, `templateId` | Create and plan a quicksprint. Optional `taskCount`, `submitMode`, `modelOverride`, `planningOverrides`, `agentPresetId`, `additionalPrompt`. Defaults to `submitMode: "plan_only"`. |
| `start` | – | `projectId`, `templateId` | MCP-friendly alias for executing with default `submitMode: "plan_and_start"`. |

`taskCount` defaults to `5` when omitted. MCP accepts `taskCount` as a number or numeric string. `submitMode` accepts `plan_only` or `plan_and_start`.

---

## `scheduler`

| Action | Destructive | Required payload | Description |
| --- | --- | --- | --- |
| `list` | – | `projectId`, optional `from`, `to` | List scheduler entries and occurrences for a project window. |
| `create` | – | `projectId`, `targetType`, `scheduledFor`, target payload | Create a generic scheduler entry for `sprint`, `quicksprint`, `chat`, or `memory_remediation`. |
| `schedule_sprint` | – | `projectId`, `scheduledFor`, `sprintId` | Schedule a sprint orchestration. |
| `schedule_quicksprint` | – | `projectId`, `scheduledFor`, `templateId` | Schedule a quicksprint. Optional `taskCount`, `submitMode`, `additionalPrompt`, `agentPresetId`, `planningOverrides`. |
| `schedule_chat` | – | `projectId`, `scheduledFor`, `bodyMarkdown` | Schedule a chat message. Optional `threadId`, `connectionId`, `title`, `timezone`, `recurrence`. |
| `update` | – | `entryId`, update fields | Update scheduler title, status, time, recurrence, or target payload. |
| `delete` | ✅ | `entryId` | Delete a scheduler entry. |
| `run_due` | – | optional `now` ISO date override | Evaluate due entries immediately, mostly for operational verification. |

`create` accepts nested targets (`sprintTarget`, `quicksprintTarget`, `chatTarget`) or the flattened fields used by the `schedule_*` aliases. `schedule_sprint`, `schedule_quicksprint`, and `schedule_chat` infer the target type. Scheduling supports an absolute time (`scheduledFor`) or an `after_sprint_end` anchor via `scheduleMode` or `anchorMode`, with `sourceSprintId` / `anchorSourceSprintId` and optional `offsetMinutes` / `anchorOffsetMinutes`.

Memory remediation schedules use `targetType: "memory_remediation"` but have their own dedicated `/api/projects/:projectId/scheduler/memory-remediation` HTTP routes separate from the normal scheduler entries.

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
| `patch_project_setting` | ✅ | `projectId`, `path`, `value` | Patch a project setting. |
| `reset_project_settings` | ✅ | `projectId` | Reset project to defaults. |
| `replace_sprint_settings` | ✅ | `projectId`, `sprintId`, `settings` | Replace sprint settings. |
| `patch_sprint_setting` | ✅ | `projectId`, `sprintId`, `path`, `value` | Patch a sprint setting. |
| `reset_sprint_settings` | ✅ | `projectId`, `sprintId` | Reset sprint to defaults. |

All mutating settings actions (replace, patch, reset) require human confirmation. Get/resolve actions are read-only. Mutating settings actions first return an approval-required response; only the exact same action and payload may execute once with `approval.confirmed: true` within 15 minutes. The approval is one-use and cannot approve a different settings payload.

JSON path examples for `patch_*`:
- `aiProvider.providers.codex.model` → string
- `ciIntelligence.featurePrAutoMergeMode` → enum
- `automationLevel` → enum
- `git.sprintKeyPrefix` → uppercase string such as `SPR`

`value` can be any JSON value, not only an object. This allows direct primitive patches such as booleans, strings, numbers, and `null`.

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

### Claim actions

The memory domain also exposes durable claim management:

| Action | Destructive | Required payload | Description |
| --- | --- | --- | --- |
| `create_claim` | – | `projectId`, `claim` | Create a project claim. Accepts `category`, `confidence`, `durability`, `tags`, `appliesToPaths`, `sourceMemoryId`, `supersedesClaimId`, `supportType`, `weight`, and `evidenceWeight`. |
| `list_claims` | – | `projectId` | List project claims. Accepts `status`, `category`, and `limit`. |
| `get_claim` | – | `projectId`, `claimId` | Get a specific claim. |
| `update_claim` | – | `projectId`, `claimId` | Update a claim. Accepts `claim`, `category`, `confidence`, `durability`, `status`, `tags`, `appliesToPaths`, and `supersedesClaimId`. |
| `add_claim_evidence` | – | `projectId`, `claimId`, `memoryId` | Add evidence to a claim. Accepts `supportType` and `weight`. |
| `deprecate_claim` | ✅ | `projectId`, `claimId` | Deprecate a claim and require approval confirmation. |

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
| `get_logs` | – | `sessionId` | Get container logs for a session. |
| `get_url` | – | `sessionId` | Get the session's proxied preview URL. |
| `get_script` | – | `projectId`, `sprintId` | Get the preview startup script content. |
| `update_script` | – | `projectId`, `sprintId`, script body | Update the per-sprint preview startup script. |

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
| `list_execution_invocation_messages` | – | `invocationId` | List messages for a specific execution invocation. |

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
