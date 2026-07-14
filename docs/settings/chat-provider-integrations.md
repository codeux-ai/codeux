# Chat Provider Integrations

External chat connector integrations let Code UX accept messages from chat channels, route them into project chat threads, and deliver assistant replies back through the same bridge. These integrations are configured under Settings -> Integrations -> Chat Connectors, but they are separate from AI provider credentials and model routing.

## Supported Providers And Bridge Modes

Code UX supports external chat channels through the bridge contracts implemented by the runtime:

| Provider kind | Supported bridge modes |
| --- | --- |
| `whatsapp` | managed bridge, webhook, official API |
| `imessage` | managed bridge, native bridge command |
| `telegram` | managed bridge, bot webhook, official API |
| `slack` | managed bridge, Events webhook, official API |
| `microsoft-teams` | managed bridge, bot webhook |
| `discord` | bot/webhook gateway |

These connector labels describe the normalized payloads and setup schemas Code UX accepts. Official API modes use the profile-owned provider contract; managed/webhook/native modes continue to use their configured bridge. Unsupported provider/mode combinations fail validation. Provider-specific details are listed in [Chat Connector Profiles](./chat-connectors/index.md).

Bridge modes:

- `managed_bridge`: HTTP delivery to a configured managed bridge URL, with bridge credentials used as transport credentials.
- `webhook`: HTTP delivery to a configured generic gateway URL such as `webhookUrl`, `eventsUrl`, `botEndpointUrl`, or `gatewayUrl`.
- `native_bridge`: local command execution for native bridge scripts. Code UX writes JSON to stdin, parses the configured command into executable and arguments without shell interpretation, and passes an optional bridge token through the environment.
- `official_api`: profile-specific authenticated ingress, outbound mapping, provider error classification, and bounded read-only provider verification where advertised. Verification availability is separate from any opt-in test-send capability.

## Setup Model

Settings -> Integrations contains related but separate configuration families:

- AI provider credentials and model routing configure CLI or hosted providers that do Code UX work, such as Codex, Gemini, Claude Code, Qwen Code, OpenCode, Antigravity, and Jules.
- Chat connector connections configure external chat ingress, project/channel binding, and outbound reply delivery.

Chat provider connections are stored in the Code UX SQLite database. Each connection records provider kind, bridge mode, display name, enabled state, status, non-secret setup fields, and secret fields. Public dashboard and MCP reads return redacted credential metadata only; runtime services that need raw secrets use an explicit internal repository path.

Saved secret fields are write-only in the dashboard. To rotate a secret, enter a replacement value. Empty replacement fields preserve the existing stored secret.

## Ingress Security

Inbound chat provider requests are accepted on the dashboard server and must authenticate before routing:

- Managed and native bridge modes use bearer-style bridge credentials. The request can use an `Authorization: Bearer ...` header or `x-code-ux-bridge-token`.
- Webhook mode requires a configured HMAC signing secret and a valid signature. Webhook mode does not fall back to bearer-only authentication.
- Every inbound request needs a fresh timestamp header such as `x-code-ux-timestamp`, `x-provider-timestamp`, or `x-slack-request-timestamp`.
- Signed requests and bearer requests with explicit nonce/request-id headers are replay-checked during the timestamp window.

The primary ingress endpoint is:

```text
POST /api/chat-providers/ingress/:providerConnectionId
```

The compatibility alias remains:

```text
POST /api/chat-providers/connections/:connectionId/ingress
```

## Channel Binding And Project Routing

A channel binding connects one external channel to one Code UX project. Bindings include:

- `providerConnectionId`
- `externalChannelId` and `externalChannelName`
- `projectId`
- optional `agentPresetId`
- optional routing hints
- enabled, inbound, outbound, and `suppressRichWidgets` flags

Multiple projects may bind to the same external channel. When that happens, inbound routing must identify exactly one project before Code UX posts the message. Routing can use payload-level selectors such as `projectId`, `projectSelector`, `projectAlias`, or `project`, or binding hints such as `projectSelectorPrefix`, `projectSelector`, `projectAlias`, `aliases`, `prefix`, or `selector`.

Selectors can be embedded in message text with supported prefix forms such as `[selector] message`, `/selector message`, `@selector message`, or `selector: message`. When a selector matches, Code UX strips the selector before posting the message to the project chat thread.

If a shared external channel maps to multiple projects and no selector chooses exactly one binding, Code UX records the inbound delivery with `state: "disambiguation_needed"` and returns a conflict response instead of guessing.

## Inbound Conversation Behavior

Inbound payloads normalize to provider connection id, provider kind, external channel id/name, external sender id/name, message text, external message id, timestamp, and redacted raw metadata.

The external message id is the idempotency boundary. Code UX checks for an existing inbound delivery before posting to chat; duplicate provider retries return the existing delivery record and do not create another conversation message.

Routed inbound messages are posted through the normal chat thread runtime with metadata that marks:

- `source: "chat_provider"`
- provider kind
- external channel id
- external sender id/name
- inbound delivery id
- `suppressRichWidgets: true`

When a payload or binding provides an existing conversation thread id, Code UX reuses that thread. Otherwise the chat runtime creates or selects the project conversation thread through its existing project chat path.

## Outbound Replies And Delivery State

Assistant and system replies are delivered back to an external channel only when the triggering user message came from chat provider ingress metadata. Dashboard-originated threads do not create chat provider outbound deliveries.

Outbound delivery records are persisted in `chat_provider_message_deliveries` and link the provider connection, channel binding, external channel, conversation thread, conversation message, retry state, and redacted payload metadata.

Outbound states:

- `pending`: reply is queued for bridge delivery.
- `sending`: an adapter attempt is in progress.
- `delivered`: the bridge accepted the reply, with an external message id stored when returned.
- `retryable_failure`: a network, HTTP, or native bridge failure will be retried after `delivery.nextAttemptAt`.
- `failed`: delivery is terminal because routing is disabled, bridge setup is missing, the bridge returned a non-retryable error, or retry attempts were exhausted.

The dashboard lifecycle starts the retry loop. Failed and retryable deliveries are visible through Settings -> Integrations -> Chat Connectors and MCP. Public results omit stored payload and lease fields; manual retry requires explicit approval, and cancellation records terminal `cancelled` state.

## Rich Widget Suppression

Dashboard chat can include `codeux:*` rich widget instructions and fences for dashboard-only controls. External channels receive plain markdown instead:

- chat-provider-sourced prompts omit the dashboard rich-widget instruction block
- persisted replay and compaction input for external turns uses the same widget suppression rules
- outbound delivery strips or downgrades any remaining dashboard-only widget fences into readable markdown

Approval prompts and management-action summaries remain plain markdown so they can still be delivered through the external chat channel.

## MCP Management

The `manage_chat_providers` tool can list setup definitions, manage and verify connections, report local connector health, manage channel bindings, and inspect/control durable deliveries.

Supported actions:

- `list_provider_definitions`
- `list_connections`
- `get_connection`
- `create_connection`
- `update_connection`
- `delete_connection`
- `list_channel_bindings`
- `create_channel_binding`
- `update_channel_binding`
- `delete_channel_binding`
- `verify_connection`
- `get_health`
- `list_deliveries`
- `list_outbound_deliveries`
- `retry_delivery`
- `cancel_delivery`

Approval behavior:

- `delete_connection` and `delete_channel_binding` require destructive-action approval.
- `update_connection` requires one-use approval before replacing secrets or removing/modifying persisted executable/endpoint setup. Omitted URL or command fields count as removal because setup replacements are compared with the stored connection.
- `retry_delivery` requires one-use approval because it can cause another provider send.
- Approval fingerprints use an exact redacted payload hash; raw sensitive values are not returned.

Example connection creation:

```json
{
  "action": "create_connection",
  "providerKind": "slack",
  "displayName": "Team chat bridge",
  "bridgeMode": "webhook",
  "status": "active",
  "enabled": true,
  "setup": {
    "eventsUrl": "https://bridge.example.test/events",
    "appId": "app-generic"
  },
  "secrets": {
    "signingSecret": "replace-with-secret",
    "botToken": "replace-with-token"
  }
}
```

Example channel binding:

```json
{
  "action": "create_channel_binding",
  "providerConnectionId": "connection-generic",
  "externalChannelId": "channel-shared",
  "externalChannelName": "Shared engineering channel",
  "projectId": "project-alpha",
  "routingHints": {
    "projectSelectorPrefix": "alpha",
    "aliases": ["alpha", "project-alpha"]
  },
  "inboundEnabled": true,
  "outboundEnabled": true,
  "suppressRichWidgets": true
}
```

Example delivery inspection:

```json
{
  "action": "list_outbound_deliveries",
  "providerConnectionId": "connection-generic",
  "externalChannelId": "channel-shared",
  "deliveryStatus": "retryable_failure",
  "limit": 25
}
```

## Related Docs

- [External Chat Provider Foundation](../architecture/external-chat-providers.md)
- [Chat Thread Runtime](../architecture/chat-thread-runtime.md)
- [MCP Tools and Contracts](../mcp/tools-and-contracts.md)
- [Provider Routing](./provider-routing.md)
