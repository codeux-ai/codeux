# Discord Connector Profile

Discord has two independently selected transports. The existing `webhook` mode preserves custom bot/gateway URLs and stored connection compatibility. The provider-native `official_api` mode owns Discord HTTP interaction authentication, Gateway v10 message delivery, REST replies, and read-only credential verification.

## Official configuration and trust boundary

The official setup requires an application ID, the application's hexadecimal Ed25519 public key, a Gateway intents bitfield, and a write-only bot token. The default bitfield is `37377`: `GUILDS`, `GUILD_MESSAGES`, `DIRECT_MESSAGES`, and privileged `MESSAGE_CONTENT`. Operators must enable `MESSAGE_CONTENT` in the Discord Developer Portal to receive ordinary message bodies.

Official REST requests are pinned to `https://discord.com/api/v10`. Gateway and resume URLs must use secure Discord-owned `discord.gg` hosts. Values retained for legacy webhook connections cannot redirect official traffic. Bot tokens, interaction tokens, and authorization headers are excluded from persisted Gateway state and delivery metadata.

## Interaction ingress

The profile validates `X-Signature-Ed25519` against `X-Signature-Timestamp` plus the exact raw body before JSON parsing. Missing or malformed headers, malformed keys, stale timestamps, invalid signatures, malformed JSON, and unsupported interaction shapes produce deterministic classified failures. Authenticated type-1 validation requests receive the required JSON PONG response.

`ChatProviderIngressSecurity` invokes the optional provider-native hook before generic bearer/HMAC handling. The production ingress route returns an immediate authenticated handshake response when present and otherwise continues into the existing ingress service.

Application command, component, and modal payloads normalize into stable external channel, sender, interaction-message, and Discord thread identities. Gateway `MESSAGE_CREATE` payloads use the same normalized contract.

## Gateway state machine

`DiscordGatewaySession` is transport- and persistence-neutral. It receives injected WebSocket, timer, delay, and session-store boundaries so unit tests are completely offline.

The state machine implements:

- `Identify` and `Resume` payloads for Gateway v10;
- latest dispatch sequence tracking;
- first-heartbeat jitter, recurring heartbeats, ACK tracking, and immediate reconnect after a missed ACK;
- persistence of only `sessionId`, Discord resume URL, sequence, and bot user ID;
- resume after recoverable closes and re-identify after invalid sequence, timed-out session, or non-resumable invalid-session responses;
- bounded exponential reconnect backoff;
- terminal classifications for invalid auth, invalid intents, missing privileged intent access, shard errors, and unsupported Gateway versions;
- cancellation and clean shutdown that stop timers, close the socket, and prevent reconnects.

The bot user ID from `READY` suppresses the connector's own `MESSAGE_CREATE` events without suppressing messages from unrelated bot accounts.

## REST replies and verification

Message creation disables all automatic mentions with `allowed_mentions.parse: []`, supplies a stable delivery nonce with `enforce_nonce`, preserves reply references, and accepts only snowflake message IDs from successful responses. Route/global reset headers and `Retry-After` are honored with one bounded immediate 429 retry; further rate limits are returned to the outer delivery scheduler.

The configured outbound adapter caches the profile's official executor, preserving Discord rate-limit state across production deliveries. Profiles without an executor, including Discord `webhook`, retain the generic HTTP or command path.

Credential verification performs only `GET /users/@me`. Typed results distinguish invalid authentication, missing permissions, rate limiting, timeout, cancellation, ambiguous network outcomes, provider unavailability, and invalid responses without retaining token-bearing messages.

The profile remains side-effect free when the registry is constructed. Network and Gateway work begins only when the corresponding runtime client or session is explicitly started.

References: [Gateway](https://docs.discord.com/developers/events/gateway), [Gateway events](https://docs.discord.com/developers/events/gateway-events), [Interactions](https://docs.discord.com/developers/interactions/overview), [Messages](https://docs.discord.com/developers/resources/message), and [Rate limits](https://docs.discord.com/developers/topics/rate-limits).
