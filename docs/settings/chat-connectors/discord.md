# Discord Chat Connector

Discord supports the existing `webhook` bridge and a provider-native `official_api` mode. Existing webhook records keep their configured gateway behavior; switching to `official_api` is explicit. Registry presence advertises a typed contract only. It does not certify a custom gateway or prove that a particular Discord application is production-ready.

## Setup modes

### Official API

Configure these values from the Discord Developer Portal:

- `applicationId`: the Discord application snowflake.
- `publicKey`: the 32-byte hexadecimal Ed25519 Interactions public key. It is public setup, not a bot credential.
- `intents`: the Gateway intents bitfield. The default `37377` includes `GUILDS`, `GUILD_MESSAGES`, `DIRECT_MESSAGES`, and `MESSAGE_CONTENT`.
- `botToken`: a required write-only secret.

Enable the privileged `MESSAGE_CONTENT` intent before starting the connector. Without it, ordinary `MESSAGE_CREATE` events may omit `content`; Discord can close a Gateway session with code `4014` when the application requests a privileged intent it cannot use.

Official transport pins REST calls to `https://discord.com/api/v10` and Gateway connections to secure Discord-owned `wss://*.discord.gg` hosts. A custom `gatewayUrl`, webhook URL, bridge URL, or untrusted resume URL cannot replace those origins in `official_api` mode.

### Webhook compatibility

The `webhook` mode retains the custom bot/gateway contract: optional `gatewayUrl` and `applicationId`, required `botToken`, and optional `webhookSecret`. Outbound requests continue to use the configured gateway URL and the shared bridge authentication/response contract. Code UX does not represent that operator-selected gateway as Discord-certified.

## HTTP interactions

Discord signs HTTP interactions with `X-Signature-Ed25519` and `X-Signature-Timestamp`. Code UX verifies the signature over the timestamp concatenated with the exact raw request body, applies a five-minute freshness window, and rejects missing, malformed, stale, or mismatched authentication. Reserializing JSON before verification changes the signed bytes and must fail.

An authenticated interaction with `type: 1` receives HTTP `200` and `{ "type": 1 }`. Supported command, component, and modal interactions normalize to stable channel, sender, message, and thread identities. PING stops at the handshake response; other authenticated interactions continue through binding selection and durable inbound idempotency.

## Gateway session and reconnects

Official message delivery uses Gateway v10 with JSON encoding. A session:

1. waits for `Hello`, schedules the first heartbeat with Discord's jitter, and sends `Identify`;
2. records dispatch sequence and persists only session ID, validated resume URL, sequence, and bot user ID;
3. sends `Resume` after resumable disconnects and falls back to `Identify` after invalid or expired sessions;
4. reconnects after a missed heartbeat acknowledgement with bounded exponential backoff; and
5. stops heartbeats and reconnect timers on cancellation or runtime shutdown.

Only `MESSAGE_CREATE` dispatches enter chat ingress. Messages authored by the connected bot user are ignored to prevent reply loops.

## Replies, idempotency, and rate limits

Replies use `POST /channels/{channel.id}/messages` on API v10. Code UX sends `allowed_mentions.parse: []`, a stable delivery nonce with `enforce_nonce: true`, and a `message_reference` when replying. Returned IDs must be valid snowflakes before they are stored.

The client honors route and global rate-limit state plus Discord's retry interval, with at most one immediate 429 retry. Further throttling returns a retryable failure to the durable delivery scheduler. The stable nonce complements the shared SQLite delivery lease, but operators should still inspect an ambiguous provider outcome before manually retrying.

## Verification and test eligibility

The provider-native credential check is read-only and calls `GET https://discord.com/api/v10/users/@me`. It requires an explicitly supplied test bot token. A credential-gated test that skips because no token is configured is **not** a passed live check.

Results distinguish invalid authentication, missing delivery permissions, rate limiting, timeout/cancellation, ambiguous network outcomes, provider unavailability, invalid responses, invalid Gateway intents, and unavailable privileged intents. Diagnostics are bounded and token-free.

Official references: [Gateway](https://docs.discord.com/developers/events/gateway), [Gateway events](https://docs.discord.com/developers/events/gateway-events), [Interactions](https://docs.discord.com/developers/interactions/overview), [current user](https://docs.discord.com/developers/resources/user#get-current-user), [messages](https://docs.discord.com/developers/resources/message), and [rate limits](https://docs.discord.com/developers/topics/rate-limits).
