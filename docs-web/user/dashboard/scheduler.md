# Scheduler

The **Scheduler** page (dock label **Schedule**, `/scheduler`) runs Code UX work on a timetable.
Schedule a sprint, a quicksprint template, a node flow, a project message, or memory remediation to fire once
or on a recurring cadence — useful for nightly maintenance sweeps, periodic audits, or recurring
planning prompts.

## Views

- **Calendar** — a month view of upcoming occurrences.
- **Day** — a focused list of what runs on a given day.

## Schedule targets

Each scheduler entry has a **target** — the thing that runs when it fires:

| Target | What it does |
| --- | --- |
| **Sprint** | Plans and auto-starts an existing sprint with no tasks, or directly orchestrates one that already has tasks. |
| **Quicksprint** | Spawns and runs a [quicksprint template](../quicksprints.md), substituting its variables. |
| **Node flow** | Runs a saved project [node flow](./node-flows.md) with optional JSON object input. |
| **Message** | Posts a project message (for example, a recurring planning or status prompt). |
| **Memory remediation** | Runs the long-term memory cleanup workflow on a schedule. |

Node-flow entries store `nodeFlowTarget = { flowId, input?, versionSelection }` inside the existing
target JSON payload, validate that the flow belongs to the selected project, and run through the
node-flow runtime with scheduler trigger metadata when due. Blank dashboard input is omitted, and
supplied input must be a JSON object.

Choose a pinned published version when every occurrence must execute the same immutable snapshot, or latest published when each occurrence should pick up the newest publication. A legacy `flowVersion` is treated as a pinned version and affects execution, not just audit metadata.

The backend scheduler contract also supports agent-created wakeups.
Agent wakeups are stored in the target JSON payload with `origin` and `source` set to
`agent_scheduler`, plus `createdByAgentId` when the creating agent provides it. Agent wakeups post
through the chat runtime with scheduler metadata.

Agent wakeups may appear in the Scheduler calendar, day view, stats, and scheduled
entry list after they are created by the secured MCP scheduler tool. They use their own target
labels and compact summaries instead of appearing as chat messages. The dashboard create/edit form
supports Sprint, Quicksprint, Node flow, Message, and Memory remediation entries; MCP-created agent
wakeups can still be paused, resumed, or deleted from the list.

Agent wakeups created through `scheduler_code_ux` can use one timing mode at a time:

- an absolute `scheduledFor` timestamp
- a positive `delaySeconds` or `delayMinutes` value
- `wakeAfterReply: true`, which wakes the agent immediately after its current dashboard reply is sent
- `afterSprintId`, with optional `offsetMinutes`, to wake after a sprint completes successfully
- `afterTaskId`, with optional `offsetMinutes`, to wake after a task reaches a terminal project status

When the call comes from a dashboard chat turn, an omitted, null, or blank `threadId` defaults to the
originating thread and that resolved target is stored with the scheduler entry. A non-empty `threadId`
explicitly overrides the default. Standalone MCP calls have no originating thread, so omitted or empty
targets remain threadless. Both contextual and explicit targets must belong to the selected project when
the wakeup is delivered.

Completion-anchored wakeups are one-time entries. A sprint anchor resolves only when its source
sprint reaches effective successful `completed` status; failed, cancelled, and otherwise non-completed
source sprints do not trigger it. The scheduler uses the latest successful sprint run finish time when
available, otherwise the completed sprint `endDate`, and then applies the configured offset. Task
anchors continue to use terminal task run or dispatch finish evidence before falling back to the
task update time.

When a scheduled sprint becomes due, the scheduler checks whether it already has tasks. A sprint
with no tasks is sent through planning with auto-start enabled, so it launches after planning
succeeds. A sprint with existing tasks is orchestrated directly. If either planning or direct
orchestration fails, the scheduler entry moves to `failed` and displays the recorded error in the
scheduled-entry list.

### Dashboard planning wakeups

Direct MCP planning started by the assigned Project Manager uses two non-recurring wakeup paths. The manager owns one status check at a time: first at the returned `estimatedCompletionAt`, then, only while status remains `in_progress`, at the next returned timestamp one minute later. It lists before scheduling to avoid duplicates and never turns planning checks into a recurring schedule. An elapsed ETA is not failure, so active planning is not resubmitted, requeued, or reconfigured.

Code UX owns the other path: exactly one due-now completion or failure `agent_wakeup` for the originating dashboard thread after background planning settles. That terminal wakeup reports generated task count and actual auto-start state, or the failure evidence. When it arrives, the Project Manager cancels obsolete pending status checks it created for the same invocation or sprint, excluding the wakeup currently executing. This avoids a later ETA wakeup creating a duplicate dashboard turn.

Standalone MCP calls have no originating dashboard thread, so they receive neither wakeup path. Those clients poll sprint, task, or telemetry state at the returned `nextCheckAt`; reads do not enqueue scheduler work.

## Recurrence

An entry can run once at a specific time or repeat on a **recurrence rule** (for example daily or
weekly). The page previews the next occurrences so you can confirm the cadence before saving.

For node-flow schedules, recurrence uses the same model as other targets. Due runs call the node-flow
runtime with `triggerType = "scheduler"` and trigger metadata containing the scheduler entry id,
scheduled occurrence time, target type, and stored flow version when present. The due occurrence is
claimed in SQLite before the runtime is awaited so a restart does not dispatch the same occurrence
again. Node-flow schedules are then finalized from the returned run status: `succeeded` advances or
completes the schedule, while returned `failed` or `cancelled` runs move the entry to `failed`,
record the attempted occurrence, and show the run error in the list.

## Managing entries

From the page you can:

- **Create** an entry — pick a target, set the time, and choose a recurrence rule.
- **Edit** a dashboard-created entry's target, time, or recurrence.
- **Pause / resume** an entry without deleting it.
- **Delete** an entry.

Scheduler changes broadcast over the dashboard's realtime channel, so the calendar stays in sync
across open clients. Scheduled runs appear in the [Live Session](./live-session.md) and
[Stats](./stats.md) views just like manually started work.
