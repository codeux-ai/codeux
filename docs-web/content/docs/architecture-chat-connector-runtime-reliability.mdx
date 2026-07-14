# Chat connector runtime reliability

External connector callbacks and replies cross process, network, and provider boundaries. Code UX separates durable state changes from model, fetch, command, and reconnect work. Provider-specific policy comes from the connector registry; shared services own persistence, leases, cancellation, scheduling, and redacted observability.

## Durable ingress

The ingress service authenticates through the mode-aware profile, normalizes provider data, resolves conversation identity, selects a binding, and atomically inserts an inbound delivery. Concurrent callbacks for the same provider message share one delivery, and only the insertion winner can create a conversation message.

For profile-declared immediate modes, Code UX persists accepted work before returning the profile acknowledgement. Chat processing runs afterward. A later model failure is recorded on the accepted delivery and does not ask the provider to retry indefinitely. Unbound and ambiguous callbacks remain durable without guessing a project.

Provider conversation and thread keys, the binding's selected agent preset, and its `suppressRichWidgets` setting travel in chat metadata. These overrides apply only to external connector turns; dashboard-originated turns retain normal routing and rich widgets.

## Leased outbound delivery

Every outbound attempt claims a SQLite lease. Retry workers are single-flight in one process and competing runtimes cannot claim the same active lease. Expired `sending` leases are recovered after restart.

Retryable failures use capped exponential backoff with bounded jitter, while provider `Retry-After` metadata replaces the calculated next-attempt delay. Profile-declared ambiguous transport outcomes are terminal because the provider may already have accepted the send. Manual cancellation writes terminal state before aborting the adapter.

## Resumable sessions and lifecycle

The session runtime consumes each profile's required/session-scope declarations. Managed drivers are optional, so unavailable or disabled connectors never block dashboard readiness. Durable sessions resume after restart with bounded reconnect attempts and one timer/controller per session.

Shutdown clears reconnect and retry timers, aborts ingress, fetch, command, and session work, releases owned leases safely, and settles connector jobs before the server/storage boundary closes. Structured logs include correlation, provider, connection, binding, delivery/session, attempt, latency, outcome, retry time, transition, and redacted error code—never payload or credential text by default.
