# External chat connectors

Code UX persists external chat provider configuration separately from MCP listener connections and dashboard conversation messages. The runtime stays adapter-neutral: it records provider setup, bridge mode, channel routing, inbound dedupe, outbound delivery state, and bridge attempts without adding provider SDK dependencies.

## Contracts

Public compatibility contracts live in `src/contracts/chat-provider-types.ts`. Runtime behavior is statically registered through a typed profile per provider.

Supported providers:

- `whatsapp`
- `imessage`
- `telegram`
- `slack`
- `microsoft-teams`
- `discord`

The bridge-mode type includes `managed_bridge`, `webhook`, `native_bridge`, and `official_api`. Profiles advertise only implemented modes:

- WhatsApp: managed bridge, webhook, or official API.
- iMessage: managed bridge or macOS native bridge command.
- Telegram: managed bridge, bot webhook, or official API.
- Slack: managed bridge, Events webhook, or official API.
- Microsoft Teams: managed bridge or bot webhook.
- Discord: bot/webhook gateway.

Public records expose redacted credential metadata only. Runtime code that needs secrets resolves an ephemeral connection profile through `ChatProviderSecretService`; repository reads never decrypt connector credentials.

Profiles declare setup, authentication and handshake behavior, normalization, external identity, outbound mapping and parsing, verification, session requirements, official references, live-test availability, and lifecycle metadata. The registry itself is side-effect free; network and process execution stay in shared runtime services. See the [Chat Connector Registry](./chat-connectors/index.md) and its provider pages.

## MCP management

The `manage_chat_providers` MCP tool exposes provider configuration, verification, local health, and durable delivery control.

Supported actions:

- Provider setup definitions: `list_provider_definitions`.
- Provider connections: `list_connections`, `get_connection`, `create_connection`, `update_connection`, `delete_connection`.
- Channel bindings: `list_channel_bindings`, `create_channel_binding`, `update_channel_binding`, `delete_channel_binding`.
- Verification and health: `verify_connection` and `get_health`.
- Delivery inspection/control: `list_deliveries`, compatibility action `list_outbound_deliveries`, `retry_delivery`, and `cancel_delivery`.

Connection and binding responses include stable IDs plus generated ingress URL guidance under `ingressUrls`. Connection responses expose `credentials` with redacted configured-state metadata only; raw `secrets` are never returned.

Approval rules:

- `delete_connection` and `delete_channel_binding` require the standard destructive-action approval handshake.
- `update_connection` requires one-use approval before replacing secrets or changing executable/endpoint setup; `retry_delivery` requires the same exact-redacted-payload approval.

Ingress guidance uses `/api/chat-providers/ingress/:providerConnectionId`. Project scope for binding and delivery operations comes from persisted ownership, not caller-supplied project filters.

## Storage

SQLite tables are created for fresh databases and during startup migrations for existing databases.

| Table | Purpose |
| --- | --- |
| `chat_provider_connections` | Provider kind, bridge mode, status, enabled flag, setup JSON, sanitized verification results, and connector secret version. The nullable `secret_json` column is retained only as a legacy migration source. |
| `chat_provider_connection_secrets` | AES-256-GCM envelope fields, root-key id/version, and non-secret configured-field metadata. |
| `chat_provider_channel_bindings` | Links external channels to projects with routing hints, optional project-manager agent preset, inbound/outbound flags, and `suppress_rich_widgets` defaulting to true. |
| `chat_provider_message_deliveries` | Inbound idempotency keys plus outbound status, attempts, explicit retry schedule, compare-and-set lease ownership, linked conversation IDs, and payload snapshots. |
| `chat_provider_ingress_replay_receipts` | Expiring authenticated-ingress replay receipts, unique per connection and replay key. |
| `chat_provider_sessions` | Resumable provider-native session state with connection/binding ownership and compare-and-set versions. |

Bindings allow many projects to point at the same external channel and one project to use multiple channels. Provider deletion cascades bindings and delivery rows. Existing MCP connection and conversation tables remain unchanged.

## Repository

`src/repositories/chat-provider-repository.ts` owns persistence for this foundation:

- Connection create/update/list/get/delete.
- Redacted public reads and unredacted internal reads.
- Atomic encrypted-envelope create, rotation, and clearing in the same secret-version CAS transaction as connection metadata, plus resumable post-key-readiness sealing of legacy plaintext.
- Verification reset after authentication, bridge-mode, or setup changes while display-name, enabled, and lifecycle-status edits preserve the last validated configuration.
- Channel binding create/update/list/get/delete.
- Atomic inbound duplicate insertion by `(providerConnectionId, externalMessageId)` and atomic expiring replay-receipt insertion.
- Compare-and-set provider session updates and expiry cleanup.
- Outbound delivery upsert and state transitions.
- Outbound delivery listing plus lease claim/complete/release operations with due-time filtering and stale-lease recovery.

Indexes cover provider kind, enabled status, project lookup, provider/channel lookup, inbound dedupe, and pending/retryable outbound delivery scans.

## Outbound delivery

`ChatProviderOutboundService` sends assistant/system replies back to external chat channels only for threads sourced from chat provider ingress metadata. Dashboard-originated chat keeps the existing rich widget behavior and does not create outbound provider deliveries.

The outbound runtime builds one delivery payload per persisted reply with:

- Provider kind and provider connection id.
- External channel id and channel binding id.
- Conversation thread id and reply conversation message id.
- Plain markdown reply text.
- Reply-to external message id from the inbound delivery when available.
- Redacted metadata linking the inbound delivery and source conversation message.

Bridge execution is isolated behind `src/services/chat-provider-adapters.ts`:

- `managed_bridge`: HTTP `POST` to a configured managed bridge URL such as `bridgeUrl`, using bridge credentials as transport headers.
- `webhook`: HTTP `POST` to configured generic bridge URLs such as `webhookUrl`, `eventsUrl`, `botEndpointUrl`, or `gatewayUrl`.
- `native_bridge`: local command execution for macOS/iMessage-style bridge scripts. The payload is written as JSON on stdin, commands are parsed into executable plus arguments without shell interpretation, and optional bridge tokens are supplied through environment variables.

The runtime never calls WhatsApp, iMessage, Telegram, Slack, Microsoft Teams, or Discord APIs directly. Provider-specific SDKs are not required.

Outbound delivery lifecycle:

- `pending`: reply has been persisted and queued for bridge delivery.
- `sending`: an adapter attempt is in progress.
- `delivered`: the bridge accepted the reply; `externalMessageId` is stored when the bridge returns one.
- `retryable_failure`: a retryable bridge failure occurred and `next_attempt_at` records the durable schedule (the redacted payload mirrors it for display).
- `failed`: delivery is terminal, such as disabled outbound routing, missing bridge configuration, non-retryable HTTP response, or exhausted attempts.

Retryable HTTP/network/native bridge failures use exponential backoff. Retry workers acquire bounded leases, and expired leases recover after a crash. Public REST/MCP reads expose status, attempts, retry time, redacted errors, and linked IDs while omitting stored payload and lease fields.

## Dashboard API

Dashboard settings use `src/server/chat-provider-routes.ts` to manage chat provider configuration through REST endpoints. The routes are registered with the settings route group and use the shared `asyncRoute`/`syncRoute` error wrappers and request parser validation.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/chat-providers/setup-definitions` | Lists provider setup schemas with ingress URL templates and setup hints. |
| `GET /api/chat-providers/connections` | Lists redacted provider connections, optionally filtered by provider kind or enabled state. |
| `GET /api/chat-providers/connections/:connectionId` | Reads one redacted provider connection with generated ingress URL and setup hints. |
| `POST /api/chat-providers/connections` | Creates a provider connection after validating provider kind, bridge mode, setup fields, display name, booleans, and secret shape. |
| `PATCH /api/chat-providers/connections/:connectionId` | Updates connection metadata, setup, status, enabled state, bridge mode, or secrets without echoing raw secret values. |
| `DELETE /api/chat-providers/connections/:connectionId` | Deletes a provider connection and cascades bindings and delivery rows. |
| `POST /api/chat-providers/connections/:connectionId/verify` | Runs bounded profile verification and persists a sanitized outcome. |
| `GET /api/chat-providers/health` | Returns local configured/active/verified/error counts and last outcomes without network calls. |
| `GET /api/chat-providers/channel-bindings` | Lists channel bindings, including same external channel bindings across multiple projects. |
| `GET /api/chat-providers/connections/:connectionId/channel-bindings` | Lists bindings for one provider connection. |
| `POST /api/chat-providers/channel-bindings` | Creates a project/channel binding after validating channel id, project id, optional agent preset id, routing hints, metadata, and booleans. |
| `PATCH /api/chat-providers/channel-bindings/:bindingId` | Updates binding labels, project routing, agent preset, routing hints, metadata, and enabled flags. |
| `DELETE /api/chat-providers/channel-bindings/:bindingId` | Deletes a channel binding. |
| `GET /api/chat-providers/connections/:connectionId/delivery-status` | Lists recent outbound delivery records for one provider connection. |
| `GET /api/chat-providers/channel-bindings/:bindingId/delivery-status` | Lists recent outbound delivery records for one channel binding. |
| `GET /api/chat-providers/deliveries` | Lists sanitized inbound/outbound delivery metadata. |
| `POST /api/chat-providers/deliveries/:deliveryId/retry` | Retries an outbound delivery after explicit approval. |
| `POST /api/chat-providers/deliveries/:deliveryId/cancel` | Cancels pending or in-flight outbound work. |
| `GET /api/chat-providers/ingress/:providerConnectionId` | Handles provider subscription handshakes. |
| `POST /api/chat-providers/ingress/:providerConnectionId` | Accepts authenticated inbound bridge messages, normalizes provider payloads, deduplicates external message IDs, and posts routed text to dashboard chat threads. |

Remote connection/verification mutations require `credential_admin` and enabled remote credential management. Connector health is persisted-state diagnostics only; optional provider failures do not affect `/ready`.

## Dashboard Settings UI

Settings -> Integrations includes a Chat Connectors group for WhatsApp, iMessage, Telegram, Slack, Microsoft Teams, and Discord. Each provider detail view reads the setup definitions, redacted connection records, channel bindings, generated ingress URLs, and outbound delivery status from the dashboard API.

The UI lets operators create and edit provider connections with display names, bridge modes, setup fields, enabled state, connection status, and write-only secret replacement fields. Saved secrets are never rendered back into the form; configured credentials appear only as redacted metadata and empty replacement inputs.

Channel binding controls support multiple projects on the same external channel and multiple channels per project. Bindings expose project selection, optional project-manager agent preset selection, inbound and outbound toggles, project selector prefix or routing hint fields, and the `suppressRichWidgets` setting. The Settings copy explains that shared-channel routing uses these selectors before accepting inbound messages and records disambiguation instead of guessing when a channel maps to multiple projects.

Provider cards and connection detail views surface enabled state, bridge mode, ingress URL, authentication status, configured channels, bound projects, outbound reply state, pending outbound delivery count, and failed outbound delivery count. Recent failed outbound messages are shown with retryable labels and redacted error text.

The ingress endpoint supports Managed, webhook, and native bridge payloads for WhatsApp, iMessage, Telegram, Slack, Microsoft Teams, and Discord. Managed and native bridges authenticate with bearer tokens resolved ephemerally from the encrypted envelope. Webhook bridges require a configured signing secret and a valid HMAC signature; they do not accept bearer-only fallback. All ingress requests require a fresh timestamp, and signed requests or requests with explicit nonces are atomically replay-checked through expiring SQLite receipts before processing.

Inbound messages normalize to provider connection id, provider kind, external channel id/name, external sender id/name, text, external message id, timestamp, and redacted raw metadata. The repository atomically inserts the inbound delivery before chat posting; concurrent duplicates return the same delivery and only the insertion winner can create a conversation message. Profile-declared immediate callbacks are acknowledged after persistence and processed asynchronously.

Channel resolution only considers enabled bindings with inbound enabled for the provider connection and external channel. If multiple projects share a channel, routing hints such as `projectSelectorPrefix`, `projectSelector`, `projectAlias`, `aliases`, or payload-level project selectors are applied first. If no hint selects exactly one binding, the runtime records a `disambiguation_needed` inbound delivery state and returns a conflict response instead of guessing a project.

Routed inbound text carries provider connection/binding identity, provider conversation/thread keys, the binding's selected agent preset, and its `suppressRichWidgets` value. These overrides apply only to the external turn.

See [Chat connector runtime reliability](./chat-connector-runtime-reliability.md) for acknowledgement, lease, retry, session recovery, cancellation, and shutdown behavior.

Chat-provider-sourced prompts omit the dashboard `codeux:*` rich widget instruction block. If a provider reply still contains a dashboard-only widget fence, outbound delivery strips or downgrades it to readable markdown before sending externally. Approval prompts and management-action result summaries remain plain markdown and continue to be delivered to the external channel.

Dashboard-only `agentEffect` metadata follows the same boundary. External prompts do not advertise the avatar effect contract, outbound payloads never include assistant avatar metadata, and any remaining `codeux:agent` fence is removed or downgraded before delivery.
