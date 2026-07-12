# Node Flow Durable Execution

Node-flow execution is publication based. Saving a flow appends an immutable version and publication containing the normalized graph and an immutable execution-policy snapshot. Manual, MCP, and scheduled callers select either `{ mode: "pinned", version: N }` or `{ mode: "latest_published" }`; the runtime never executes the mutable `node_flows` graph.

## Durable lifecycle

Runs move through `queued`, `running`, `approval_waiting`, `retry_waiting`, `attention_required`, and terminal `succeeded`, `failed`, or `cancelled` states. A queue claim assigns an executor, lease expiry, and heartbeat. Global and per-project limits bound active claims. Cancellation and node timeouts propagate through `AbortSignal`.

Every node execution creates a numbered attempt with executor identity, optional execution invocation id, SHA-256 output digest, redacted input/output, credential ids, failure classification, and retry decision. Retryable timeout, quota, and transient failures use the publication policy's bounded exponential backoff and jitter. Credential values are resolved only at the node boundary and are never written to run, attempt, invocation, or diagnostic records.

## Recovery contract

Startup recovery scans queued and waiting work plus running work with expired leases. A pre-invocation attempt can be requeued safely without inserting a duplicate attempt. An expired attempt with an invocation id has an unknown externally observable outcome and moves to `attention_required`; Code UX does not silently replay it. Approval- and retry-waiting runs retain their durable state until their prerequisite becomes actionable.

The relevant tables are `node_flow_publications`, `node_flow_runs`, `node_flow_node_runs`, and `node_flow_node_attempts`. Attempt history is available at `GET /api/node-flow-runs/:runId/attempts` and contains only redacted payloads and credential identifiers.
