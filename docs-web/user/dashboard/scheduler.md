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
| **Sprint** | Starts an existing sprint in the project. |
| **Quicksprint** | Spawns and runs a [quicksprint template](../quicksprints.md), substituting its variables. |
| **Node flow** | Runs a saved project [node flow](./node-flows.md) with optional JSON object input. |
| **Message** | Posts a project message (for example, a recurring planning or status prompt). |
| **Memory remediation** | Runs the long-term memory cleanup workflow on a schedule. |

Node-flow entries store `nodeFlowTarget = { flowId, input?, flowVersion? }` inside the existing
target JSON payload, validate that the flow belongs to the selected project, and run through the
node-flow runtime with scheduler trigger metadata when due. Blank dashboard input is omitted, and
supplied input must be a JSON object.

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
- `afterSprintId`, with optional `offsetMinutes`, to wake after a sprint reaches a terminal state
- `afterTaskId`, with optional `offsetMinutes`, to wake after a task reaches a terminal project status

Completion-anchored wakeups are one-time entries. Sprint anchors use the terminal sprint run finish
time when available, and task anchors use terminal task run or dispatch finish evidence before
falling back to the task update time.

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
