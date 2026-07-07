# Scheduler

The Scheduler page provides project-scoped automation for future sprint starts, quicksprint launches, scheduled node-flow runs, timed chat-agent messages, and long-term memory remediation. The backend contract also supports agent-created wakeups and scheduled task reruns for agent-facing surfaces that are not exposed in the dashboard form yet.

## Dashboard Behavior

The route is available at:
- `/scheduler`

The page has two schedule surfaces:
- `Calendar` shows recurring entries on every visible day, not only on the original entry date.
- `24 Hours` shows the selected day as an hour-by-hour timeline.

The `Calendar` / `24 Hours` switcher is implemented as a two-tab control. It exposes the active surface with `aria-selected`, points both tabs at the scheduler view panel with `aria-controls`, and supports arrow, Home, and End keyboard movement. During refresh, the view panel keeps cached schedule entries and occurrences visible, marks the panel busy, and announces that cached data is being shown while the latest schedule loads.

Operators can create entries for:
- Sprints whose status is not `completed`.
- Built-in or custom quicksprint templates available to the selected project.
- Saved node flows owned by the selected project, with optional JSON object input.
- Messages sent into `/chat` at the selected date and time.
- Long-term memory remediation, either deterministic or AI-routed through the Remediation route.

The runtime contract additionally accepts:
- `agent_wakeup` targets, which post a scheduled wakeup message back into a chat thread with `bodyMarkdown`, optional `threadId`, optional `connectionId`, optional `title`, and agent-scheduler metadata.
- `task` targets, which rerun an existing task by `taskId` and optional `provider`.

Those agent-created target types are intentionally backend-only in this task. They provide the storage and execution model that later MCP security and dashboard notification surfaces can consume without changing the dashboard target picker.

When `agent_wakeup` or `task` entries are created by the secured MCP scheduler tool, the Scheduler page can display them in the calendar, 24-hour view, stats, and scheduled-entry list. They use their own concise target labels, chips, and summaries, for example an agent wakeup thread or task rerun ID, instead of falling back to chat labels.

The dashboard form supports operator-created sprint, quicksprint, node-flow, chat, and memory remediation targets. Node-flow entries select a saved project flow and may include optional JSON input; blank input is omitted from the scheduler payload, and invalid JSON is rejected before submission. MCP-created `agent_wakeup` and `task` entries cannot be safely edited in that form, so their Edit action explains that dashboard editing is unavailable while Pause, Resume, and Delete remain available.

The Sprint Composer also exposes a `Schedule` execution mode. That path saves the sprint definition first, including the sprint key override, name, goal, original prompt, planning route/model overrides, agent preset selections, linked issues, and imported tasks, then creates a scheduler entry targeting the saved sprint. It does not call planning or execution immediately.

The Quicksprint configure view exposes the same scheduler timing model. Scheduling a quicksprint serializes the selected template, subtask count, `No limit` state, additional prompt, planning route/model override, and scheduled submit mode into `quicksprintTarget`, then creates a scheduler entry without launching the quicksprint immediately.

Sprint and quicksprint entries support two dashboard timing modes:
- **Absolute date/time** keeps the existing date-time picker, quick presets, timezone capture, and recurrence controls. This is the only timing mode available for chat and memory remediation entries.
- **After another sprint ends** stores the shared `scheduleAnchor = { mode: "after_sprint_end", sourceSprintId, offsetMinutes? }` payload. Operators choose a source sprint from the project sprint list and may add a non-negative offset in minutes. These entries are one-time only, so the dashboard disables recurrence and explains that a sprint cannot be anchored to its own completion.

Anchored entries in the scheduled-entry list are summarized as relative timing, for example `After Release Prep ends + 15 minutes`, instead of showing a misleading fixed `Next run` time while the scheduler is still waiting for the source sprint to finish.

The Memory settings panel can also manage one project-scoped long-term remediation entry. That entry is marked with `memoryRemediationTarget.source = "memory_settings"` so the settings shortcut does not overwrite manually created Scheduler page remediation entries.

Scheduler target selectors, recurrence indicators, and repeating-count summary icons use the dashboard signal jade palette for interactive accents. Sprint and next-run status tones remain differentiated with their existing ember/status colors.

Target-type choices in the add/edit form are pressed controls. The selected target is exposed through `aria-pressed` and a polite selected-target announcement so operators can confirm mode changes without relying on color alone.

Repeating entries support:
- no recurrence
- minutely, hourly, daily, weekly, or monthly recurrence
- endless recurrence
- a fixed number of iterations
- an explicit end date/time

Minute-based entries use the `minutely` recurrence literal in the API and MCP payloads. In the dashboard form, that same option is labeled `Minutes`, and the recurrence summaries reuse the same formatter as other schedules: `Every minute`, `Every 15 minutes`, `Every 15 minutes, 5 runs`, or `Every 15 minutes until <date>` depending on the configured interval and end mode.

Minutely entries are not special-cased at runtime. They are persisted in the same recurrence JSON as other schedules, expanded into calendar occurrences with the same UTC recurrence helpers, and when due they advance `nextRunAt` by the configured minute interval before executing through the existing scheduler workflow. The scheduler service keeps the same execution path for minute, hourly, daily, weekly, and monthly entries, so the cadence only changes the recurrence math, not the runtime target handling. The separate memory-remediation cadence keeps its own off/daily/weekly controls.

## Backend Contract

Scheduler state is persisted in SQLite in `scheduler_entries`.

Entries support two scheduling modes:
- **Absolute time**: the default path. `scheduledFor` is required on create, `nextRunAt` is populated from that timestamp, and recurrence expansion keeps using the existing UTC recurrence helpers.
- **After sprint end**: set `scheduleAnchor = { mode: "after_sprint_end", sourceSprintId, offsetMinutes? }`. The source sprint must exist in the same project. `offsetMinutes` is optional, defaults to `0`, and must be non-negative.

Composer and quicksprint shortcut scheduling both use this same contract. Absolute shortcut submissions send `scheduledFor`; after-sprint-end shortcut submissions send `scheduleAnchor`.

Anchors and target-specific payloads are persisted inside the existing `target_json` payload instead of new columns. This keeps existing `scheduler_entries` rows compatible and avoids a destructive migration; older absolute entries simply hydrate with no `scheduleAnchor`.

The target payload keys are:
- `sprintTarget`: `{ sprintId }`
- `quicksprintTarget`: `{ templateId, taskCount, noTaskLimit?, submitMode, additionalPrompt?, agentPresetId?, planningOverrides? }`
- `chatTarget`: `{ bodyMarkdown, threadId?, title?, connectionId? }`
- `memoryRemediationTarget`: `{ mode, source? }`
- `taskTarget`: `{ taskId, provider?, origin: "agent_scheduler", source: "agent_scheduler", createdByAgentId? }`
- `nodeFlowTarget`: `{ flowId, input?, flowVersion? }`
- `agentWakeupTarget`: `{ bodyMarkdown, threadId?, title?, connectionId?, origin: "agent_scheduler", source: "agent_scheduler", createdByAgentId? }`

`node_flow` entries keep their flow id and optional input in `target_json`; ownership is checked when entries are created or updated and again before due-run execution. `agent_wakeup` and `task` entries always normalize `origin` and `source` to `agent_scheduler` in `target_json`. When the creator supplies `createdByAgentId`, it is preserved with the target payload for later authorization, audit, and notification work. Existing sprint, quicksprint, chat, memory remediation, recurrence, pause/resume, and `after_sprint_end` anchor rows continue to hydrate from the same JSON payload without a schema migration.

The shared TypeScript contract lives in:
- `src/contracts/scheduler-types.ts`

The persistence and runtime layers live in:
- `src/repositories/scheduler-repository.ts`
- `src/services/scheduler-service.ts`
- `src/domain/scheduler/schedule-time.ts`

The dashboard API routes are:
- `GET /api/projects/:projectId/scheduler?from=<iso>&to=<iso>`
  - Returns persisted entries and expanded occurrences for the requested window. Anchored entries stay in `entries` but do not appear in `occurrences` until the source sprint reaches a terminal state; once resolved, the occurrence starts at the terminal sprint timestamp plus any configured offset.
- `POST /api/projects/:projectId/scheduler`
  - Creates a scheduler entry.
  - Absolute entries use `scheduledFor`; anchored entries use `scheduleAnchor`.
- `PATCH /api/scheduler/:entryId`
  - Updates status, timing, recurrence, or target payload.
  - Updating `scheduleAnchor` switches an entry to anchored semantics. Setting it to `null` returns the entry to absolute-time semantics with `scheduledFor`.
- `DELETE /api/scheduler/:entryId`
  - Deletes an entry. (Note: using the `manage_scheduler` MCP tool requires `approval: { confirmed: true }`).
- `GET /api/projects/:projectId/scheduler/memory-remediation`
  - Returns the settings-managed long-term memory remediation entry, if one exists.
- `PUT /api/projects/:projectId/scheduler/memory-remediation`
  - Creates, updates, or pauses the settings-managed long-term memory remediation entry.
- `POST /api/scheduler/run-due`
  - Processes due scheduler entries manually. Accepts an optional `now` ISO override for operational verification.

## Runtime Execution

`SchedulerService` starts with the dashboard runtime and checks due entries on an interval.

### Pause and Resume Behavior

The scheduler supports gating automation through status changes:
- **Pause**: Setting an entry to `paused` disables automated scheduled executions. It does not delete the entry or its history.
- **Resume**: Changing an entry from `paused` to `scheduled` reactivates future automation. 
  - To prevent immediate "catch-up" executions of missed runs, resuming recomputes `nextRunAt` to the first future occurrence.
  - Resuming or pausing does not directly trigger the scheduled target; the target only executes when the recomputed due time arrives.

### Editing Scheduled Entries

Operators can modify existing scheduler entries without deleting and recreating them:
- **Hydration**: Clicking the **Edit** action next to a scheduled entry or any of its occurrences will populate the scheduler form with its current title, target type, target-specific values (sprint ID, template ID, task count, node-flow ID and JSON input, or chat message body), date/time, and recurrence settings.
- **Title Customization**: A customizable **Title** field is available. If left empty during creation or edit, a descriptive title will be automatically generated (e.g., `Run Morning Check`).
- **Target Validation**: All target-specific validation rules apply when editing (e.g., sprint selection must be a non-completed sprint, chat message cannot be empty).
- **Save and Cancel**: Submitting in edit mode sends a `PATCH` request to update the entry without triggering it immediately. The edit mode can be cancelled at any time to return to creation mode without mutating the entry.

Agent-created `agent_wakeup` and `task` entries are display-only in the dashboard form. Operators can still pause, resume, or delete those entries from the scheduled-entry list, but editing their payload remains with the secured MCP scheduler flow so required target fields and agent-scheduler metadata are preserved.

### Due Entry Execution

Due entries execute through existing production paths:
- sprint entries call `ExecutionControlService.orchestrateSprint`
- quicksprint entries call `QuicksprintService.executeQuicksprint`
- chat entries call `ChatThreadRuntimeService.postMessage`
- memory remediation entries call `MemoryRemediationService.remediateLongTermMemories`
- node flow entries call `NodeFlowRuntimeService.runFlow` with `triggerType = "scheduler"` and trigger payload metadata containing the scheduler entry id, scheduled occurrence time, target type, and persisted flow version when present
- agent wakeup entries call `ChatThreadRuntimeService.postMessage` with `metadata.source = "agent_scheduler"`, `metadata.origin = "agent_scheduler"`, `metadata.schedulerEntryId`, and `metadata.createdByAgentId` when present
- task entries call `TaskRerunService.rerunTask`, passing the stored provider override when one was scheduled

AI memory remediation entries create a `remediation` invocation record even when no cleanup candidates are found; in that case the invocation is completed with a skipped reason instead of dispatching an empty provider request.

After a successful run, the service advances `nextRunAt` from the scheduled occurrence time. One-time entries move to `completed`; recurring entries stay `scheduled` until their count or end date/time is exhausted. Failed entries move to `failed` with `lastError` for operator visibility. Node-flow entries advance only after `runFlow` returns, so a runtime startup failure does not mark the schedule succeeded.

Anchored entries are evaluated separately from absolute `nextRunAt` polling:
- An `after_sprint_end` entry is due only after the source sprint reaches `completed`, `failed`, or `cancelled`.
- The anchor timestamp is the latest terminal sprint run `finishedAt` when a terminal run exists; otherwise the scheduler falls back to the sprint `endDate`.
- The optional offset is applied after that terminal timestamp.
- Anchored entries are one-time entries. Recurrence is rejected for `after_sprint_end` because repeated execution would be ambiguous without a new recurrence anchor model.
- When the scheduled target is also a sprint, the target sprint cannot be the same sprint used as the source anchor.
- Project isolation is strict: source sprints from another project are rejected, sprint targets must belong to the selected project, task targets must reference a task in the selected project, and node-flow targets must reference a flow in the selected project.
- Agent wakeups require non-empty `bodyMarkdown`.

The MCP `manage_scheduler` tool accepts the same model. Use `scheduleMode: "after_sprint_end"` or `anchorMode: "after_sprint_end"` with `sourceSprintId`/`anchorSourceSprintId` and optional `offsetMinutes`/`anchorOffsetMinutes`, or pass the nested `scheduleAnchor` object directly. Absolute schedules continue to use `scheduledFor`; `scheduleMode: "absolute"` on update clears an existing anchor. Node flows can be scheduled with `schedule_node_flow` or generic `create` plus `targetType: "node_flow"`, using flattened `flowId`/`input` fields or nested `nodeFlowTarget`.
