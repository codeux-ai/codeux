# External Chat Provider Foundation

Code UX persists external chat provider configuration separately from MCP listener connections and dashboard conversation messages. The foundation is intentionally adapter-neutral: it records provider setup, bridge mode, channel routing, inbound dedupe, and outbound delivery state without adding provider SDK dependencies.

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

## Storage

SQLite tables are created by `APP_DB_SCHEMA_TABLES` for fresh databases and by `ensureChatProviderTables()` during startup migrations for existing databases.

| Table | Purpose |
| --- | --- |
| `chat_provider_connections` | Provider kind, bridge mode, status, enabled flag, setup JSON, and secret JSON. |
| `chat_provider_channel_bindings` | Links external channels to projects with routing hints, optional project-manager agent preset, inbound/outbound flags, and `suppress_rich_widgets` defaulting to true. |
| `chat_provider_message_deliveries` | Inbound idempotency keys and outbound delivery status, attempts, errors, linked conversation message IDs, and payload snapshots. |

Bindings allow many projects to point at the same external channel and one project to use multiple channels. Provider deletion cascades bindings and delivery rows. Existing `mcp_connections`, `conversation_threads`, and `conversation_messages` behavior remains unchanged.

## Repository

`src/repositories/chat-provider-repository.ts` owns persistence for this foundation:

- Connection create/update/list/get/delete.
- Redacted public reads and unredacted internal reads.
- Secret-preserving updates when an update omits the `secrets` field.
- Channel binding create/update/list/get/delete.
- Inbound duplicate lookup by `(providerConnectionId, externalMessageId)`.
- Outbound delivery upsert and state transitions.
- Outbound delivery listing scoped to a provider connection or channel binding for dashboard status views.
- Pending outbound delivery listing for future send workers.

Indexes cover provider kind, enabled status, project lookup, provider/channel lookup, inbound dedupe, and pending outbound delivery scans.

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

These endpoints only manage configuration and status records. Inbound message processing, provider polling, and outbound provider delivery are implemented by later runtime adapters.
