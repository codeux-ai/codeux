# MCP Connections And Listen Mode

This page describes the first concrete multi-MCP control-plane slice shipped on top of the Sprint OS database.

It is no longer the final target architecture.

The corrected direction is documented in [Connection And Listener Foundation Reset](./connection-and-listener-foundation-reset.md).

## Scope

This implementation adds:
- DB-backed MCP connection records
- project-scoped conversation threads and messages
- v2 dashboard connection/chat pages wired to sqlite
- first listen-loop MCP tools for registering listeners, polling inbox work, and posting replies

It does not yet add:
- worker task pickup scheduling
- automatic task assignment across multiple MCPs
- persisted provider activity transcripts in `task_run_events`
- autonomous looping inside the server process itself

That limitation is now partly removed by the in-repo external worker client and worker gateway:

- workers can consume inbox messages on the same connection record
- workers can generate reply-only dashboard responses locally
- remote workers can now attach to the main Sprint OS control plane over Streamable HTTP

## Primary Files

- `src/repositories/connection-chat-repository.ts`
- `src/contracts/connection-chat-types.ts`
- `src/mcp/core-tool-handler.ts`
- `src/server/mcp-request-router.ts`
- `src/server/dashboard-server.ts`
- `dashboard/src/v2/lib/connection-api.ts`
- `dashboard/src/v2/AgentsPage.tsx`
- `dashboard/src/v2/ChatPage.tsx`

## Data Model Usage

Existing phase-1 tables are now active:
- `mcp_connections`
- `connection_project_bindings`
- `conversation_threads`
- `conversation_messages`

`capabilities_json` on `mcp_connections` is now used to persist lightweight connection metadata such as:
- `instruction`
- `model`
- `listenMode`

## Dashboard API Surface

New HTTP endpoints:
- `GET /api/projects/:projectId/connections`
- `PATCH /api/connections/:connectionId`
- `GET /api/projects/:projectId/conversations/threads`
- `POST /api/projects/:projectId/conversations/threads`
- `GET /api/conversations/threads/:threadId/messages`
- `POST /api/projects/:projectId/conversations/messages`

Behavior:
- live connection APIs list project-bound connections
- Chat page stores all messages in sqlite under the selected project
- dashboard-authored messages are queued as `dashboard_to_connection`
- listener replies are stored as `connection_to_dashboard`

## MCP Tool Surface

New tools:
- `listen`
- `start_listen`
- `pull_inbox`
- `post_listen_reply`

Current primary loop:
1. Connected MCP calls `listen`
2. Server registers or refreshes the connection and binds it to a project
3. The `listen` call blocks until one actionable item is available or timeout expires
4. MCP handles the returned event
5. MCP replies with `post_listen_reply` when the event is a dashboard message
6. MCP re-enters the loop by calling `listen` again

Low-level compatibility loop:
1. Connected MCP calls `start_listen`
2. Server registers or refreshes the connection and binds it to a project
3. MCP calls `pull_inbox` to fetch pending dashboard messages
4. MCP processes one or more messages
5. MCP calls `post_listen_reply` to write the response back into the dashboard thread
6. MCP re-enters the loop by calling `pull_inbox` again

The blocking long-poll `listen` contract is now the preferred listener UX for both stdio clients and workers. `start_listen` and `pull_inbox` remain as compatibility primitives while the rest of the system is migrated.

Current compact listen payloads:
- dashboard messages return only `message.id`, `message.threadId`, `message.projectId`, `message.bodyMarkdown`, plus continuation guidance
- worker assignment changes return `assignment`, `project`, `workingDirectoryHint`, and `contextDigest`
- worker attention items return `item`, `project`, `workingDirectoryHint`, and `contextDigest`
- timeout results return continuation guidance only
- `post_listen_reply` returns only `threadId` and `deliveryStatus`
- `claim_attention_item` returns only `itemId`, `status`, `assignedWorkerEndpointId`, and `claimedAt`
- `resolve_attention_item` returns only `itemId`, `status`, and `resolvedAt`
- `report_attention_outcome` returns the resolved source item id/status plus any created handoff thread and human attention item ids

`reply_to_message_id` should still be supplied when replying. `thread_id` alone is not always enough, because a thread can hold multiple delivered dashboard messages and the reply tool otherwise has to mark all pending/delivered dashboard messages on that thread as handled.

Workers now use the same listen loop in addition to dispatch polling, so a single connected worker can both answer chat and pick up `mcp_worker` tasks.

The in-repo worker runtime now also uses the supervision part of that loop actively:

- `assignment_changed` updates the worker's local project-supervision state
- `attention_item` causes the worker to auto-claim open worker-owned blockers
- after claim, the worker now reports a structured supervision outcome:
  - `needs_dashboard_reply` creates a worker-bound project thread with a system handoff message
  - `needs_human_escalation` does the same and also opens a human-owned escalation queue item
- subsequent `listen` calls send the worker's current active supervised project ids instead of staying fully static

The worker listener contract now also supports:

- `project_ids` to bind one connection to multiple projects
- `active_project_ids` to declare the subset currently being supervised
- `include_attention_items` to receive `assignment_changed` and `attention_item` events during the same listen loop
- `claim_attention_item` so a worker can explicitly take ownership of a blocker it starts handling
- `resolve_attention_item` so a worker can close or dismiss a blocker after handling it
- `report_attention_outcome` so a worker can hand supervision off to the operator side without leaving the original item claimed forever

Worker supervision assignment rules:

- entering `listen` as a worker now ensures project-supervision assignment for the worker's active project scope even before any task dispatch is claimed
- this makes worker-owned attention items, including merge-conflict escalations, deliverable to a listen-only connected worker
- worker `listen` registrations now default to full capabilities (`workerCanSuperviseProjects = true`, `workerCanExecuteTasks = true`); those capabilities only narrow when a client explicitly disables them
- repeated `listen` calls now preserve per-project attention and assignment cursors when the project scope is unchanged, so long-poll re-registration does not replay the same assignment event forever
- worker attention replay now advances in deterministic cursor order, so multiple open items created in the same second no longer allow one item to advance the cursor past its sibling and leave it undelivered
- worker assignment and attention routing now treat heartbeat-aged endpoints as effectively `stale` or `offline` even before the slower cleanup sweep rewrites stored status, so a dead primary worker cannot keep absorbing new merge-conflict items while a live overflow worker is listening
- when a preferred worker endpoint is stale or offline, attention assignment now falls back to the current live supervising worker instead of preserving the stale endpoint id

Operational behavior:

- the blocking call still polls sqlite-backed inbox and dispatch state internally
- the default internal poll cadence now targets `3000ms`, not `1000ms`
- idle listener heartbeat writes are throttled, so a waiting listener does not churn connection state every second
- worker long-poll now defaults to a shorter `30s` timeout with a `1000ms` poll interval, which keeps connected workers responsive without adding another client-side delay layer
- stale/offline connection cleanup is more aggressive now: heartbeat-derived status flips happen within roughly `90s`/`3m`, runtime cleanup runs every `15s`, and a cold server start prunes disconnected MCP connections with no active dispatches before the dashboard comes up

Transport notes:

- normal human-driven MCP clients continue to use stdio
- remote workers can now use the dedicated Streamable HTTP worker gateway on the main Sprint OS server
- local worker-host stdio still exists for worker-machine execution hooks

## Current Routing Rules

When a dashboard message is posted:
- if the thread already has a bound connection, the message stays with that connection
- otherwise the message remains queued and unassigned until a listener claims it or the dashboard explicitly targets a connection

When a dashboard thread is reassigned:
- the thread's `connection_id` is updated explicitly
- any unprocessed dashboard-authored messages on that thread are reset to `pending`
- the newly assigned listener can claim them on the next listen cycle

When a listener polls inbox:
- pending dashboard messages are returned for bound or unassigned project threads
- unassigned threads are claimed by the polling connection
- message delivery state moves from `pending` to `delivered`

When a listener replies:
- the reply is inserted into the same thread
- related pending/delivered dashboard messages are marked `processed`

When a worker escalates an attention item:
- Sprint OS creates a project thread bound to that worker connection
- Sprint OS inserts a `system` authored `connection_to_dashboard` message with the worker handoff summary
- the original worker-owned item resolves
- a human-owned handoff attention item is opened when follow-up is still required

## Why This Matters

This is the first real step toward multi-MCP support:
- connections are now first-class records
- dashboard chat is no longer mock-only
- listen mode has a concrete storage contract and tool loop
- future worker pickup can build on the same connection and conversation model instead of introducing another control plane

What still needs correction:

- the `Agents` product surface must be separated from live connections
- connection lifecycle is now heartbeat-derived for `stale` and `offline`, but background cleanup and archival still need to follow
- remote worker auth and lifecycle management still need to mature beyond the initial bearer-token gateway
