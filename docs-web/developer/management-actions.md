# Management actions

Code UX exposes **one MCP tool per management domain** — `manage_projects`, `manage_sprints`,
`manage_tasks`, `manage_quicksprints`, `manage_scheduler`, `manage_agents`, `manage_node_flows`, `manage_memory`,
`manage_settings`, `manage_preview`, `manage_custom_dashboards`, `manage_chat_providers`, and `manage_telemetry` — each with a set of
**actions**. This page is the complete matrix. (See [MCP tools](/docs/developer-mcp-tools) for the tool list and
schemas.)

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
| `setup` | – | `projectId`, optional `setup` or top-level `options` | Run the Project Setup Agent to generate agents, templates, guidance, and optional docs embedding (`options.docs`). |
| `delete` | ✅ | `projectId` | Delete a project (+ approval). |

`CreateProjectInput` includes: `name`, `repositoryPath`, optional `defaultBranch`, `featureBranchPrefix`, `description`, `githubMode`.

---

## `sprints`

| Action | Destructive | Required payload | Description |
| --- | --- | --- | --- |
| `list` | – | `projectId` | List sprints for a project. |
| `get` | – | `sprintId` | Get a sprint. |
| `create` | – | `projectId`, `name \| title` | Create a sprint. Accepts `goal` or `goalMarkdown`, plus optional sprint metadata. |
| `followup` | – | `projectId` | Save an idle, unplanned follow-up draft. Accepts the same title and goal aliases as `create` and never starts planning. |
| `update` | – | `sprintId`, update fields | Update a sprint. Accepts `name` or `title`, and `goal` or `goalMarkdown`. |
| `delete` | ✅ | `sprintId` | Delete a sprint. |
| `start` | – | `projectId`, `sprintId` | Begin a sprint run. If the sprint has no tasks, plan it with auto-start first. |
| `pause` | – | `sprintRunId` | Pause an active run. |
| `cancel` | – | `sprintRunId` | Cancel gracefully. |
| `force_cancel` | – | `sprintRunId` | Force-cancel (immediate). |
| `inspect_run` | – | `projectId`, `sprintId`, `sprintRunId?` | Inspect run(s). |
| `import_issues` | – | `projectId`, optional `sprintId`, filters | Search provider issues, and optionally replace sprint linked issues. |
| `plan` | – | `projectId`, `sprintId` | Start the planning agent server-side and return a started acknowledgement immediately after synchronous precondition validation. Optional `autoStart`, `replan`, `planningAgentPresetId`, and `overrides` are preserved. |

`title` and `goalMarkdown` are MCP-friendly aliases. The repository stores sprint `name` and `goal`.

For follow-up work that must wait for another sprint, call `followup` first, then schedule the returned sprint through `manage_scheduler` with `schedule_sprint`, `scheduleMode: "after_sprint_end"`, and the source sprint id. The draft stays idle and unplanned until that schedule starts it. Do not call `plan` before scheduling: the scheduled `start` performs planning with auto-start only after the source sprint has completed.

The stable immediate response is:

```json
{
  "result": {
    "status": "started",
    "message": "Sprint planning started in the background. You will be notified when it completes or fails.",
    "projectId": "project-123",
    "sprintId": "sprint-123",
    "planningGuidance": {
      "status": "in_progress",
      "asynchronous": true,
      "isTerminal": false,
      "invocationId": "planning-request-id",
      "startedAt": "2026-07-13T10:00:00.000Z",
      "estimatedDurationMs": 180000,
      "estimatedCompletionAt": "2026-07-13T10:03:00.000Z",
      "nextCheckAt": "2026-07-13T10:03:00.000Z",
      "recheckIntervalMs": 60000,
      "sampleSize": 2,
      "isFallbackEstimate": false,
      "message": "Planning is running asynchronously. Exceeding the estimated completion time is not evidence of failure. Do not requeue, resubmit, or change settings while this invocation remains in progress. Check the same invocation again at 2026-07-13T10:03:00.000Z."
    }
  }
}
```

`planningGuidance` fields are:

| Field | Contract |
| --- | --- |
| `status` | `in_progress`, `succeeded`, `failed`, `cancelled`, or `paused`; durable `running` and `completed` invocation states project as `in_progress` and `succeeded`. |
| `asynchronous` | Always `true`. |
| `isTerminal` | `false` for `in_progress`; `true` for every other status. |
| `invocationId` | Planning request/invocation identity to retain across checks. The initial request identity can be replaced by the durable invocation id once it exists. |
| `startedAt` | ISO estimate origin. |
| `estimatedDurationMs` | Duration selected from recent successful project planning samples or the shared three-minute fallback. |
| `estimatedCompletionAt` | Estimated finish (`startedAt + estimatedDurationMs`), not a failure deadline. |
| `nextCheckAt` | Initial check at `estimatedCompletionAt`; later in-progress checks one minute after the current read; `null` when terminal. |
| `recheckIntervalMs` | Subsequent cadence, `60000` milliseconds. |
| `sampleSize` | Number of usable completed samples used by the estimate. |
| `isFallbackEstimate` | Whether the duration came from the fallback rather than project history. |
| `message` | Actionable in-progress or terminal guidance, including the warning that ETA overrun is not failure. |
| `errorMessage` | Optional available terminal error evidence; omitted when unavailable or succeeded. |

The existing `result` fields `status`, `message`, `projectId`, and `sprintId` remain stable; `planningGuidance` is additive and backward compatible. This response acknowledges that background planning started; it does not mark planning complete, promise that tasks already exist, or indicate that optional auto-start has completed. Task persistence, planning self-reflection, and optional sprint execution remain owned by the background workflow.

Repeating `plan` for the same project and sprint while the request remains unsettled returns `status: "in_progress"` with a one-minute recheck time and starts neither another provider request nor another terminal callback. Sprint `get` preserves the sprint record and adds current guidance from the active request or latest durable planning invocation. Running reads advance the next check by one minute even after the ETA; succeeded, failed, cancelled, and paused terminal reads set `isTerminal: true`, set `nextCheckAt` to `null`, and surface available failure details. ETA overrun alone is never failure.

For MCP calls made from dashboard chat, planning success queues one due-now, non-recurring `agent_wakeup` for the originating thread. The wakeup asks the chat agent to recap the generated task count and whether execution actually started. Planning failure queues the same kind of same-thread wakeup with the failure reason and asks for a concise failure recap.

The assigned Project Manager creates only one-shot status wakeups: first at `estimatedCompletionAt`, then one at a time at each returned one-minute `nextCheckAt`. It lists before creating to suppress duplicates, never uses recurrence, and does not replan, requeue, or change provider/model/settings while planning is active. When terminal guidance or the runtime terminal wakeup arrives, it stops polling and cancels its obsolete pending checks for that invocation or sprint without cancelling the currently executing wakeup.

Standalone MCP clients receive the acknowledgement without a completion or Project Manager wakeup. They should poll sprint `get`, tasks, or relevant telemetry at `nextCheckAt`; polling does not queue scheduler entries.

This detached behavior applies only to the direct MCP `plan` action. `import_issues` with `planAfterImport` and non-MCP planning callers retain their awaited behavior.

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

## `node_flows`

| Action group | Approval | Behavior |
| --- | --- | --- |
| Catalog | – | `catalog` and `get_node_definition` return executable manifests and schemas without complete flow graphs. |
| Drafts | – | `create_draft`, `patch_draft`, and `validate_draft` return validation, policy, credential, capability, and side-effect summaries. `patch_draft` requires `draftRevision`. |
| Custom nodes | – | `create_custom_node`, `update_custom_node`, and `validate_custom_node` reuse the governed project/build services. |
| Credentials | – | `request_credential` and `inspect_bindings` expose metadata and permission findings only. |
| Review | – / ✅ | `dry_run` is side-effect free; `publish` and `rollback` require exact-payload approval; `compare_versions` returns structural summaries. |
| Operations | – | `run`, `cancel`, `retry`, `inspect_run`, and `list_runs` enforce project ownership and publication selection. Run, retry, and inspection summaries include durable redacted node attempts with attempt/retry outcomes, executor and invocation links, and artifact digests. |

Compatibility aliases remain for legacy list/get/create/update/delete/validate/run/attach/detach calls. Legacy create/update auto-publish for backward compatibility; governed draft actions do not. Attachments grant the agent only `run_attached_flow`, never the full management surface.

Attempt projections expose numbered status history, failure classifications, retry decisions, executor and execution-invocation identifiers, artifact digests, timestamps, and redacted input/output. They exclude credential values, credential-binding ids, and custom-node source. Attached agents continue to receive summary-only flow metadata rather than complete graphs.

---

## `scheduler`

| Action | Destructive | Required payload | Description |
| --- | --- | --- | --- |
| `list` | – | `projectId`, optional `from`, `to` | List scheduler entries and occurrences for a project window. |
| `create` | – | `projectId`, `targetType`, `scheduledFor`, target payload | Create a generic scheduler entry for `sprint`, `quicksprint`, `chat`, `node_flow`, or `memory_remediation`. |
| `schedule_sprint` | – | `projectId`, `scheduledFor`, `sprintId` | Schedule a sprint orchestration. |
| `schedule_quicksprint` | – | `projectId`, `scheduledFor`, `templateId` | Schedule a quicksprint. Optional `taskCount`, `submitMode`, `additionalPrompt`, `agentPresetId`, `planningOverrides`. |
| `schedule_chat` | – | `projectId`, `scheduledFor`, `bodyMarkdown` | Schedule a chat message. Optional `threadId`, `connectionId`, `title`, `timezone`, `recurrence`. |
| `schedule_node_flow` | – | `projectId`, `scheduledFor`, `flowId` | Schedule a node flow. Optional JSON `input`, `flowVersion`, `timezone`, and `recurrence`. |
| `update` | – | `entryId`, update fields | Update scheduler title, status, time, recurrence, or target payload. |
| `delete` | ✅ | `entryId` | Delete a scheduler entry. |
| `run_due` | – | optional `now` ISO date override | Evaluate due entries immediately, mostly for operational verification. |

`create` accepts nested targets (`sprintTarget`, `quicksprintTarget`, `chatTarget`, `nodeFlowTarget`) or the flattened fields used by the `schedule_*` aliases. `schedule_sprint`, `schedule_quicksprint`, `schedule_chat`, and `schedule_node_flow` infer the target type. Scheduling supports an absolute time (`scheduledFor`) or an `after_sprint_end` anchor via `scheduleMode` or `anchorMode`, with `sourceSprintId` / `anchorSourceSprintId` and optional `offsetMinutes` / `anchorOffsetMinutes`.

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

For direct Project Manager persistence, `add_long_term_memory` is a separate no-action tool requiring `projectId` and a non-blank `memory`. It accepts optional durable `category`, `confidence`, `durability`, `tags`, `appliesToPaths`, and `sourceMemoryId`; success creates the canonical claim and project-memory mirror and returns rich memory-widget data. The `manage_memory` matrix below remains the broader read, maintenance, evidence, and lifecycle surface.

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

## `custom_dashboards`

Project-scoped generated dashboards, immutable revisions, detached validation sessions, and publication state.

| Action | Destructive | Required payload | Description |
| --- | --- | --- | --- |
| `list` | – | `projectId` | List project custom dashboards. |
| `get` | – | `dashboardId` | Get one dashboard with revisions. |
| `create` | – | `projectId`, `title`, `manifest`, `fileBundle` | Create a mutable draft. Optional `description`, `sourceNodeGraph`, `styleguide`, and `runtimeMetadata`. |
| `update` | – | `dashboardId`, update fields | Update mutable draft fields without mutating existing revisions. |
| `create_revision` | – | `dashboardId` | Create an immutable revision from the draft or supplied bundle overrides. |
| `validate_revision` | – | `projectId`, `dashboardId`, `revisionId` | Start detached Docker validation for a revision. |
| `validation_status` | – | `sessionId` | Read validation session status and report metadata. |
| `validation_logs` | – | `sessionId`, optional `tail` | Read validation logs. |
| `publish_revision` | – | `dashboardId`, `revisionId`, optional `validationSessionId` | Publish only a passed revision with a valid report. |
| `archive` | ✅ | `dashboardId` | Clear active publication and mark the dashboard archived. |
| `data_catalog` | – | `projectId` | Return dashboard summaries and declared source nodes. |

Publication rejects failed, queued, running, cancelled, missing, or cross-revision validation sessions before the active publication pointer changes.

---

## `chat_providers`

External chat provider configuration and delivery-state inspection.

| Action | Destructive | Required payload | Description |
| --- | --- | --- | --- |
| `list_provider_definitions` | – | optional `providerKind` | List supported provider setup schemas, bridge modes, secret fields, and ingress URL guidance. |
| `list_connections` | – | optional `providerKind`, `enabledOnly` | List provider connections with redacted credential metadata and generated ingress URLs. |
| `get_connection` | – | `providerConnectionId` or `connectionId` | Get one provider connection. |
| `create_connection` | – | `providerKind`, `displayName`; optional `bridgeMode`, `status`, `enabled`, `setup`, `secrets` | Create a provider connection. Responses redact credentials. |
| `update_connection` | – | `providerConnectionId` or `connectionId`, update fields | Update connection metadata, setup, enabled state, or secrets. Replacing a non-empty `secrets` payload requires one-use approval. |
| `delete_connection` | ✅ | `providerConnectionId` or `connectionId` | Delete the provider connection and cascade bindings/delivery rows. |
| `list_channel_bindings` | – | optional `providerConnectionId`, `projectId`, `projectIds`, `externalChannelId`, `enabledOnly` | List channel/project bindings. Multiple projects can bind to the same external channel. |
| `create_channel_binding` | – | `providerConnectionId`, `externalChannelId`, `externalChannelName`, `projectId` | Bind an external channel to a project with optional routing hints and enablement flags. |
| `update_channel_binding` | – | `channelBindingId` or `bindingId`, update fields | Update channel metadata, routing hints, project, agent preset, and enablement flags. |
| `delete_channel_binding` | ✅ | `channelBindingId` or `bindingId` | Delete one channel/project binding. |
| `list_outbound_deliveries` | – | optional filters | Inspect outbound delivery rows by provider, channel, or delivery status. Does not send messages. |

Raw `secrets` are never returned by MCP responses or validation errors. `list_outbound_deliveries` is an inspection surface only; inbound routing and outbound sending are outside this management contract.

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
