# Realtime WebSocket protocol

The dashboard subscribes to `/api/realtime` (WebSocket) for push updates. This page documents the wire protocol for clients that want to consume the same stream programmatically.

## Endpoint

```
ws://<host>:<dashboardPort>/api/realtime
```

No authentication. The endpoint is bound to loopback by default; expose with care.

## Message envelope

All frames are JSON, single-message:

```jsonc
{
  "type": "subscribe" | "unsubscribe" | "snapshot" | "event" | "ping" | "pong",
  "id": "string",        // request id (for client-initiated frames)
  "scope": "string",     // resource scope, e.g. "project:<id>", "execution"
  "sequence": 1234,      // monotonic per-scope sequence number (server frames only)
  "data": { },           // payload
  "error": { "code", "message" }   // on error
}
```

## Connection lifecycle

```
Client → server   { type: "subscribe", id, scope, lastSequence?: number }
Server → client   { type: "snapshot", id, scope, sequence, data: <full state> }
Server → client   { type: "event", scope, sequence, data: <delta> }   // 0..N
…
Client → server   { type: "unsubscribe", id, scope }
```

A `subscribe` may include `lastSequence` from a previous connection. The server replays missed events from that point if it can; otherwise it returns a fresh `snapshot`.

The server emits `ping` periodically (default 30 s); the client should reply with `pong` to avoid timeout-driven disconnect.

## Available scopes

| Scope | What it tracks |
| --- | --- |
| `project:<id>` | Project metadata, settings effective values, attention items. |
| `project:<id>:sprints` | Sprint list and status changes. |
| `project:<id>:tasks` | Task status changes. |
| `project:<id>:execution` | Live cycle events for the active sprint run. |
| `project:<id>:memory` | Memory adds / updates / promotions. |
| `project:<id>:connections` | MCP connection list and presence. |
| `project:<id>:conversations` | Chat thread updates. |
| `git-status` | Git status refreshes (debounced). |
| `live-activities` | Live agent activities. |
| `docker` | Docker container list. |
| `system` | System-wide settings or status changes. |

A client may subscribe to as many scopes as needed.

## Reconnection

Recommended client behaviour:

1. On `close`, wait `min(2^attempts, 30s) + jitter` and reconnect.
2. On reconnect, re-subscribe to all known scopes with `lastSequence` set.
3. If the server returns a fresh `snapshot` (rather than backfilled events), discard any cached deltas and use the snapshot as the source of truth.

The official client (`dashboard/src/lib/realtime/dashboard-realtime-client.ts`) implements this.

## Snapshot rate limiting

To prevent flood, the server enforces a 3 s cooldown between snapshot deliveries per scope. Subsequent subscribe requests within the window are coalesced.

## Fallback to polling

If the WebSocket connection cannot be established (proxy strips upgrade headers, etc.), clients should fall back to polling the corresponding REST endpoint:

| Scope | REST fallback |
| --- | --- |
| `project:<id>:execution` | `GET /api/projects/:id/execution` |
| `git-status` | `GET /api/git-status` |
| `live-activities` | `GET /api/live-activities` |
| `project:<id>` (live) | `GET /api/live?projectId=:id` |

The default dashboard client falls back automatically.

## Error semantics

- A frame with `type: "event"` and `error` set indicates a transient delivery failure for that event; the next event will carry an updated `sequence`.
- A frame with `type: "snapshot"` and `error` indicates the scope is unavailable (e.g. project deleted). Unsubscribe.

## Sample session

```text
→ {"type":"subscribe","id":"a1","scope":"project:proj-1:execution"}
← {"type":"snapshot","id":"a1","scope":"project:proj-1:execution","sequence":42,"data":{...}}
← {"type":"event","scope":"project:proj-1:execution","sequence":43,"data":{"type":"task.started","taskId":"t-7"}}
← {"type":"event","scope":"project:proj-1:execution","sequence":44,"data":{"type":"cycle.completed"}}
← {"type":"ping"}
→ {"type":"pong"}
→ {"type":"unsubscribe","id":"a1","scope":"project:proj-1:execution"}
```
