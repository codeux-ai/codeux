# External chat providers

Code UX persists external chat provider configuration separately from MCP listener connections and dashboard conversation messages. The foundation is adapter-neutral: it records provider setup, bridge mode, channel routing, inbound dedupe, and outbound delivery state without adding provider SDK dependencies.

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

The `manage_chat_providers` MCP tool exposes provider configuration management without routing inbound messages or sending outbound messages.

Supported actions:

- Provider setup definitions: `list_provider_definitions`.
- Provider connections: `list_connections`, `get_connection`, `create_connection`, `update_connection`, `delete_connection`.
- Channel bindings: `list_channel_bindings`, `create_channel_binding`, `update_channel_binding`, `delete_channel_binding`.
- Delivery inspection: `list_outbound_deliveries` for outbound records, optionally filtered by delivery status.

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
- Outbound delivery listing for management inspection and pending outbound delivery listing for future send workers.

Indexes cover provider kind, enabled status, project lookup, provider/channel lookup, inbound dedupe, and pending outbound delivery scans.
