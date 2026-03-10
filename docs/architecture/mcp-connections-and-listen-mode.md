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

Workers now use the same listen loop in addition to dispatch polling, so a single connected worker can both answer chat and pick up `mcp_worker` tasks.

Operational behavior:

- the blocking call still polls sqlite-backed inbox and dispatch state internally
- the default internal poll cadence now targets `3000ms`, not `1000ms`
- idle listener heartbeat writes are throttled, so a waiting listener does not churn connection state every second

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
