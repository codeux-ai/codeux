# Chat Connector Runtime Reliability

External connector callbacks and replies cross process, network, and provider boundaries. The connector runtime separates durable state changes from slow model, fetch, command, and reconnect work. Provider-specific policy comes from the typed connector registry; shared services own persistence, leases, cancellation, scheduling, and redacted observability.

## Ingress acceptance

`ChatProviderIngressService.acceptInbound()` resolves the mode-aware provider profile, normalizes the callback, resolves provider conversation identity, selects an enabled binding, and atomically inserts the inbound delivery. The insert is the idempotency boundary: concurrent callbacks for the same provider connection and external message id receive one delivery, and only the insertion winner can invoke dashboard chat.

Profiles define authentication, handshake, ignore/classification behavior, acknowledgement response, immediate modes, and callback deadline. Immediate routes authenticate and persist first, send the profile acknowledgement, and then call `processAccepted()` outside the HTTP request. Accepted work contains the selected binding, project, plain message body, provider conversation/thread keys, and internal thread routing needed for restart recovery. Chat failures after acknowledgement transition the delivery to `failed`; they do not turn an accepted callback into an HTTP retry loop.

Unbound channels remain durable `failed` ingress records with `unbound_channel` state. Ambiguous shared channels remain `pending` with candidate binding/project ids and `disambiguation_needed` state. Neither path guesses a project.

## External chat turns

Ingress message metadata carries the provider connection, binding, conversation and thread keys, inbound delivery id, selected agent preset, and the binding's `suppressRichWidgets` value. `ChatThreadRuntimeService` applies those overrides only to the current external turn. A later dashboard-originated turn uses dashboard routing and rich-widget behavior normally.

## Outbound leases and retries

Every send, including the first attempt, claims its delivery through a compare-and-set lease. Pollers are single-flight within a process, while SQLite leases prevent another process from sending the same row. Expired `sending` leases are claimable after restart.

Retryable failures use capped exponential backoff with bounded jitter. Provider `Retry-After` metadata replaces the calculated delay for the durable `next_attempt_at` schedule. A transport failure in a profile-declared ambiguous mode is terminal because the provider may already have accepted the message. Manual cancellation writes terminal `cancelled` state before aborting the active adapter, so completion cannot revive the delivery.

Manual retry is an explicit delivery-control operation, not a status edit. REST requires a confirmed approval payload and MCP uses a one-use, exact-redacted-payload approval. The service returns the new sanitized delivery state and never returns the durable request payload.

## Connection verification and health

`ChatProviderVerificationService` resolves credentials ephemerally, runs the selected profile's required-field validation, and performs a bounded live check only for modes that advertise it. Outcomes persist as `verified` or `failed` with timestamp, capabilities, stable provider error code, retryability, setup guidance, and sanitized diagnostics. Raw credentials, authorization headers, signed URLs, provider payload text, and response bodies are excluded.

The connector health endpoint aggregates only persisted state: configured, active, verified, and error counts plus last outcomes. It performs no network calls and is intentionally separate from `/health` and `/ready`, so an optional provider outage cannot make the Code UX runtime unready.

## Provider sessions

`ChatProviderSessionRuntimeService` interprets each profile's `session.required` and `session.scope` declarations. A runtime driver is optional; connectors without a managed session driver do not affect dashboard readiness. With a driver, durable session rows use compare-and-set transitions across `pending`, `connecting`, `connected`, `retry_wait`, `resumable`, and terminal states.

Reconnect attempts are capped and jittered, with at most one timer and active controller per bounded persisted session. Startup resumes nonterminal sessions. Shutdown clears reconnect timers, aborts active runs, persists shutdown-interrupted work as `resumable`, and waits for jobs to settle before storage is closed.

## Lifecycle and logging

Dashboard startup launches ingress recovery, session recovery, and outbound stale-lease recovery independently. The production factory shares the same registry-backed secret, verification, ingress, outbound, and session service instances across REST routes, dashboard chat management, standalone MCP management, and lifecycle hooks. Connector failures are logged without blocking the dashboard server or global readiness. Repeated starts are idempotent.

Shutdown order is ingress processing, outbound delivery, provider sessions, then the dashboard server handle. Structured connector logs carry correlation id, provider kind, connection, binding, delivery/session id, attempt, latency, outcome or session transition, retry time, and a redacted provider error code. Callback text, reply text, raw payloads, and credentials are not log metadata by default.

## Verification targets

Connector runtime tests cover concurrent duplicate acceptance, post-ack chat failure, ambiguous routing, lease contention, `Retry-After`, terminal cancellation, stale-send recovery, repeated start/stop, restart session resume, and shutdown timer cleanup. No database transaction spans model execution, fetch, command execution, or reconnect waits.

The fan-in acceptance harness lives in `tests/backend/integration/chat-connectors-e2e.test.ts`, with provider-shaped synthetic payloads in `tests/fixtures/chat-connectors/`. It drives all six profiles through connection verification, approved local-project binding, authenticated ingress, chat reply, mocked delivery, restart recovery, and matching redacted REST/MCP inspection. The dashboard counterpart in `tests/e2e/settings/chat-connectors.spec.ts` exercises the real settings workflow and mocks only the provider delivery boundary.

`tests/backend/integration/chat-connectors-live.test.ts` is an optional evidence lane. It is disabled unless `CODEUX_CHAT_CONNECTOR_LIVE_TESTS=1` and reports missing credentials as explicit skips. The lane only permits fixed HTTPS endpoints for Meta phone-number lookup, Telegram `getMe`, Slack `auth.test`, and Discord current-user lookup; Teams and iMessage live requests are rejected. A Meta test-number send additionally requires `CODEUX_CHAT_CONNECTOR_WHATSAPP_TEST_SEND=1`, the test phone-number id, and a synthetic test recipient. Meta lookup and send paths reject fixture-like access tokens before constructing a provider request. Redirects, non-allowlisted hosts, and production-looking fixture labels fail closed, and results record only the provider, evidence source, endpoint class, and sanitized outcome.
