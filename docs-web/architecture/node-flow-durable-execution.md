# Node Flow Durable Execution

Node flows execute immutable published snapshots. A run explicitly pins a published version or follows the latest published version; later edits cannot change a pinned run.

Distributed runners are authenticated service principals with `automation_runner` and explicit project scope. Queue claims use a database compare-and-set lease, and heartbeats renew only for the current owner. Outbox idempotency combines publication, run, node, and logical item, so restart reconstruction returns prior sent rows instead of duplicating external effects. Unknown outcomes require attention; approvals, attempts, credential access, and delivery emit redacted correlation audit records.

Runs are durably queued and leased with bounded global and project concurrency. Node attempts retain attempt number, executor and invocation identity, artifact digest, redacted payloads, credential ids, failure class, and retry decision. Retryable failures use bounded exponential backoff and jitter, while cancellation and timeout signals propagate to provider and HTTP work.

On restart, expired pre-invocation work is safely requeued. Work with an external invocation and an unknown outcome moves to `attention_required` and is never silently replayed. Credential values are resolved only for the active node and are not retained in run history or diagnostics.
