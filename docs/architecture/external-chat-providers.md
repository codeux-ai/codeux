# External Chat Providers

Code UX keeps external chat connectors separate from MCP listener connections and dashboard conversation transport. A connector profile declares setup, ingress authentication, normalization, identity, provider-native or bridge outbound behavior, verification, and session requirements. Shared services own encrypted credentials, project routing, durable ingress idempotency, outbound leases, cancellation, recovery, and redacted diagnostics.

Registry presence means that Code UX advertises a typed connector contract. It does **not** mean that a provider has certified Code UX, that an operator-selected bridge is provider-certified, or that a particular connection is ready for production.

## Transport boundaries

- `official_api` calls only the provider-owned endpoints declared by that profile. WhatsApp, Telegram, Slack, Microsoft Teams, and Discord have provider-native contracts.
- `managed_bridge` sends to a separately configured managed HTTP bridge. The bridge operator owns its provider relationship and availability.
- `webhook` sends to an operator-configured custom URL. Code UX validates its own bridge contract but does not treat the URL as a provider API.
- `native_bridge` runs an operator-configured local command without shell interpretation. iMessage uses this third-party/local contract; Code UX does not expose an Apple personal-iMessage bot API.

Unsupported provider/mode combinations fail validation. Existing managed, webhook, and native records retain their prior endpoint meaning when provider-native modes are added.

## Six-provider contract matrix

### Setup, ingress, identity, and outbound

| Provider | Supported modes | Required provider-native setup and secrets | Ingress authentication | Message and thread identity | Outbound endpoint behavior |
| --- | --- | --- | --- | --- | --- |
| Meta WhatsApp | `managed_bridge`, `webhook`, `official_api` | Graph version and phone-number ID; write-only access token, app secret, and webhook verify token. | GET challenge compares the verify token; POST verifies `X-Hub-Signature-256` over exact raw bytes with the app secret. Meta callbacks do not carry the shared timestamp header. | Business `phone_number_id` is the channel; inbound `wamid` is the message/idempotency key; sender WhatsApp ID is the reply recipient. | Official sends are pinned to `https://graph.facebook.com/{version}/{phoneNumberId}/messages`; bridge modes use only their configured URLs. |
| Apple iMessage | `managed_bridge`, `native_bridge` | Managed bridge workspace/device plus bridge API key, or local command/working directory plus bridge token. | Shared fresh timestamp, bearer token, and replay nonce/request ID for bridge callbacks. There is no Apple webhook authentication contract. | Bridge-supplied chat and message GUIDs are opaque, Unicode-normalized identifiers; no undocumented Apple structure is inferred. | Managed mode posts protocol v1 to the configured third-party bridge; native mode writes protocol v1 JSON to command stdin with `shell: false`. No Apple endpoint is called. |
| Telegram | `managed_bridge`, `webhook`, `official_api` | Optional bot username; write-only bot token and webhook secret token. | Official webhook requires exact `X-Telegram-Bot-Api-Secret-Token`; no Code UX timestamp/HMAC headers are invented. | `update_id` plus chat/message IDs form durable identity; `message_thread_id` preserves forum/private topic replies. | Official calls the fixed `https://api.telegram.org/bot<token>/sendMessage`; the token-bearing URL is never persisted or logged. |
| Slack | `managed_bridge`, `webhook`, `official_api` | App/workspace metadata; write-only signing secret and bot token. | Official Events requests require Slack `v0` HMAC over timestamp and exact raw body and a five-minute freshness window. | Outer `event_id` is the idempotency key; channel plus `ts`/`thread_ts` preserve message and parent thread. | Official replies use only `https://slack.com/api/chat.postMessage`; legacy webhook URLs are custom bridge endpoints, not Slack Web API bases. |
| Microsoft Teams | `managed_bridge`, `webhook`, `official_api` | App ID, `MultiTenant`/`SingleTenant`, tenant ID when required, and write-only client secret. | Official Activities require fully validated Bot Connector Bearer JWTs, claims, endorsement, tenant policy, and documented service URL. | Activity ID, conversation ID, reply ID, tenant/team/channel IDs, and authenticated conversation reference are retained; credentials are not. | OAuth uses Microsoft's fixed authority; replies use only the authenticated `{serviceUrl}/v3/conversations/{conversationId}/activities/{activityId}`. |
| Discord | `webhook`, `official_api` | Application ID, Ed25519 public key, Gateway intents, and write-only bot token. | HTTP interactions use Ed25519 over timestamp plus exact raw body; Gateway sessions authenticate with the bot token. | Discord snowflakes identify messages/channels; thread IDs are preserved; the connected bot user is ignored to prevent loops. | Official REST is pinned to `https://discord.com/api/v10`; Gateway/resume hosts must be Discord-owned secure `discord.gg` endpoints. |

### Verification, retry/idempotency, sessions, and limitations

| Provider | Verification and live-test eligibility | Retry and idempotency guarantee | Session/reconnect behavior | Known limitations |
| --- | --- | --- | --- | --- |
| Meta WhatsApp | Read-only phone-number resource verification uses configured credentials. A message-send test is a separate, explicit Meta test-number opt-in; a skipped opt-in check is not a pass. | Inbound `wamid` dedupe is durable. Graph retry classification is sanitized; manual retry may duplicate a message if the provider accepted an ambiguous attempt. | Webhook transport is stateless; no provider session is persisted. | Official text and supported media captions only; test-number eligibility is not general production readiness. |
| Apple iMessage | Validates the configured third-party bridge and protocol health only. Apple publishes no public personal-iMessage bot sandbox or provider-native endpoint check. | GUID-based ingress dedupe plus shared delivery leases. Command timeout/cancellation terminates the process group; retryability comes from the bridge's protocol error. | The operator's third-party bridge owns its session. Code UX can resume its durable connection-scoped state but does not manage an Apple session. | No `official_api`, Apple certification, Messages database access, AppleScript automation, or public bot sandbox is claimed. |
| Telegram | Official verification calls `getMe` and read-only `getWebhookInfo`; it requires test bot credentials and never changes the webhook. | Durable update/message dedupe. Exact `retry_after` is honored for 429. Transport failures after dispatch are treated as ambiguous/terminal to avoid automatic duplicates. | Webhook mode is stateless; no long-poll session is opened. | `sendMessage` text is bounded to 4,096 characters; webhook registration remains an operator action. |
| Slack | Official verification calls `auth.test` with a test bot token and checks configured workspace identity/capability. Missing credentials mean not run, not passed. | `event_id` dedupe precedes chat work. Callbacks are acknowledged after durable insert. Per-channel pacing and `Retry-After` are honored; ambiguous send transport is terminal. | Events webhook is stateless; no Socket Mode session is opened. | Bot scopes, installation, membership, and provider rate limits remain operator responsibilities. |
| Microsoft Teams | No public unauthenticated sandbox. Deterministic tests use Emulator-shaped Activities and mocked OpenID/JWKS/OAuth/Connector boundaries; they do not prove a live tenant deployment. | Activity IDs dedupe inbound work. 429/transient service errors are retryable; invalid JWT/claims/tenant/service URL are terminal. | Durable authenticated conversation references support replies; OAuth tokens are memory-only. There is no fake sandbox session. | Only message Activities enter chat; localhost is not trusted as an official Connector service URL. |
| Discord | Read-only current-user verification calls `GET /users/@me` and requires a test bot token. Credential-gated skips are not passes. | Inbound event/message IDs dedupe. Outbound uses a stable nonce and `enforce_nonce`; route/global 429 state is honored before durable retry. | Gateway v10 persists sequence/session/resume state, heartbeats, resumes recoverable sessions, re-identifies invalid sessions, and uses bounded reconnect backoff. | `MESSAGE_CONTENT` is privileged; permissions and application verification remain Discord-controlled. |

Provider-controlled references: [Meta WhatsApp Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api), [Meta Webhooks](https://developers.facebook.com/docs/graph-api/webhooks/getting-started), [Apple Messages framework](https://developer.apple.com/documentation/messages), [Apple iMessage apps](https://developer.apple.com/imessage/), [Telegram Bot API](https://core.telegram.org/bots/api), [Slack Events API](https://docs.slack.dev/apis/events-api/), [Slack Web API `chat.postMessage`](https://api.slack.com/methods/chat.postMessage), [Microsoft Bot Connector authentication](https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-authentication?view=azure-bot-service-4.0), [Microsoft Bot Connector messages](https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-send-and-receive-messages?view=azure-bot-service-4.0), [Discord Gateway](https://docs.discord.com/developers/events/gateway), [Discord Interactions](https://docs.discord.com/developers/interactions/overview), and [Discord messages](https://docs.discord.com/developers/resources/message).

## Durable security and lifecycle contracts

### Secrets and legacy migration

New connector secrets are sealed as AES-256-GCM envelopes through `ChatProviderSecretService`; public records expose only configured-state metadata. Runtime services resolve plaintext ephemerally and do not obtain it from public repository reads.

At startup, legacy `secret_json` rows are migrated one at a time after the key provider reports secure readiness. Each migration seals first, then uses connection ID, legacy JSON, and secret version in a compare-and-set transaction before clearing plaintext. Failure leaves the original row intact for a later retry; partial migration is resumable and logged as a security warning. Operators must restore the same key provider, rerun startup/migration, and confirm `pending: 0`. Do not "roll back" by copying secrets back to plaintext. A database restore also requires the matching key material/version.

Secret replacement, secret clearing, bridge-mode change, or setup change increments/updates transport state and resets verification to `unverified`; display name, enabled flag, and lifecycle status alone preserve the last verification result. Active connections with transport changes return to draft/error flow until reverified.

### Authorization and approvals

- Remote connection create/update and `verify` require TLS, `credential_admin`, and `CODE_UX_REMOTE_CREDENTIAL_MANAGEMENT=true`.
- Bindings and deliveries authorize against the project stored on the binding. A caller-supplied project filter never grants access.
- MCP connection/binding deletion requires one-use approval. Connection secret or executable/endpoint replacement requires a one-use approval bound to the exact redacted payload for 15 minutes.
- Manual delivery retry also requires one-use approval because the provider may receive the message again. REST retry requires `{ "approval": { "confirmed": true } }`.

### Ingress replay and message idempotency

The canonical route is both `GET` and `POST` at `/api/chat-providers/ingress/:providerConnectionId`; `/api/chat-providers/connections/:connectionId/ingress` remains a compatibility alias. Secrets are resolved ephemerally before GET handshakes and POST authentication.

Generic HMAC requests require a fresh timestamp and are replay-checked by timestamp/signature. Generic bearer requests with `X-Code-UX-Nonce` or `X-Request-Id` receive the same durable receipt protection. Provider-native authentication follows the provider contract instead: Meta raw-body HMAC has no provider timestamp, Telegram uses its exact header secret, Slack uses its signed timestamp, Teams validates Bot Connector JWTs, and Discord validates Ed25519 interaction signatures.

After authentication, the normalized external message ID is atomically inserted in `chat_provider_message_deliveries`. Only the insert winner can post to chat. Profile-declared immediate callbacks are acknowledged after that durable insert and processed asynchronously. Shared-channel ambiguity is stored as `disambiguation_needed`; Code UX does not guess a project.

### Outbound leases, timeouts, cancellation, and recovery

Outbound records move through `pending`, `sending`, `delivered`, `retryable_failure`, `failed`, or `cancelled`. Retry workers claim compare-and-set SQLite leases; other workers cannot claim an unexpired lease, and stale `sending` leases become recoverable after expiry/restart. Retryable failures use capped exponential backoff with jitter unless a provider supplies a longer/exact retry interval.

HTTP, provider verification, and local commands have bounded timeouts. Cancellation writes terminal state and aborts fetch/command work. Shutdown aborts in-flight work, terminates native process groups, releases owned delivery leases back to pending/retryable state, stops reconnect timers, and waits for connector jobs before storage closes. Dashboard startup independently attempts ingress recovery, outbound retry recovery, and resumable sessions; an optional connector failure is logged but does not fail global `/ready`.

Connector health (`GET /api/chat-providers/health`, alias `/diagnostics`, or MCP `get_health`) is a persisted-state read: configured/active/verified/error counts and sanitized last outcomes. It makes no provider call. Expired replay receipts and sessions are cleaned up by repository/runtime maintenance; deleting a connection cascades its bindings and delivery rows.

## REST surface

| Endpoint | Contract |
| --- | --- |
| `GET /api/chat-providers/setup-definitions` | Setup schemas, required fields, official references, limitations, and ingress URL template. |
| `POST /api/chat-providers/connections` | Validated creation with write-only secrets; live-verification modes cannot be activated before verification. |
| `PATCH /api/chat-providers/connections/:connectionId` | Metadata/setup/secret update; transport changes invalidate verification. |
| `POST /api/chat-providers/connections/:connectionId/verify` | Bounded configuration/provider check with sanitized outcome. |
| `GET /api/chat-providers/health` | Persisted health summary; no network call. |
| `GET /api/chat-providers/deliveries` | Authorized, sanitized inbound/outbound delivery metadata; omits payload and lease fields. |
| `POST /api/chat-providers/deliveries/:deliveryId/retry` | Approved manual retry. |
| `POST /api/chat-providers/deliveries/:deliveryId/cancel` | Terminal cancellation and in-flight abort. |
| `GET|POST /api/chat-providers/ingress/:providerConnectionId` | Provider handshake and authenticated callback ingress. |

Example ingress and controls use placeholders only:

```text
GET  https://codeux.example.test/api/chat-providers/ingress/connection-example
POST https://codeux.example.test/api/chat-providers/ingress/connection-example
```

```json
POST /api/chat-providers/deliveries/delivery-example/retry
{ "approval": { "confirmed": true } }
```

A verification timeout is returned without upstream URLs, bodies, or credentials:

```json
{
  "status": "failed",
  "providerErrorCode": "verification_timeout",
  "retryable": true,
  "issues": ["Provider verification timed out."],
  "diagnostics": null
}
```

See [Chat Provider Integrations](../settings/chat-provider-integrations.md), [provider profiles](../settings/chat-connectors/index.md), [MCP tools](../mcp/tools-and-contracts.md), and [the operations runbook](../operations/runbook.md).
