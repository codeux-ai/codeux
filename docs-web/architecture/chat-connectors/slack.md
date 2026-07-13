# Slack Connector Profile

Slack implements `managed_bridge`, explicit custom `webhook`, and direct `official_api` transports. The custom webhook remains a generic configured bridge URL; only official mode uses Slack APIs, with fixed `https://slack.com/api/auth.test` and `https://slack.com/api/chat.postMessage` endpoints.

## Official ingress

Official Events API requests accept only Slack's timestamp and signature headers. The shared security facade computes HMAC-SHA256 over the exact `v0:<timestamp>:<raw-body>` base, enforces Slack's five-minute freshness window, compares in constant time, and replay-checks authenticated requests. See Slack's [request verification](https://api.slack.com/docs/verifying-requests-from-slack) and [Events API](https://api.slack.com/apis/connections/events-api) documentation.

The profile declares synchronous `url_verification` challenge handling and immediate HTTP 200 acknowledgement for event callbacks. Processing is scheduled only after the response is sent, so model execution and outbound delivery cannot consume Slack's three-second response window.

Message callbacks normalize outer `event_id`, channel, user, message `ts`, and parent `thread_ts`. Bot-authored callbacks, Code UX-marked connector messages, and message changes without usable text are acknowledged without dispatch. The outer event ID remains the persisted deduplication boundary.

## Official outbound and verification

`chat.postMessage` payloads contain accessible top-level text and reuse the parent `thread_ts` for replies. The profile marks outbound requests with a per-connection/per-channel one-second pacing key. The HTTP facade checks Slack JSON `ok`/`error` envelopes independently of status, treats 429 as retryable, converts `Retry-After` seconds into the persisted retry schedule, and redacts Slack token shapes from failures. See [`chat.postMessage`](https://api.slack.com/methods/chat.postMessage) and [rate limits](https://api.slack.com/apis/rate-limits).

Official live verification builds an [`auth.test`](https://api.slack.com/methods/auth.test) request. Its pure response mapper reports bot-token validity, bot identity, configured-workspace binding, `chat:write` scope state, and the fact that channel membership is confirmed on delivery. The diagnostics do not expose returned workspace, user, bot, or token identifiers.

The profile remains side-effect free at registry construction. HTTP execution, timing-safe comparison, replay state, pacing, retry scheduling, and redaction stay in provider-neutral service facades.
