# Discord Chat Connector

Discord supports the existing `webhook` bridge and a provider-native `official_api` mode. Existing stored webhook connections keep their current setup and routing behavior; changing to `official_api` is explicit.

## Setup modes

### Official API

Configure these values from the Discord Developer Portal:

- **Application ID**: the Discord application snowflake.
- **Interactions public key**: the 32-byte hexadecimal Ed25519 public key. This is public configuration, not a bot credential.
- **Gateway intents bitfield**: defaults to `37377` (`GUILDS`, `GUILD_MESSAGES`, `DIRECT_MESSAGES`, and `MESSAGE_CONTENT`).
- **Bot token**: a required write-only secret. Code UX redacts it from connection responses and never stores it in Gateway session state or delivery metadata.

`MESSAGE_CONTENT` is a privileged Gateway intent. Enable it on the application's **Bot** page in the Developer Portal before starting the connector. Without it, ordinary `MESSAGE_CREATE` events may omit `content`; Discord can close the Gateway with code `4014` when a privileged intent is requested without access.

The official connector controls its network destinations. REST calls use only `https://discord.com/api/v10`, and Gateway connections use Discord-owned `wss://*.discord.gg` hosts. A saved `gatewayUrl`, webhook URL, bridge URL, or an untrusted resume URL cannot replace those origins in `official_api` mode.

### Webhook compatibility

The `webhook` mode retains the stored bot/webhook gateway contract:

- optional `gatewayUrl` and `applicationId`
- required `botToken`
- optional `webhookSecret`

Outbound requests continue to use the configured custom gateway URL and the shared legacy bridge authentication and response parsing behavior.

## HTTP interactions

Discord signs each HTTP interaction with `X-Signature-Ed25519` and `X-Signature-Timestamp`. Code UX verifies the signature over the timestamp concatenated with the exact raw request body, checks a five-minute freshness window, and rejects missing, malformed, stale, or mismatched authentication with a deterministic `400` or `401` result. Parsing or reserializing JSON before signature verification is not safe because it changes the signed bytes.

An authenticated interaction with `type: 1` receives HTTP `200`, JSON content type, and `{ "type": 1 }` as required by Discord's endpoint validation. Supported command, component, and modal interactions normalize to stable Discord channel, sender, interaction-message, and thread identities.

The normal chat-provider ingress route invokes this provider-native verification before acknowledgement or message routing. PING requests stop at the handshake response; other authenticated interactions continue through the existing binding, idempotency, and conversation delivery path.

## Gateway delivery

Official message delivery uses Gateway v10 with JSON encoding. A connection:

1. waits for `Hello`, starts the first heartbeat at Discord's randomized jitter offset, and sends `Identify`;
2. records every dispatch sequence and persists only `session_id`, `resume_gateway_url`, sequence, and the bot user ID;
3. sends `Resume` after resumable disconnects and falls back to `Identify` after invalid or expired sessions;
4. reconnects when a heartbeat is not acknowledged, using bounded exponential backoff;
5. stops all heartbeat and reconnect work on cancellation or shutdown.

Only `MESSAGE_CREATE` dispatches are normalized for chat ingress. Messages authored by the connected bot user are ignored to prevent reply loops.

## Replies and rate limits

Replies use `POST /channels/{channel.id}/messages` on API v10. Code UX always sends `allowed_mentions.parse: []`, a stable delivery nonce with `enforce_nonce: true`, and a Discord `message_reference` when replying to an inbound message. Returned message IDs must be valid snowflakes before they are recorded.

The client tracks route and global rate-limit headers, waits for Discord's `Retry-After` or reset interval, and performs at most one immediate 429 retry. Persistent rate limiting returns a retryable classified failure to the shared delivery scheduler rather than creating an internal retry storm.

The shared outbound service retains one Discord executor for official deliveries, so rate-limit state is reused across attempts. The custom `webhook` mode continues through the legacy configured-URL adapter.

## Credential verification and failures

Credential verification is read-only and calls only `GET https://discord.com/api/v10/users/@me`. Results distinguish:

- invalid bot authentication (`401`)
- missing channel permissions (`403` during delivery)
- rate limiting (`429`)
- request timeout or cancellation
- ambiguous network outcome
- temporary provider failure and invalid provider responses
- invalid Gateway intents and unavailable privileged intents

Errors and verification results use bounded, token-free messages. Live credential tests are separate from unit tests; deterministic unit fixtures use mocked HTTP and Gateway transports and never contact Discord.

Official references: [Gateway](https://docs.discord.com/developers/events/gateway), [Gateway events](https://docs.discord.com/developers/events/gateway-events), [Interactions](https://docs.discord.com/developers/interactions/overview), [Messages](https://docs.discord.com/developers/resources/message), and [Rate limits](https://docs.discord.com/developers/topics/rate-limits).
