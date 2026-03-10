# MCP Connections And Listen Mode

This page describes the first concrete multi-MCP control-plane slice shipped on top of the Sprint OS database.

## Scope

This implementation adds:
- DB-backed MCP connection records
- project-scoped conversation threads and messages
- v2 dashboard Agents and Chat pages wired to sqlite
- first listen-loop MCP tools for registering listeners, polling inbox work, and posting replies

It does not yet add:
- worker task pickup scheduling
- automatic task assignment across multiple MCPs
- persisted provider activity transcripts in `task_run_events`
- autonomous looping inside the server process itself

That limitation is now partly removed by the in-repo external worker client:

- workers can consume inbox messages on the same connection record
- workers can generate reply-only dashboard responses locally

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
- Agents page lists connections bound to the selected project, plus project-manager connections
- Chat page stores all messages in sqlite under the selected project
- dashboard-authored messages are queued as `dashboard_to_connection`
- listener replies are stored as `connection_to_dashboard`

## MCP Tool Surface

New tools:
- `start_listen`
- `pull_inbox`
- `post_listen_reply`

Expected loop:
1. Connected MCP calls `start_listen`
2. Server registers or refreshes the connection and binds it to a project
3. MCP calls `pull_inbox` to fetch pending dashboard messages
4. MCP processes one or more messages
5. MCP calls `post_listen_reply` to write the response back into the dashboard thread
6. MCP re-enters the loop by calling `pull_inbox` again

Because transport is stdio-based, this remains a pull loop by design.

Workers now use the same listen loop in addition to dispatch polling, so a single connected worker can both answer chat and pick up `mcp_worker` tasks.

## Current Routing Rules

When a dashboard message is posted:
- if the thread already has a bound connection, the message stays with that connection
- otherwise the repository prefers an active listening or connected connection for that project
- if no connection is available, the message remains queued until a listener binds and polls inbox

When a listener polls inbox:
- pending dashboard messages are returned for bound or unassigned project threads
- unassigned threads are claimed by the polling connection
- message delivery state moves from `pending` to `delivered`

When a listener replies:
- the reply is inserted into the same thread
- related pending/delivered dashboard messages are marked `processed`

## Runtime Registration

The local Sprint OS server now registers a real `project_manager` connection on startup.

That gives the dashboard a concrete connection record even before external listeners or workers connect.

## Why This Matters

This is the first real step toward multi-MCP support:
- connections are now first-class records
- dashboard chat is no longer mock-only
- listen mode has a concrete storage contract and tool loop
- future worker pickup can build on the same connection and conversation model instead of introducing another control plane
