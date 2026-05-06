# Streamable HTTP Worker Gateway

## Status
Implemented foundation

## Purpose

Code UX now supports a remote-capable MCP transport path for workers without breaking the zero-setup stdio experience for normal human-driven MCP clients.

The transport split is:

- stdio for local Gemini CLI, Codex, and similar human-driven MCP clients
- Streamable HTTP for remote worker control-plane connections

This keeps local MCP usage simple while allowing workers to run on other machines.

## Why This Exists

Code UX was previously stdio-only.

That worked for local MCP clients, but it blocked the real worker architecture because a worker on another machine could not attach to the main Code UX server over stdio.

The worker gateway solves that by exposing a dedicated authenticated MCP HTTP endpoint on the main Code UX server.

## Runtime Roles

Code UX now uses three MCP runtime roles internally:

- `project_manager`
- `worker_host`
- `worker_gateway`

### `project_manager`

The normal main Code UX server process.

It exposes the human-facing MCP tool surface over stdio.

### `worker_host`

A headless local Code UX runtime started by the worker process on the worker machine.

It exposes only the worker-local execution tools needed to:

- execute a claimed dispatch
- cancel local work
- generate a dashboard reply with local provider context

### `worker_gateway`

The MCP role exposed by the main Code UX server over Streamable HTTP.

It exposes only the remote worker control-plane tools needed to:

- listen for dashboard messages
- receive worker dispatch claims
- post dashboard replies
- heartbeat and finalize dispatch state

It does not expose the full project-manager tool surface.

The gateway now also enforces worker identity at the listener entrypoint:

- `listen` on `worker_gateway` is always registered as `role = worker`
- the stored connection transport is always `streamable_http`

That prevents remote HTTP worker connections from masquerading as normal stdio listeners.

## Transport Model

The current worker architecture is intentionally split into two channels.

### Control plane

The worker connects to the main Code UX server over Streamable HTTP.

That connection is used for:

- `listen`
- `post_listen_reply`
- `update_task_dispatch`

This is the remote, project-scoped control plane.

### Local execution plane

The worker also starts a local headless Code UX server in `worker_host` mode and connects to it over stdio.

That local connection is used for:

- `execute_worker_dispatch`
- `cancel_local_dispatch`
- `generate_dashboard_reply`
- `get_session`

This allows the worker machine to use its own local provider environment, CLI tools, Docker installation, auth state, and repo context while still reporting into the central Code UX control plane.

Worker registrations now also include lightweight machine metadata in the connection record:

- hostname
- platform
- architecture
- local execution runtime

That metadata is surfaced in the live runtime dashboard so operators can distinguish workers by machine, not just by connection key.

## Main Server Configuration

The main Code UX server can expose the worker gateway with:

- `--mcp-http`
- `--mcp-http-port`
- `--mcp-http-host`
- `--mcp-http-path`
- `--mcp-http-auth-token`

Equivalent environment variables:

- `MCP_HTTP_ENABLED`
- `MCP_HTTP_PORT`
- `MCP_HTTP_HOST`
- `MCP_HTTP_PATH`
- `MCP_HTTP_AUTH_TOKEN`

Behavior:

- disabled by default
- automatically disabled for `worker_host`
- defaults to `dashboardPort + 1` when `--mcp-http` is set without an explicit HTTP port
- requires an auth token when binding to a non-loopback host

Default path:

- `/mcp`

## Worker Setup

Local-only worker behavior still works:

```bash
node dist/worker/index.js --project-id <PROJECT_ID>
```

Remote control-plane mode uses:

```bash
node dist/worker/index.js \
  --server-url http://SERVER_HOST:5555/mcp \
  --auth-token <TOKEN> \
  --project-id <PROJECT_ID>
```

Important detail:

- `--server-url` points at the main Code UX worker gateway
- the worker still starts its own local `worker_host` runtime unless explicitly customized

The local worker-host runtime is configured with:

- `--server-command`
- `--server-arg`
- `--server-cwd`

Those flags configure the worker machine's local execution process, not the remote control plane.

## Security Model

The worker gateway supports bearer authentication:

- `Authorization: Bearer <token>`

If the gateway is exposed on anything other than loopback, Code UX now requires a configured auth token at startup.

This is a minimal transport guard, not the final worker identity model.

Later phases should add stronger worker registration and per-worker auth semantics.

## What This Solves

This implementation fixes the most important transport gap:

- normal stdio MCP clients stay zero-setup
- remote workers no longer depend on sharing the same local stdio server process
- worker execution still reuses the same DB-native dispatch and event model

## What Is Still Transitional

This is not yet the final worker architecture.

Remaining follow-up work includes:

- richer worker authentication and registration
- explicit remote worker lifecycle management
- stronger connection cleanup and archival
- possibly reducing or replacing the local `worker_host` helper once execution hooks are factored differently
