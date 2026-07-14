# Node Flow Durable Execution

Node-flow execution is publication based. Saving a flow appends an immutable version and publication containing the normalized graph and an immutable execution-policy snapshot. Manual, MCP, and scheduled callers select either `{ mode: "pinned", version: N }` or `{ mode: "latest_published" }`; the runtime never executes the mutable `node_flows` graph.

## Durable lifecycle

Runs move through `queued`, `running`, `approval_waiting`, `retry_waiting`, `attention_required`, and terminal `succeeded`, `failed`, or `cancelled` states. A queue claim assigns an executor, lease expiry, and heartbeat. Global and per-project limits bound active claims. Cancellation and node timeouts propagate through `AbortSignal`.

Every node execution creates a numbered attempt with executor identity, logical-item identity, optional execution invocation id, SHA-256 output digest, redacted input/output, credential ids, failure classification, and retry decision. Foreach descendants have independent node runs and attempt numbering per logical item, while ordinary execution uses the backward-compatible `default` item. Retryable timeout, quota, and transient failures use the publication policy's bounded exponential backoff and jitter. Credential values are resolved only at the node boundary and are never written to run, attempt, invocation, or diagnostic records.

## Recovery contract

Startup recovery scans queued and waiting work plus running work with expired leases. A pre-invocation attempt can be requeued safely without inserting a duplicate attempt. An expired attempt with an invocation id has an unknown externally observable outcome and moves to `attention_required`; Code UX does not silently replay it. Pending approvals remain `approval_waiting`. A persisted approved decision is matched to its waiting node and logical item, then resumed on the same run and pinned publication; completed sibling items are reconstructed from their persisted outputs instead of replayed. Rejected or expired decisions durably fail the waiting run and close other waiting item attempts.

The relevant tables are `node_flow_publications`, `node_flow_runs`, `node_flow_node_runs`, and `node_flow_node_attempts`. Attempt history is available at `GET /api/node-flow-runs/:runId/attempts` and contains only redacted payloads and credential identifiers.

## Distributed ownership and side effects

Authenticated runners claim through a service principal with `automation_runner` and explicit project membership. The database update from queued/retry-waiting to running is the ownership compare-and-set; heartbeats renew only when both run id and lease owner match. A second runner therefore cannot acquire an active lease.

External email-style effects use `automation_outbox`. The idempotency key is derived from publication, run, node, and logical item, so reconstructing services after restart returns an existing sent row rather than invoking the provider twice. Known failures may be retried; unknown outcomes become `attention_required`. Approval decisions and deliveries are durable and produce redacted correlation audit records alongside run and attempt events.

Approval continuation uses a compare-and-set claim from `approval_waiting` to `running`. It reconstructs completed node outputs and branch selections, reuses the waiting node run and numbered attempt, and continues at the governed node boundary. Repeating the same decision or explicit `POST /api/node-flow-runs/:runId/resume-approval` request returns the existing run state when another owner already claimed or completed it; it does not create a second attempt or outbox delivery.
