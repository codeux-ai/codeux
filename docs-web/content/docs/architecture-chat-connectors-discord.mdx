# Discord Connector Profile

Discord has two independently selected transports. Existing `webhook` mode preserves custom bot/gateway URLs. Provider-native `official_api` owns Discord HTTP interaction authentication, Gateway v10 delivery, REST replies, and read-only current-user verification. The custom gateway is not represented as Discord-certified.

## Official setup and trust boundary

Official setup requires application ID, hexadecimal Ed25519 public key, Gateway intents, and a write-only bot token. Default intents `37377` include `GUILDS`, `GUILD_MESSAGES`, `DIRECT_MESSAGES`, and privileged `MESSAGE_CONTENT`; operators must enable the latter in the Developer Portal.

Official REST is pinned to `https://discord.com/api/v10`. Gateway and resume URLs must be secure Discord-owned `discord.gg` hosts. Custom URL fields retained for webhook compatibility cannot redirect official traffic.

## Interaction ingress and identity

Code UX validates `X-Signature-Ed25519` against `X-Signature-Timestamp` plus exact raw bytes before parsing. Missing/malformed/stale/mismatched input fails deterministically. Authenticated type-1 validation receives JSON PONG. Commands, components, modals, and Gateway `MESSAGE_CREATE` dispatches normalize to stable snowflake channel/sender/message/thread identities and then enter durable binding/idempotency handling.

## Gateway recovery

The session state machine implements Identify/Resume, sequence tracking, jittered heartbeats, ACK enforcement, bounded reconnect backoff, re-identification after invalid sessions, and terminal auth/intents classifications. Persisted state contains only session ID, validated resume URL, sequence, and bot user ID. Cancellation/shutdown stop timers and reconnects. Self-authored messages are ignored.

## REST replies and verification

Message creation disables automatic mentions, uses a stable nonce with `enforce_nonce`, preserves reply references, and accepts only snowflake response IDs. Route/global reset headers and `Retry-After` receive one bounded immediate 429 retry before durable scheduling.

Credential verification calls only `GET /users/@me` and requires a test bot token. A credential-gated skip is not a live pass. Results classify invalid auth, permissions, rate limits, timeout/cancellation, ambiguous network outcome, provider availability, invalid responses, intents, and privileged-intent access without token-bearing details.

References: [Gateway](https://docs.discord.com/developers/events/gateway), [Gateway events](https://docs.discord.com/developers/events/gateway-events), [Interactions](https://docs.discord.com/developers/interactions/overview), [current user](https://docs.discord.com/developers/resources/user#get-current-user), [messages](https://docs.discord.com/developers/resources/message), and [rate limits](https://docs.discord.com/developers/topics/rate-limits).
