# MCP tools

Code UX exposes **7 root MCP tools**. Six are connection / messaging primitives; the seventh, `manage_code_ux`, is a unified action surface covering 60+ management actions across 8 domains (documented separately in [Management actions](./management-actions.md)).

This page is the exact contract for each tool: input schema, output shape, side effects, and runtime-role gating.

> **Server identity:** When asked, the server identifies as `code-ux` v `1.2.0`. The package on npm is `jules-subagents`.

## Tool availability

Tools are filtered through two layers before being advertised on `ListTools`:

1. **Runtime role** — defined per tool in `runtimeRoles`. The server's role is set via `--runtime-role` (default `project_manager`).
2. **Toggle** — each tool has an entry in `settings.mcpTools`. Disabled tools are not advertised and return `MethodNotFound` if called.

All seven default tools are enabled by default and have `runtimeRoles: ["project_manager"]`.

---

## `get_session`

Get the current status, state, and outputs of a tracked or active execution session.

### Input
```jsonc
{
  "session_id": "string"   // required
}
```

### Output
A JSON object containing the current session record (state, last_activity, transcript references). Output shape mirrors the underlying provider session as projected by Code UX's session tracking layer.

### Errors
- `InvalidParams` — `session_id` missing.
- Tool returns an error envelope if the session ID is unknown.

---

## `manage_code_ux`

Unified action dispatcher for all internal Code UX state. Used for configuration and destructive actions. Destructive actions require an approval handshake.

### Input
```jsonc
{
  "domain": "string",       // required: projects | sprints | tasks | settings | agents | memory | preview | telemetry
  "action": "string",       // required: action name within the domain
  "payload": { },           // required: action-specific parameters
  "approval": {
    "confirmed": false      // optional: set to true to confirm a destructive action
  }
}
```

### Output
A JSON object specific to the action, plus optionally:

```jsonc
{
  "approvalRequired": true,
  "approvalMessage": "Deleting project foo will orphan 5 sprints..."
}
```

When `approvalRequired` is set, retry the call with `approval: { "confirmed": true }`.

### Errors
- `InvalidParams` — bad domain / action / payload shape.
- Returns an envelope with `error: { code, message }` on action-specific failures.

See [Management actions](./management-actions.md) for the full per-domain matrix.

---

## `listen`

Enter Code UX **listening mode**. The call blocks until one actionable dashboard message is available, or until `timeout_seconds` elapses.

This is the primary tool used by chat-style MCP clients (e.g. an LLM that wants to reply to dashboard chat messages).

### Input
```jsonc
{
  "connection_key": "string",            // required: stable unique key for this client
  "display_name": "string",              // optional
  "role": "project_manager" | "worker" | "listener",  // optional
  "project_id": "string",                // optional: bind as active project
  "project_ids": ["string"],             // optional: bound projects
  "active_project_ids": ["string"],      // optional: active subset for this listen
  "transport": "string",                 // optional
  "capabilities": { },                   // optional, additionalProperties allowed
  "timeout_seconds": 0,                  // optional, default = watchLoopOutputIntervalSeconds
  "poll_interval_ms": 1000,              // optional, default 1000

  // DEPRECATED — task dispatch and attention events are no longer exposed via listen
  "include_task_dispatch": false,
  "include_attention_items": false
}
```

### Output
On message availability:

```jsonc
{
  "message": {
    "id": "string",
    "thread_id": "string",
    "thread_title": "string",
    "body_markdown": "string",
    "metadata": { }
  },
  "deadlinePassed": false
}
```

If timeout elapses with nothing available, returns:

```jsonc
{ "deadlinePassed": true }
```

### Side effects
The connection is registered (or re-registered) in the connection registry. It will appear in **Settings → Connections**.

---

## `start_listen`

Low-level compatibility tool. Registers the listener and **immediately returns** any pending dashboard messages without blocking.

### Input
```jsonc
{
  "connection_key": "string",            // required
  "display_name": "string",              // optional
  "role": "project_manager" | "worker" | "listener",  // optional
  "project_id": "string",                // optional
  "project_ids": ["string"],             // optional
  "active_project_ids": ["string"],      // optional
  "transport": "string",                 // optional
  "capabilities": { },                   // optional
  "max_messages": 10                     // optional, default 10
}
```

### Output
```jsonc
{
  "connection": { "id": "...", "displayName": "...", "role": "..." },
  "messages": [ { "id": "...", "thread_id": "...", "body_markdown": "..." } ]
}
```

`start_listen` is appropriate for clients that want a single batched fetch. For continuous chat, prefer `listen`.

---

## `pull_inbox`

Polls the dashboard inbox for pending messages for an *already-registered* MCP connection. Does not register; the connection key must already exist.

### Input
```jsonc
{
  "connection_key": "string",            // required
  "project_id": "string",                // optional
  "max_messages": 10                     // optional, default 10
}
```

### Output
```jsonc
{
  "messages": [ /* same shape as listen */ ]
}
```

---

## `post_listen_reply`

Post a listener reply back to the dashboard conversation thread and mark the message as handled.

### Input
```jsonc
{
  "connection_key": "string",   // required
  "thread_id": "string",        // required
  "body_markdown": "string",    // required
  "reply_to_message_id": "string",   // optional
  "metadata": { }                    // optional, additionalProperties allowed
}
```

### Output
```jsonc
{
  "messageId": "string",        // the new dashboard message ID
  "threadId": "string"
}
```

Sending a reply emits a real-time event so any open dashboard pages refresh the thread immediately.

---

## `generate_dashboard_reply`

Generate a non-coding dashboard reply for a worker / listener connection using the local provider stack.

Use this when your client wants Code UX to *help* draft a reply — the call routes the prompt through the configured `dashboard_reply` (or `clarification_reply`) provider.

### Input
```jsonc
{
  "project_id": "string",       // required
  "thread_id": "string",        // required
  "thread_title": "string",     // optional
  "body_markdown": "string",    // required: the user message to answer
  "mode": "reply" | "compact_thread"   // optional, default "reply"
}
```

When `mode` is `compact_thread`, `body_markdown` is treated as a prepared compaction prompt and the call returns a summary instead of a chat reply.

### Output
```jsonc
{
  "reply_markdown": "string",
  "provider": "claude-code" | "gemini" | "codex" | ...,
  "model": "string"
}
```

---

## Error model

All tool handlers return one of:

- A structured success envelope.
- An MCP error of standard MCP types: `InvalidParams`, `MethodNotFound`, `InternalError`.
- A success envelope containing `{ "error": { code, message } }` for non-fatal action failures (e.g. validation errors inside `manage_code_ux`).

JSON-RPC error codes used over HTTP:

| Code | Meaning |
| --- | --- |
| `-32000` | Bad Request (HTTP 400) |
| `-32001` | Unauthorized (HTTP 401) |
| `-32600` | Invalid Request |
| `-32601` | Method Not Found |
| `-32602` | Invalid Params |
| `-32603` | Internal Error |

## Schema validation

All tool inputs are validated against their declared JSON Schema using AJV before dispatch. Validation failures return `InvalidParams` with a precise error message including the failing JSON path.

## Tool lifecycle

```
Client → ListTools → server returns enabled tools (filtered by role + toggles)
Client → CallTool(name, args)
  Server → AJV validate args against TOOL_DEFINITIONS[name].inputSchema
  Server → toolRegistry.dispatch(name, args)
  Server → return wrapped result
```

The full enum of tools is the same across stdio and HTTP transports.
