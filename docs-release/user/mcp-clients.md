# Connecting MCP clients

Besides its dashboard, Code UX is also a Model Context Protocol (MCP) server. Any MCP-compatible client can connect to it and call its tools — so you can drive projects and sprints from the Gemini CLI, Codex, Claude Code, or your own client. This page shows the canonical setup for the clients we test against, and how to use the **MCP HTTPS worker gateway** for remote workers.

## How the connection works

By default, Code UX speaks MCP over **stdio**: the client launches the `codeux` process and exchanges JSON-RPC messages on its stdin/stdout. The server detects stdio mode automatically when stdin is not a TTY.

Code UX also runs an **MCP HTTPS worker gateway** (enabled by default; disable with `--no-mcp-https`). It listens on its own host/port/path — configurable via `--mcp-https-host`, `--mcp-https-port`, and `--mcp-https-path` (default path `/mcp`) — and is used by remote workers and clients that prefer an HTTP transport. On a non-loopback host it requires a bearer token (`--mcp-https-auth-token` or `MCP_HTTPS_AUTH_TOKEN`).

> The dashboard server (port `4444` by default) is **separate** from the MCP HTTPS gateway. The dashboard hosts the UI and REST API; the gateway hosts JSON-RPC. They run as two distinct listeners.

## Gemini CLI

Add Code UX to `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "code-ux": {
      "command": "npx",
      "args": ["-y", "@codeuxai/codeux"],
      "env": {
        "JULES_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

…or with the one-liner:

```bash
gemini mcp add code-ux npx -- -y @codeuxai/codeux --api-key your_api_key_here
```

Test from Gemini CLI:

```
> list my code ux projects
```

The model should call `manage_code_ux` with `domain: "projects", action: "list"`.

## Codex CLI

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.code-ux]
command = "npx"
args = ["-y", "@codeuxai/codeux", "--api-key", "your_api_key_here"]
```

…or with the CLI:

```bash
codex mcp add code-ux -- npx -y @codeuxai/codeux --api-key your_api_key_here
```

## Claude Desktop

Edit your platform's `claude_desktop_config.json` (location varies by OS — see Anthropic's docs):

```json
{
  "mcpServers": {
    "code-ux": {
      "command": "npx",
      "args": ["-y", "@codeuxai/codeux"],
      "env": {
        "JULES_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

Restart Claude Desktop. Code UX should appear in the MCP server list and its tools become available to the model.

## Claude Code (CLI)

Claude Code reads its MCP servers from `~/.claude/settings.json` or per-project. Add an entry under `mcpServers`:

```json
{
  "mcpServers": {
    "code-ux": {
      "command": "npx",
      "args": ["-y", "@codeuxai/codeux"]
    }
  }
}
```

## What the client sees

When Code UX boots in stdio mode it advertises itself with:

- **Name:** `code-ux`
- **Version:** `0.8.x`
- **Capabilities:** `tools`, `resources`, `prompts`

The tool list (filtered by your runtime role and `mcpTools` toggles) is **one tool per management
domain**, plus `search_knowledge`:

| Tool | Purpose |
| --- | --- |
| `manage_projects` | List, get, create, update, select, set up, and delete projects. |
| `manage_sprints` | Plan, start, pause, cancel, inspect, import issues, and edit sprints. |
| `manage_tasks` | Create, edit, start, stop, pause, and inspect tasks. |
| `manage_quicksprints` | Manage quicksprint templates and execute them. |
| `manage_scheduler` | Create and run scheduled sprints, quicksprints, and messages. |
| `manage_agents` | Manage agent presets and sync them to project markdown. |
| `manage_memory` | Inspect, search, promote, and re-embed memory. |
| `search_knowledge` | Semantic search over the caller's subscribed knowledge base. |
| `manage_settings` | Get/resolve/patch/replace/reset system, project, and sprint settings. |
| `manage_preview` | Manage sprint preview containers. |
| `manage_telemetry` | Read execution snapshots, invocations, sprint runs, and dispatches. |
| `manage_code_ux` | **Deprecated** unified dispatcher; prefer the dedicated tools above. |

For full schemas and `action` enums, see [Developer → MCP tools](../developer/mcp-tools.md). For the
per-action payloads, see [Developer → Management actions](../developer/management-actions.md).

## Remote MCP HTTP gateway

If you want external worker hosts to connect to Code UX over the network, enable the gateway:

```bash
codeux \
  --mcp-https \
  --mcp-https-host 0.0.0.0 \
  --mcp-https-port 4445 \
  --mcp-https-path /mcp \
  --mcp-https-auth-token "$(openssl rand -hex 32)"
```

Then point your MCP client at:

```
http://<host>:4445/mcp
```

…with header `Authorization: Bearer <token>`.

A `GET /health` endpoint returns `{ "status": "UP" }` and is the recommended liveness check.

> **Security:** When `--mcp-https-host` is *not* loopback, an auth token is **required**. Loopback (`127.0.0.1`/`localhost`/`::1`) hosts may run unauthenticated for development. Always use HTTPS in production via a reverse proxy.

For the wire protocol, see [Architecture → MCP server](../architecture/mcp-server.md).

## Verifying a client connection

A connected client appears under the active project on the **Settings → Connections** panel of the dashboard, including:

- Connection key
- Display name
- Role (`project_manager`, `worker`, `listener`)
- Transport (`stdio`, `http`, `internal`)
- Capabilities

You can rename connections, view their pending message backlog, and (for stale entries) prune them.

## Troubleshooting MCP integration

| Symptom | Likely cause |
| --- | --- |
| Client never sees `code-ux` tools | The CLI command in the client config is wrong, or the server exited early. Check the client's MCP error log. |
| A management action returns `approvalRequired` | Expected for destructive/mutating actions. Retry the same call with `approval: { "confirmed": true }`. |
| HTTP gateway returns 401 | Missing `Authorization: Bearer <token>` header, or token mismatch. |
| HTTP gateway returns 400 with "must be initialize" | First request on a new session must be a JSON-RPC `initialize` call. |
| "Tool not enabled" on `CallTool` | The tool is disabled in `Settings → MCP tools`. Re-enable it. |

See the full [Troubleshooting](./troubleshooting.md) page for more.
