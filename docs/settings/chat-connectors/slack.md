# Slack Chat Connector

The Slack profile supports three distinct connection modes:

- `managed_bridge` keeps the Code UX managed plugin contract (`pluginName`, optional `workspaceId`, and write-only `bridgeApiKey`).
- `webhook` remains an explicit custom integration. It posts the legacy bridge payload to the configured `eventsUrl`/outbound webhook URL and retains the existing compatible signature forms. Code UX does not treat that configurable URL as a Slack Web API endpoint.
- `official_api` receives Slack Events API callbacks and sends replies through Slack's Web API. It never accepts a configurable API base URL.

## Official API setup

Configure the Slack app ID, workspace ID, and optional workspace display name. Save the app signing secret and bot token in the write-only secret fields; saved values are represented only as configured/redacted credential metadata.

In the Slack app configuration:

1. Set the Events API Request URL to the connection-specific Code UX ingress URL.
2. Subscribe the bot to the message events required for the channels it should serve.
3. Grant the bot `chat:write`, reinstall the app when Slack requires it, and invite the bot to private or otherwise restricted channels.

The Request URL must preserve the raw request body. Official ingress accepts only `X-Slack-Request-Timestamp` and `X-Slack-Signature`, signs exactly `v0:<timestamp>:<raw-body>`, rejects timestamps outside Slack's five-minute window, and uses a constant-time signature comparison. See Slack's [request verification guide](https://api.slack.com/docs/verifying-requests-from-slack).

## Events and acknowledgement

Code UX returns an authenticated `url_verification` challenge synchronously. For message callbacks that enter chat, Code UX authenticates the exact request, normalizes the message and thread identity, performs project and channel-binding resolution, and durably inserts the inbound delivery before returning HTTP 200. Model processing and outbound delivery start asynchronously after that acknowledgement. Slack requires a 2xx response within three seconds and recommends queueing slow work after acknowledgement; a slow model or Slack reply therefore cannot hold the Events API request open. See the [Events API response guidance](https://api.slack.com/apis/connections/events-api).

For message callbacks, Code UX uses outer `event_id` as the inbound idempotency key and normalizes the channel, user, message `ts`, and parent `thread_ts`. Replies use the parent timestamp so an existing Slack thread remains intact. The connector acknowledges but does not dispatch:

- bot-authored messages
- connector-generated messages marked with Code UX event metadata
- message-change callbacks that have no usable text
- unsupported callbacks or textless message events

## Outbound delivery and limits

Official replies are JSON POSTs to the fixed `https://slack.com/api/chat.postMessage` endpoint. Every message includes complete top-level `text` for notification and screen-reader accessibility; thread replies include `thread_ts`. See [`chat.postMessage`](https://api.slack.com/methods/chat.postMessage).

The runtime checks Slack's `ok`/`error` envelope even when HTTP itself succeeded. It treats missing scopes, invalid/revoked tokens, and missing channel membership as terminal capability failures. Transient Slack errors remain retryable. Official requests are paced to one message per second per channel, and HTTP 429 responses preserve Slack's `Retry-After` value in seconds when scheduling the next attempt. See Slack's [rate-limit guidance](https://api.slack.com/apis/rate-limits).

## Verification diagnostics

The live official-mode check calls the fixed `https://slack.com/api/auth.test` endpoint. It verifies that Slack accepts the token, the token resolves to a bot, and the returned workspace matches the configured workspace. It requires an explicitly configured test bot token; a credential-gated skip is not a pass. When Slack reports granted scopes, the check diagnoses a missing `chat:write` scope. Channel membership is confirmed by `chat.postMessage`; `not_in_channel` is returned as a channel-membership capability failure. Diagnostics describe the capability state without echoing Slack workspace, user, bot, or token identifiers. See [`auth.test`](https://api.slack.com/methods/auth.test).

Slack token-shaped values are redacted from errors, persisted delivery metadata, audit/log output, and snapshots.
