# External chat providers

Code UX persists external chat provider configuration separately from MCP listener connections and dashboard conversation messages. The runtime stays adapter-neutral: it records provider setup, bridge mode, channel routing, inbound dedupe, outbound delivery state, and bridge attempts without adding provider SDK dependencies.

## Contracts

Typed contracts live in `src/contracts/chat-provider-types.ts`.

Supported providers:

- `whatsapp`
- `imessage`
- `telegram`
- `slack`
- `microsoft-teams`
- `discord`

Supported bridge modes are `openclaw`, `webhook`, and `native_bridge`. Provider setup schemas describe the executable bridge shape for future runtime adapters:

- WhatsApp: OpenClaw plugin or webhook.
- iMessage: OpenClaw core or macOS native bridge command.
- Telegram: OpenClaw core or bot webhook.
- Slack: OpenClaw plugin or Events webhook.
- Microsoft Teams: OpenClaw plugin or bot webhook.
- Discord: bot/webhook gateway.

Public records expose redacted credential metadata only. Runtime code that needs secrets must call the explicit internal repository read path.

## MCP management

The `manage_chat_providers` MCP tool exposes provider configuration management and outbound delivery inspection.

Supported actions:

- Provider setup definitions: `list_provider_definitions`.
- Provider connections: `list_connections`, `get_connection`, `create_connection`, `update_connection`, `delete_connection`.
- Channel bindings: `list_channel_bindings`, `create_channel_binding`, `update_channel_binding`, `delete_channel_binding`.
- Delivery inspection: `list_outbound_deliveries` for outbound records, optionally filtered by delivery status including `retryable_failure`.

Connection and binding responses include stable IDs plus generated ingress URL guidance under `ingressUrls`. Connection responses expose `credentials` with redacted configured-state metadata only; raw `secrets` are never returned.

Approval rules:

- `delete_connection` and `delete_channel_binding` require the standard destructive-action approval handshake.
- `update_connection` requires a one-use approval handshake before replacing a non-empty `secrets` payload. The approval response is bound to the redacted action payload and does not echo secret values.

## Storage

SQLite tables are created for fresh databases and during startup migrations for existing databases.

| Table | Purpose |
| --- | --- |
| `chat_provider_connections` | Provider kind, bridge mode, status, enabled flag, setup JSON, and secret JSON. |
| `chat_provider_channel_bindings` | Links external channels to projects with routing hints, optional project-manager agent preset, inbound/outbound flags, and `suppress_rich_widgets` defaulting to true. |
| `chat_provider_message_deliveries` | Inbound idempotency keys and outbound delivery status, attempts, errors, linked conversation message IDs, and payload snapshots. |

Bindings allow many projects to point at the same external channel and one project to use multiple channels. Provider deletion cascades bindings and delivery rows. Existing MCP connection and conversation tables remain unchanged.

## Repository

`src/repositories/chat-provider-repository.ts` owns persistence for this foundation:

- Connection create/update/list/get/delete.
- Redacted public reads and unredacted internal reads.
- Secret-preserving updates when an update omits the `secrets` field.
- Channel binding create/update/list/get/delete.
- Inbound duplicate lookup by `(providerConnectionId, externalMessageId)`.
- Outbound delivery upsert and state transitions.
- Outbound delivery listing scoped to a provider connection or channel binding for dashboard status views, plus pending/retryable outbound delivery scans for retry workers.

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

- `openclaw`: HTTP `POST` to a configured OpenClaw bridge URL such as `openclawBridgeUrl`, using bridge credentials as transport headers.
- `webhook`: HTTP `POST` to configured generic bridge URLs such as `webhookUrl`, `eventsUrl`, `botEndpointUrl`, or `gatewayUrl`.
- `native_bridge`: local command execution for macOS/iMessage-style bridge scripts. The payload is written as JSON on stdin and optional bridge tokens are supplied through environment variables.

The runtime never calls WhatsApp, iMessage, Telegram, Slack, Microsoft Teams, or Discord APIs directly. Provider-specific SDKs are not required.

Outbound delivery lifecycle:

- `pending`: reply has been persisted and queued for bridge delivery.
- `sending`: an adapter attempt is in progress.
- `delivered`: the bridge accepted the reply; `externalMessageId` is stored when the bridge returns one.
- `retryable_failure`: a retryable bridge failure occurred and the payload contains `delivery.nextAttemptAt`.
- `failed`: delivery is terminal, such as disabled outbound routing, missing bridge configuration, non-retryable HTTP response, or exhausted attempts.

Retryable HTTP/network/native bridge failures use exponential backoff. The dashboard lifecycle starts the outbound retry loop, and status APIs/MCP reads expose delivery status, attempt count, last error, linked conversation message id, and redacted payload state. Secrets are redacted from logs, payloads, stored errors, dashboard responses, and MCP responses.

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
| `GET /api/chat-providers/channel-bindings` | Lists channel bindings, including same external channel bindings across multiple projects. |
| `GET /api/chat-providers/connections/:connectionId/channel-bindings` | Lists bindings for one provider connection. |
| `POST /api/chat-providers/channel-bindings` | Creates a project/channel binding after validating channel id, project id, optional agent preset id, routing hints, metadata, and booleans. |
| `PATCH /api/chat-providers/channel-bindings/:bindingId` | Updates binding labels, project routing, agent preset, routing hints, metadata, and enabled flags. |
| `DELETE /api/chat-providers/channel-bindings/:bindingId` | Deletes a channel binding. |
| `GET /api/chat-providers/connections/:connectionId/delivery-status` | Lists recent outbound delivery records for one provider connection. |
| `GET /api/chat-providers/channel-bindings/:bindingId/delivery-status` | Lists recent outbound delivery records for one channel binding. |
| `POST /api/chat-providers/ingress/:providerConnectionId` | Accepts authenticated inbound bridge messages, normalizes provider payloads, deduplicates external message IDs, and posts routed text to dashboard chat threads. |

The ingress endpoint supports OpenClaw, webhook, and native bridge payloads for WhatsApp, iMessage, Telegram, Slack, Microsoft Teams, and Discord. OpenClaw and native bridges authenticate with bearer tokens from the configured bridge secret. Webhook bridges require a configured signing secret and a valid HMAC signature; they do not accept bearer-only fallback. All ingress requests require a fresh timestamp, and signed requests or requests with explicit nonces are replay-checked before processing.

Inbound messages normalize to provider connection id, provider kind, external channel id/name, external sender id/name, text, external message id, timestamp, and redacted raw metadata. The repository idempotency lookup runs before chat posting; duplicate external messages return the existing delivery record without creating another conversation message.

Channel resolution only considers enabled bindings with inbound enabled for the provider connection and external channel. If multiple projects share a channel, routing hints such as `projectSelectorPrefix`, `projectSelector`, `projectAlias`, `aliases`, or payload-level project selectors are applied first. If no hint selects exactly one binding, the runtime records a `disambiguation_needed` inbound delivery state and returns a conflict response instead of guessing a project.

Routed inbound text is posted through `ChatThreadRuntimeService.postMessage` with metadata marking `source: "chat_provider"`, provider kind, external channel id, external sender, inbound delivery id, and `suppressRichWidgets: true`.

Chat-provider-sourced prompts omit the dashboard `codeux:*` rich widget instruction block. If a provider reply still contains a dashboard-only widget fence, outbound delivery strips or downgrades it to readable markdown before sending externally. Approval prompts and management-action result summaries remain plain markdown and continue to be delivered to the external channel.
