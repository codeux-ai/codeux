# Connecting MCP clients

Code UX is a Model Context Protocol server. Any MCP-compatible client can connect to it and call its tools. This page shows the canonical setup for the three clients we test against, and explains how to use the optional **Streamable HTTP gateway** for remote workers.

## How the connection works

By default, Code UX speaks MCP over **stdio**: the client launches the `jules-subagents` process and exchanges JSON-RPC messages on its stdin/stdout. The server detects stdio mode automatically when stdin is not a TTY.

If you instead set `--mcp-http`, Code UX additionally exposes an MCP **Streamable HTTP** endpoint at `http://<host>:<port><path>` (defaults: `http://127.0.0.1:<dashboardPort + 1>/mcp`). This is used by external workers and by clients that prefer HTTP transport.

> The dashboard server (port `4444` by default) is **separate** from the MCP HTTP gateway. The dashboard hosts the UI and REST API. The MCP HTTP gateway hosts JSON-RPC. They run as two distinct HTTP listeners.

## Gemini CLI

Add Code UX to `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "code-ux": {
      "command": "npx",
      "args": ["-y", "jules-subagents"],
      "env": {
        "JULES_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

…or with the one-liner:

```bash
gemini mcp add code-ux npx -- -y jules-subagents --api-key your_api_key_here
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
args = ["-y", "jules-subagents", "--api-key", "your_api_key_here"]
```

…or with the CLI:

```bash
codex mcp add code-ux -- npx -y jules-subagents --api-key your_api_key_here
```

## Claude Desktop

Edit your platform's `claude_desktop_config.json` (location varies by OS — see Anthropic's docs):

```json
{
  "mcpServers": {
    "code-ux": {
      "command": "npx",
      "args": ["-y", "jules-subagents"],
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
      "args": ["-y", "jules-subagents"]
    }
  }
}
```

## What the client sees

When Code UX boots in stdio mode it advertises itself with:

- **Name:** `code-ux`
- **Version:** `1.2.0`
- **Capabilities:** `tools`, `resources`, `prompts`

The tool list (filtered by your runtime role and `mcpTools` toggles) is:

| Tool | Purpose |
| --- | --- |
| `get_session` | Inspect the state of a session by ID. |
| `manage_code_ux` | Unified action surface: projects, sprints, tasks, agents, settings, memory, preview, telemetry. |
| `listen` | Long-poll for the next dashboard message addressed to this client. |
| `start_listen` | Register the client and return any pending dashboard messages. |
| `pull_inbox` | Poll the dashboard inbox without registering. |
| `post_listen_reply` | Send a reply back to a dashboard conversation thread. |
| `generate_dashboard_reply` | Generate a non-coding dashboard reply using local providers. |

For full schemas, see [Developer → MCP tools](../developer/mcp-tools.md). For the management surface, see [Developer → Management actions](../developer/management-actions.md).

## Listener mode (long-poll)

The `listen` tool is the canonical way for chat-style clients to participate in dashboard conversations:

1. The client calls `listen` with a stable `connection_key` (e.g. `claude-desktop-pierre`) and one or more `project_ids`.
2. The call **blocks** for up to `timeout_seconds` (default = the dashboard's watch-loop output interval).
3. When a dashboard user sends a message addressed to this connection, `listen` returns it.
4. The client decides what to do with it — often calling `generate_dashboard_reply` and then `post_listen_reply`.

This pattern lets a chat thread on the dashboard appear to converse with a remote LLM in near real time, with the LLM driven by its native client.

## Remote MCP HTTP gateway

If you want external worker hosts to connect to Code UX over the network, enable the gateway:

```bash
jules-subagents \
  --mcp-http \
  --mcp-http-host 0.0.0.0 \
  --mcp-http-port 4445 \
  --mcp-http-path /mcp \
  --mcp-http-auth-token "$(openssl rand -hex 32)"
```

Then point your MCP client at:

```
http://<host>:4445/mcp
```

…with header `Authorization: Bearer <token>`.

A `GET /health` endpoint returns `{ "status": "UP" }` and is the recommended liveness check.

> **Security:** When `--mcp-http-host` is *not* loopback, an auth token is **required**. Loopback (`127.0.0.1`/`localhost`/`::1`) hosts may run unauthenticated for development. Always use HTTPS in production via a reverse proxy.

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
| Client never sees `code-ux` tools | The CLI command in the client config is wrong, or the JULES_API_KEY is missing and the server exited early. Check the client's MCP error log. |
| `listen` returns immediately with no message | Normal. `listen` long-polls; the client should call it again. |
| HTTP gateway returns 401 | Missing `Authorization: Bearer <token>` header, or token mismatch. |
| HTTP gateway returns 400 with "must be initialize" | First request on a new session must be a JSON-RPC `initialize` call. |
| "Tool not enabled" on `CallTool` | The tool is disabled in `Settings → MCP tools`. Re-enable it. |

See the full [Troubleshooting](./troubleshooting.md) page for more.
