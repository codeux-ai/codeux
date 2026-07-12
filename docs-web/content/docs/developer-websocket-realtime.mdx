# Realtime WebSocket protocol

The dashboard subscribes to `/api/realtime` (WebSocket) for push updates. This page documents the wire protocol for clients that want to consume the same stream programmatically.

## Endpoint

```
ws://<host>:<dashboardPort>/api/realtime
```

No authentication. The endpoint is bound to loopback by default; expose with care.

## Message envelope

All frames are JSON, single-message:

The client sends a complete subscription set:

```jsonc
{ "type": "set_subscriptions", "scopes": ["overview", "project:<id>"], "lastSequence": 1234 }
```

The server sends one of four typed frames:

```jsonc
{ "type": "ready" }
{ "type": "subscribed", "scopes": ["overview", "project:<id>"], "lastSequence": 1234 }
{ "type": "event", "event": { "sequence": 1235, "scope": "project:<id>", "eventType": "project.execution.updated", "payload": {} } }
{ "type": "snapshot_required", "reason": "non_replayable_event_missed" | "replay_window_exceeded" | "invalid_client_message" }
```

## Connection lifecycle

```
Server → client   { type: "ready" }
Client → server   { type: "set_subscriptions", scopes, lastSequence? }
Server → client   { type: "event", event }   // 0..N replayed events
Server → client   { type: "snapshot_required", reason }   // when replay is unsafe
Server → client   { type: "subscribed", scopes, lastSequence }
```

A subscription set may include `lastSequence` from a previous connection. The server replays missed events from that point if it can. When it cannot, it sends `snapshot_required`; the client refreshes subscribed resources through REST and discards the unusable cursor. The server always finishes the handshake with `subscribed` and its current authoritative watermark.

## Available scopes

| Scope | What it tracks |
| --- | --- |
| `project:<id>` | Project metadata, settings effective values, attention items. |
| `project:<id>:git` | Selected-project Git status changes. |
| `thread:<id>` | Conversation events for one thread. |
| `projects` | Project collection and cross-project execution invalidation. |
| `overview` | Cross-project overview telemetry. |

A client may subscribe to as many scopes as needed.

## Reconnection

Recommended client behaviour:

1. On `close`, wait `min(2^attempts, 30s) + jitter` and reconnect.
2. On reconnect, send the union of active scopes with `lastSequence` set.
3. On `snapshot_required`, clear the cursor and refresh subscribed resources from their REST snapshots.
4. Accept `subscribed.lastSequence` as the current server watermark, even when it is lower than the cursor sent during reconnect.

Treat the `subscribed.lastSequence` acknowledgement as authoritative even if it is lower than the cursor sent by the client. A lower value is expected when the server restarted after the client observed a non-persisted sequence. On `snapshot_required`, invalidate the old cursor before refreshing REST snapshots, and serialize later scope changes until the current subscription set is acknowledged. This prevents route changes from repeatedly resending an unrecoverable pre-restart cursor.

The official client (`dashboard/src/lib/realtime/dashboard-realtime-client.ts`) implements this.

## Recovery notification deduplication

The official client dispatches at most one `snapshot_required` notification every 3 seconds. Resource controllers also coalesce their silent REST refetches so one recovery handshake does not produce a refresh storm.

## Fallback to polling

If the WebSocket connection cannot be established, consumers continue using their resource-specific REST snapshots. Common examples are `GET /api/live?projectId=:id`, `GET /api/projects/:id/execution`, `GET /api/git-status`, and the project conversation list/message endpoints. The WebSocket transports invalidations and deltas; REST remains the source for initial and recovery snapshots.

## Error semantics

- Unknown scopes are omitted from the acknowledged `scopes` list.
- An invalid client frame produces `snapshot_required` with reason `invalid_client_message`; reconnect with a valid `set_subscriptions` payload.
- If a requested resource no longer exists, its REST recovery request reports that condition and the consumer should remove the corresponding scope.

## Sample session

```text
← {"type":"ready"}
→ {"type":"set_subscriptions","scopes":["project:proj-1"],"lastSequence":42}
← {"type":"event","event":{"sequence":43,"scope":"project:proj-1","eventType":"conversation.thread.updated","payload":{}}}
← {"type":"subscribed","scopes":["project:proj-1"],"lastSequence":43}
```
