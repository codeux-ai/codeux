# External MCP Worker Client

This page documents the in-repo worker process shipped with Code UX.

The worker is now remote-capable at the control-plane layer through the Streamable HTTP worker gateway documented in [Streamable HTTP Worker Gateway](./streamable-http-worker-gateway.md).

It is still not the final end-state worker architecture. The broader target is documented in [Connection And Listener Foundation Reset](./connection-and-listener-foundation-reset.md).

## Purpose

The worker is not an embedded executor inside the dashboard server.

It is a separate process:

1. starts a headless Code UX server in `worker-host` mode over stdio on the worker machine
2. connects to that local worker-host with the MCP client SDK
3. optionally connects to the main Code UX server over Streamable HTTP for the remote control plane
4. registers itself as `role = worker`
5. claims queued `mcp_worker` dispatches from the main Code UX control plane
6. executes the claimed task through the existing provider stack on the worker machine
7. polls dashboard inbox threads on the same connection
8. generates reply-only chat responses through the local provider stack
9. heartbeats and finalizes dispatches back into the main Code UX database

That gives us a real worker contract without introducing a second execution model.

## Why Worker-Host Mode Still Exists

Code UX no longer relies on stdio-only transport for worker control-plane traffic.

However, workers still need a local execution runtime on the worker machine so they can:

- run local CLI providers
- use local Docker/worktree behavior
- access local repo state
- generate reply-only dashboard content with local provider context

For that reason, each worker process still starts a local Code UX server process and talks to it over stdio for execution hooks.

To make that safe, the spawned server now supports:

- `--runtime-role worker-host`
- implicit dashboard disable in worker-host mode
- worker-only MCP surface exposure in worker-host mode

This local worker-host runtime is now a helper for local execution, not the main remote control-plane transport.

## Worker Command

The new CLI is:

- `code-ux-worker`

Default behavior:

- spawns `node dist/index.js --runtime-role worker-host`
- enters the blocking `listen` loop for dashboard messages and queued dispatches
- polls the claimed session for progress and terminal state
- generates dashboard replies through `generate_dashboard_reply`
- posts replies through `post_listen_reply`
- calls `cancel_local_dispatch` when `update_task_dispatch` returns `controlAction = "cancel"`

Useful flags:

- `--connection-key`
- `--display-name`
- `--project-id`
- `--sprint-id`
- `--server-url`
- `--auth-token`
- `--dispatch-poll-interval-ms`
- `--session-poll-interval-ms`
- `--server-command`
- `--server-arg`
- `--server-cwd`

Use `--server-url` to connect the worker control plane to the main Code UX Streamable HTTP gateway. Without it, the worker falls back to local-only control-plane behavior.

## Execution Path

The worker does not reconstruct tasks from markdown.

For each claimed dispatch:

1. the main Code UX control plane returns a `task_dispatch` event through `listen`
2. the worker executes the dispatch locally through `execute_worker_dispatch` on its worker-host runtime
3. Code UX starts the existing provider flow through `TaskService.startSprintTask(...)`
4. CLI providers keep using the existing Docker/worktree/CI path
5. Jules providers keep using the existing Jules session path
6. the worker polls local execution progress with `get_session`
7. the worker writes `RUNNING`, `COMPLETED`, `FAILED`, or `BLOCKED` back to the remote control plane through `update_task_dispatch`

This means connected workers are now another executor lane on top of the same runtime records, not a side system.

## Inbox Reply Path

The same worker connection can also participate in project chat.

For each inbox message:

1. `listen` on the control plane returns the pending dashboard message
2. `generate_dashboard_reply` on the local worker-host resolves the project repo and settings
3. Code UX selects a CLI-capable provider and builds a reply-only prompt
4. the worker-host process generates markdown text locally
5. `post_listen_reply` on the control plane stores the reply under the same connection record

This keeps worker chat participation on the same DB-backed connection and thread model already used by the v2 dashboard.

The final architecture should move workers onto the same blocking long-poll listener model planned for all MCP connections.

## Cancellation Model

Dashboard cancel now flows through two layers:

1. the shared DB dispatch is marked `cancel_requested`
2. the next worker heartbeat receives `controlAction = "cancel"`

The worker then calls `cancel_local_dispatch`.

Behavior:

- active local CLI runs are stopped through the worker-host process' in-memory `ActiveDispatchRegistry`
- Jules sessions receive a soft-stop `send_session_message(...)` request

This keeps cancellation aligned with the same worker dispatch and task run records already shown in the v2 dashboard.
