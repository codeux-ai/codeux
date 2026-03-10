# Connection And Listener Foundation Reset

## Status
Accepted corrective implementation plan

## Why This Reset Exists

The current DB-native runtime foundation is the right direction, but the first multi-connection slice mixed together several concepts that need to be separated before more features land:

- `Agents` were incorrectly presented as live connections
- a synthetic local `project_manager` connection was shown in user-facing flows
- dashboard chat routing was too implicit
- connection lifecycle was not heartbeat-driven
- the current listen tools return immediately instead of supporting a real listening loop
- the in-repo worker client proved the dispatch contract, but it is not the final remote-worker transport model

This document defines the corrected architecture that Sprint OS should now implement.

## Product Model Separation

Sprint OS must treat these as different first-class concepts.

### 1. Agent presets

Agents are not live processes.

Agents are reusable role presets that define:

- name
- instruction markdown
- default labels or tags
- preferred executor traits later
- optional planning hints later

They are product configuration. They do not represent active MCP clients, workers, or transports.

The `Agents` page must be reserved for these presets only.

### 2. Live connections

Connections are active MCP clients attached to Sprint OS.

Examples:

- Gemini CLI over stdio
- Codex over stdio
- future remote listener over Streamable HTTP
- future remote worker daemon over Streamable HTTP

Connections are runtime entities with:

- transport metadata
- heartbeat state
- active project scope
- claimed chat threads
- claimed task dispatches

Connections belong in runtime or live operations views, not the `Agents` page.

### 3. Workers

Workers are a subset of live connections.

A worker:

- can listen for dashboard messages
- can claim `mcp_worker` task dispatches
- can run on the same machine or a different machine
- must be transport-agnostic from the DB/runtime model's point of view

Workers are not agent presets, and agent presets are not workers.

## Non-Negotiable Behavior Goals

### 1. Zero-setup stdio chat must work

When a user starts Gemini CLI, Codex, or another normal stdio MCP client, Sprint OS must support dashboard chat without requiring a separate worker process or any special local bootstrap flow.

The required user experience is:

1. user connects a normal MCP client
2. user can place that client into Sprint OS listening mode
3. dashboard messages appear in that client as work items
4. the client replies
5. the client re-enters listening mode

This flow must work for normal stdio MCP clients and for workers.

### 2. Listening cannot be an instant-return poll only

Returning immediately with:

- an empty inbox
- a generic status
- or a large unfiltered list of tasks

is the wrong interaction model for normal MCP clients.

The listener must support a blocking long-poll mode:

- hold the tool call open until work is available or timeout expires
- return exactly the next actionable item
- instruct the model to handle the item and call the listener again

This avoids the "nothing here, I am done" failure mode in Gemini CLI and Codex style sessions.

### 3. Workers must use the same listener model

Workers that participate in inbox chat must use the same long-poll listener semantics.

Otherwise workers will suffer the same breakage as normal stdio MCP clients:

- instant-return tool calls
- no sustained listening loop
- stale connection state

### 4. Remote workers are required

Workers that only work by spawning a second local Sprint OS server process are not the final design.

Sprint OS must keep stdio support for normal local MCP clients, but it must stop being stdio-only.

The target transport model is:

- stdio for local human-driven MCP clients
- Streamable HTTP MCP for remote long-lived listeners and workers

## Correct Listener Model

## Core design

The current `start_listen` + `pull_inbox` split is useful as an internal primitive, but it is not the final user-facing listening contract.

The target contract is a long-poll listener command that:

1. registers or refreshes the connection
2. binds project scope
3. heartbeats the connection
4. blocks until one actionable item is available or timeout is reached
5. returns one typed event payload
6. explicitly instructs the model to handle it and then call the listener again

This can be shipped as:

- a new top-level `listen` tool
- or a compatibility wrapper built on top of `start_listen` and `pull_inbox`

The important part is the behavior, not the exact final tool name.

## Listener event contract

The listener should return exactly one event at a time.

Event kinds should support at least:

- `dashboard_message`
- `task_dispatch`
- `thread_reassigned`
- `connection_timeout`
- `noop_timeout`

`dashboard_message` should include:

- `thread_id`
- `message_id`
- `project_id`
- `thread_title`
- `body_markdown`
- optional assigned connection metadata
- explicit next-step instructions for the model

`task_dispatch` should include:

- `dispatch_id`
- `task_id`
- `project_id`
- `sprint_id`
- task title and execution summary
- executor expectations
- explicit next-step instructions for the model or worker

`noop_timeout` should be a real, valid result, not an error.

It should tell the model:

- no work arrived during the current window
- immediately call the listener again if it should remain in listening mode

## Listener loop instructions

The returned payload must always contain machine-readable and model-readable continuation guidance.

Every successful listener result should tell the MCP client to do one of these:

- answer in the dashboard thread and then call `listen` again
- claim and execute the dispatch, then call `listen` again
- no work arrived before timeout; call `listen` again to stay available

That instruction is required because tools like Gemini CLI and Codex otherwise tend to conclude their task after a single empty result.

## Timeout model

Sprint OS already has an operator-facing concept of forced periodic output in the legacy sprint loop. The listener model should reuse that operational idea instead of inventing a separate ad hoc behavior.

Target rules:

- listener calls are blocking long-polls
- they return immediately when work arrives
- they return `noop_timeout` when the configured timeout expires
- they never wait forever

Recommended configuration:

- new setting: `listenLoopOutputIntervalSeconds`
- default: `300`
- minimum: `15`
- maximum: `3600`

Tool arguments may optionally allow a smaller per-call timeout for clients with stricter transport behavior, but the server-side setting remains the main operational default.

If transport-specific limits are discovered later, Sprint OS may clamp requested values per transport, but the product contract remains long-poll plus timeout, not instant polling.

## Thread assignment and routing

### Required routing rules

When the dashboard creates a thread:

- it is unassigned by default
- unless the user explicitly targets a connection

When the dashboard posts a message:

- it stays on the assigned thread if the thread is already claimed
- otherwise it remains unassigned and pending

When a listener receives work:

- it may claim an unassigned thread
- the claim must be persisted
- later replies from that listener remain attached to the same thread unless reassigned

### Explicit routing support

The dashboard must support:

- choosing a target connection when starting a thread
- seeing whether a thread is unassigned or assigned
- reassigning a thread to another connection later

Synthetic or internal runtime records must never be automatic routing targets.

## Connection lifecycle

Connections must be ephemeral runtime records, not permanent truth.

### Connection states

The state model should support:

- `connected`
- `listening`
- `busy`
- `paused`
- `stale`
- `offline`

### State derivation

Connection state should be derived primarily from:

- `last_heartbeat_at`
- active claimed dispatches
- active long-poll listener wait
- explicit pause or disconnect actions

### Cleanup rules

Sprint OS should run a cleanup pass that:

- marks expired connections as `stale`
- later marks them `offline`
- releases abandoned listener waits
- expires stale claims safely
- optionally archives or deletes very old dead connection rows

This prevents zombie workers and zombie listeners from appearing permanently connected in the dashboard.

## Agents Page Correction

The current `Agents` page implementation is not aligned with the product model.

It must be refactored to show agent presets only.

Immediate correction:

- stop treating live MCP connections as agents
- remove connection management language from the `Agents` page
- move live connections to a later dedicated runtime or live operations view

Phase-1 scope for agents should remain simple:

- preset CRUD
- name
- instructions
- optional labels

Task auto-assignment and worker matching can come later.

## Transport Strategy

## Keep stdio, but stop being stdio-only

Sprint OS should keep stdio support because it is essential for:

- Gemini CLI
- Codex
- other local MCP clients

But Sprint OS must add a network transport for remote listeners and workers.

Recommended target:

- MCP Streamable HTTP

## Remote worker model

The final worker architecture should be:

1. worker daemon starts on any machine
2. worker connects to Sprint OS over Streamable HTTP MCP
3. worker authenticates with a worker token
4. worker registers capabilities and project scope
5. worker enters the same long-poll listener loop
6. worker claims dispatches through the same DB-native dispatch model
7. worker heartbeats and closes work back into the same DB records

The current in-repo worker-host mode can remain temporarily as a contract-proving development tool, but it should be treated as transitional.

## Corrected Tool Direction

### Normal local MCP clients

Normal local MCP clients should see:

- orchestration tools
- session tools
- the listener tool surface

They should not need worker setup to participate in dashboard chat.

### Worker clients

Worker-capable clients should see:

- the listener tool surface
- dispatch-claim and dispatch-update tools
- task execution tools if that worker runtime supports them

### Important principle

Listening is not worker-specific.

Listening is a shared connection capability used by:

- normal stdio MCP clients
- local worker runtimes
- remote worker runtimes

## Immediate Corrective Implementation Order

### Phase A: fix the misleading model

1. remove the synthetic local `project_manager` connection from user-facing flows
2. stop auto-binding new threads to guessed connections
3. default new dashboard threads to unassigned
4. let listeners claim unassigned threads cleanly
5. stop presenting live connections on the `Agents` page

### Phase B: implement real listener semantics

1. add a blocking long-poll listener tool contract
2. return one actionable event at a time
3. add explicit continuation instructions in the result payload
4. add configurable listener timeout using dashboard settings
5. make both stdio clients and workers use the same listener loop

### Phase C: fix lifecycle and routing

1. derive connection status from heartbeat and active work
2. add stale or offline transition logic
3. add cleanup for dead connections and expired claims
4. add explicit dashboard thread assignment and reassignment controls
5. show unassigned vs assigned state clearly in chat UI

Current status:

- heartbeat-derived `stale` and `offline` lifecycle is now implemented in the connection repository read model
- dashboard thread assignment and reassignment controls are now implemented
- reassignment now re-queues unprocessed dashboard messages for the new listener
- background cleanup and archival of long-dead connections is still pending

### Phase D: correct the product surfaces

1. rebuild `Agents` as preset CRUD only
2. move runtime connections into a later dedicated live operations surface
3. keep chat centered on thread routing, not connection editing

### Phase E: add remote transport

1. add Streamable HTTP MCP transport
2. add remote worker authentication
3. replace the current worker-host local-only architecture with a remote-capable worker daemon flow
4. keep stdio support for local MCP clients

## Definition Of Done For This Corrective Track

Sprint OS is on the right foundation when all of these are true:

1. A normal Gemini CLI or Codex MCP connection can enter listening mode and receive dashboard chat work without any worker setup.
2. The listener call blocks until work is available or timeout expires.
3. On timeout, the result tells the model to immediately call the listener again if it should remain available.
4. Dashboard chat threads start unassigned unless explicitly targeted.
5. Real listeners can claim unassigned threads.
6. No synthetic placeholder connection appears as a user-facing live agent.
7. The `Agents` page represents presets only.
8. Connection status is heartbeat-driven and stale connections disappear from active views.
9. Workers can use the same listener contract as normal MCP clients.
10. The worker architecture has a clear path to remote multi-machine operation.

## What We Keep From The Existing Refactor

These parts remain correct and should stay:

- DB-backed `projects`, `sprints`, and `tasks`
- DB-backed `sprint_runs`, `task_dispatches`, `task_runs`, and runtime events
- DB-backed conversation threads and messages
- task executor abstraction
- project-scoped runtime projections
- runtime-role tool gating as a supporting mechanism

The reset is about correcting the connection and listener model, not discarding the DB-native runtime foundation.
