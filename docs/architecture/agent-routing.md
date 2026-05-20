# Agent Routing

## Status
Implemented

## Purpose

Agent routing lets a project choose which agent preset supplies execution instructions for coding and repair work.

This sits above provider routing:

- provider routing chooses the runtime/provider instance
- agent routing chooses the instruction preset used by that runtime

## Data Model

Agent presets now include:

- `description`

This short description is stored in `agent_presets.description` and mirrored in agent markdown JSON frontmatter as `description`. It is intentionally compact because the Planning agent receives these descriptions when orchestrator routing is enabled.

Tasks now include:

- `agent_preset_id`

Planning can persist a task-level coding-agent assignment there.

## Settings

Project settings store agent routing under:

- `agents.routing`

Routes:

- `planning.agentPresetId`: default agent used by sprint planning and prompt improvement
- `taskCoding`
  - `mode`: `MANUAL` or `ORCHESTRATOR`
  - `agentPresetId`: fixed coding agent for manual mode
  - `orchestratorAgentPresetIds`: coding agents exposed to the Planning agent
- `ciFix.agentPresetId`
- `mergeConflict.agentPresetId`
- `dashboardReply.agentPresetId`
- `clarificationReply.agentPresetId`

Unset manual routes fall back to the existing built-in preset for that route. Planning uses `Planning agent`; coding, CI fix, merge conflict, and dashboard replies use `Worker`; clarification replies use `Project manager`.

## Planning Flow

When `agents.routing.taskCoding.mode` is `ORCHESTRATOR`, Code UX:

1. Loads the selected project agent presets from `orchestratorAgentPresetIds`.
2. Adds a `Coding Agent Routing` roster to the Planning prompt with each agent ID, name, and short description.
3. Requires planned tasks to use an allowed `agentPresetId` when assigning a specialist.
4. Persists the selected `agentPresetId` on each created task.

Manual coding routing omits the roster. When a specific manual worker preset is configured or selected as a sprint override, Code UX writes that preset ID onto each planned task that does not already have a task-level assignment.

## Execution Flow

Task coding resolves agent instructions in this order:

1. task-level `agentPresetId` from orchestrator planning
2. manual `agents.routing.taskCoding.agentPresetId`
3. built-in `Worker` agent preset

Jules and CLI task execution both use the resolved agent instructions. CLI memory tagging also uses the resolved coding agent so learnings are associated with the specialist that actually ran the task.

Virtual CI-fix and merge-conflict workers use their dedicated manual agent route and fall back to `Worker` when unset.

## Dashboard

`Settings -> Agents` includes an `Agent Routing` card modeled after the provider routing surface:

- planning can choose a default planning agent preset
- coding tasks can switch between Manual and Orchestrator
- orchestrator mode exposes a selectable project-agent roster
- CI fix, merge conflict, dashboard reply, and clarification reply routes each select one agent

The sprint composer defaults to the effective project planning agent and task-coding routing mode. It can override coding routing for one sprint with a Manual/Orchestrator select. In Manual mode, the composer shows a Worker Agent select that can pin that sprint's generated tasks to a specific worker preset; leaving it on the built-in worker keeps the project fallback behavior.

The Agents page shows route assignment tags on each preset card and in the detail panel. These tags are computed from the current effective project settings, so they reflect planning defaults, manual routes, the coding orchestrator roster, and enabled QA routes instead of user-authored labels. Built-in route selections are shown on the synced fallback presets as well: Planning agent for planning; Worker for coding, CI fix, merge conflict, and dashboard reply; Project manager for clarification reply; and Quality assurance agent for QA routes.

The Agents editor includes a short description field for every preset. That field is the Planning agent's primary signal when choosing among frontend, backend, prototype, or other custom coding specialists. Custom label editing is intentionally not exposed in the dashboard; labels remain internal metadata for markdown sync and built-in convention handling.
