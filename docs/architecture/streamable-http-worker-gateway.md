# Streamable HTTP Worker Gateway

## Status
Implemented

## Purpose

Code UX now supports a remote-capable MCP transport path for workers without breaking the zero-setup stdio experience for normal human-driven MCP clients.

The transport split is:

- stdio for local Gemini CLI, Codex, and similar human-driven MCP clients
- Streamable HTTP for remote worker control-plane connections

This keeps local MCP usage simple while allowing workers to run on other machines.

## Why This Exists

Code UX was previously stdio-only.

That worked for local MCP clients, but it blocked the real worker architecture because a worker on another machine could not attach to the main Code UX server over stdio.

The worker gateway solves that by exposing an authenticated MCP HTTP endpoint on the main Code UX server. In server mode, this endpoint is the primary control-plane surface and the dashboard is intentionally not bound.

## Runtime Roles

Code UX uses two MCP runtime roles internally:

- `project_manager`
- `worker-host`

### `project_manager`

The normal main Code UX server process.

It exposes the human-facing MCP tool surface over stdio.

### `worker-host`

A headless local Code UX runtime started by the worker process on the worker machine.

It exposes only the worker-local execution tools needed to:

- execute a claimed dispatch
- cancel local work
- generate a dashboard reply with local provider context

### HTTP Transport

The MCP Streamable HTTP transport exposes the same `project_manager` tool surface. Worker identity, assignment, heartbeat state, and dispatch claims are modeled by the worker endpoint and project assignment services instead of by a separate worker-only MCP runtime.

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

- `--server-mode`
- `--mcp-http-port`
- `--mcp-http-host`
- `--mcp-http-path`
- `--mcp-http-auth-token`

Legacy-compatible names are still accepted:

- `--mcp-https`
- `--mcp-https-port`
- `--mcp-https-host`
- `--mcp-https-path`
- `--mcp-https-auth-token`

Equivalent environment variables:

- `CODE_UX_SERVER_MODE`
- `MCP_HTTP_ENABLED`
- `MCP_HTTP_PORT`
- `MCP_HTTP_HOST`
- `MCP_HTTP_PATH`
- `MCP_HTTP_AUTH_TOKEN`
- `MCP_HTTP_MAX_SESSIONS`
- `MCP_HTTP_SESSION_TIMEOUT_MS`

Legacy-compatible names are still accepted:

- `MCP_HTTPS_ENABLED`
- `MCP_HTTPS_PORT`
- `MCP_HTTPS_HOST`
- `MCP_HTTPS_PATH`
- `MCP_HTTPS_AUTH_TOKEN`
- `MCP_HTTPS_MAX_SESSIONS`
- `MCP_HTTPS_SESSION_TIMEOUT_MS`

Behavior:

- enabled by default
- can be disabled with `--no-mcp-https` or `MCP_HTTPS_ENABLED=false`
- defaults to `dashboardPort + 1` when no explicit MCP HTTP port is configured
- auto-generates a user-scoped bearer token in `~/.code-ux/security.json` on first startup when no explicit token is configured
- requires bearer authentication for normal Code UX startup, including Docker Desktop/WSL defaults that bind the gateway to `0.0.0.0` for container reachability
- requires an explicit bearer token in server mode and does not use the generated user token fallback
- keeps explicit `--mcp-https-auth-token` and `MCP_HTTPS_AUTH_TOKEN` values as the highest-precedence token sources
- exposes an HTTP listener; HTTPS/TLS requires a reverse proxy or future native certificate configuration

Default path:

- `/mcp`

## Worker Setup

Local-only worker behavior still works:

```bash
codeux-worker --project-id <PROJECT_ID>
```

Remote control-plane mode uses:

```bash
codeux-worker \
  --server-url http://SERVER_HOST:4445/mcp \
  --auth-token <TOKEN> \
  --project-id <PROJECT_ID>
```

Important detail:

- `--server-url` points at the main Code UX worker gateway
- the worker still starts its own local `worker_host` runtime unless explicitly customized
- repeat `--project-id` to enroll a multi-project worker
- use a stable `--connection-key` so reconnects update the same endpoint

The local worker-host runtime is configured with:

- `--server-command`
- `--server-arg`
- `--server-cwd`

Those flags configure the worker machine's local execution process, not the remote control plane.

## Cluster Operation

External worker endpoints are registered in `worker_endpoints` with heartbeat-derived status. Project eligibility lives in `project_worker_assignments`, where a project can have one primary worker and any number of overflow workers. There is no product cap on registered workers; the Streamable HTTP active-session cap is a transport protection default that operators can raise for large clusters.

Task pickup is protected by both `task_dispatches` and `execution_leases`. A claim must return a lease token before the worker starts local execution. Worker heartbeats renew the lease while work runs, and stale or offline endpoints are excluded from new claims. If a primary worker goes stale, eligible overflow workers can claim new work for the project.

## Security Model

The worker gateway supports bearer authentication:

- `Authorization: Bearer <token>`

If the gateway is exposed on anything other than loopback, Code UX requires an active bearer token at startup. If no explicit token is supplied during normal dashboard startup, Code UX creates a user-scoped token in `~/.code-ux/security.json`; operators can read or regenerate it from Settings → MCP before distributing it to local CLIs or remote workers. In server mode, the token must be supplied explicitly through CLI or environment and must be treated as a full-control secret.

The request preflight validates security-sensitive headers before any session lookup:

- malformed or missing bearer auth for a token-protected gateway returns the same sanitized `401 Unauthorized` JSON-RPC envelope
- malformed `mcp-session-id` or `x-code-ux-agent` headers return a sanitized `400 Bad Request` JSON-RPC envelope
- inactive session ids return a generic invalid-session response and logs do not include the supplied session id or bearer value

Session lifecycle limits are enforced at the gateway:

- at most 100 active Streamable HTTP sessions are accepted at once
- sessions idle for more than one hour are closed and removed before a new initialize request is evaluated against the active-session cap
- active-session cap failures are logged with bounded metadata such as method, path, active count, and maximum count, not bearer tokens or session ids

## What This Solves

This implementation fixes the most important transport gap:

- normal stdio MCP clients stay zero-setup
- remote workers no longer depend on sharing the same local stdio server process
- worker execution still reuses the same DB-native dispatch and event model

For operator procedures, token rotation, health checks, settings synchronization, and troubleshooting, see [Secure Headless Server Mode](../operations/server-mode.md).
