# Chat Provider Integrations

External chat connectors accept provider messages, route them into authorized project chat threads, and deliver assistant replies through the same provider-native or bridge transport. Configure them under Settings -> Integrations -> Chat Connectors. They are separate from AI provider/model credentials.

## Choose the transport deliberately

| Provider | Provider-native mode | Retained bridge modes |
| --- | --- | --- |
| WhatsApp | `official_api` (Meta Cloud API) | `managed_bridge`, custom `webhook` |
| iMessage | None | `managed_bridge`, local `native_bridge` |
| Telegram | `official_api` (Bot API) | `managed_bridge`, custom `webhook` |
| Slack | `official_api` (Events/Web API) | `managed_bridge`, custom `webhook` |
| Microsoft Teams | `official_api` (Bot Connector) | `managed_bridge`, custom `webhook` |
| Discord | `official_api` (Gateway/Interactions/REST) | custom `webhook` gateway |

An `official_api` profile pins provider-controlled endpoints and owns provider-specific authentication and error mapping. A `managed_bridge` or `webhook` profile sends to the URL the operator configured. A `native_bridge` runs the configured local command with `shell: false`. Code UX does not certify an operator-selected bridge, and a connector card/registry entry is not proof of production readiness.

The complete setup, identity, verification, retry, session, and limitation matrix is in [External Chat Providers](../architecture/external-chat-providers.md). Provider details are in [Chat Connector Profiles](./chat-connectors/index.md).

## Safe setup sequence

1. Create the connection as `draft`; choose one advertised bridge mode and enter only its setup fields.
2. Enter credentials in write-only fields. Saved values return only `configured` plus `********`; empty replacement inputs preserve existing values.
3. Copy the generated canonical ingress URL:

   ```text
   https://codeux.example.test/api/chat-providers/ingress/connection-example
   ```

   GET is used for provider challenges where applicable; POST accepts authenticated callbacks. The older `/api/chat-providers/connections/:connectionId/ingress` path is compatibility-only.

4. Configure provider webhook/event subscriptions or start the operator bridge. Official modes never reuse a custom bridge URL.
5. Run verification. A setup or secret change resets verification to `unverified`; verify before activation.
6. Create at least one channel binding for an authorized project. Keep inbound/outbound disabled until the identity and routing fields have been checked.
7. Enable the binding and connection, send one eligible test message, inspect the durable inbound/outbound delivery records, and then expand access.

## Provider setup and test eligibility

- **Meta WhatsApp:** configure Graph version, phone-number ID, access token, app secret, and webhook verify token. Read-only phone-number verification is separate from message-send testing. A Meta test-number send must be explicitly opted in and is not evidence that an unrestricted production number is ready.
- **iMessage:** configure only the selected third-party managed bridge or local protocol-v1 command. Apple publishes no general personal-iMessage bot endpoint or public bot sandbox. Do not configure unsupported AppleScript/database automation as an official mode.
- **Telegram:** configure bot token and webhook secret token; the operator must call `setWebhook`. Verification uses `getMe` plus read-only `getWebhookInfo` and therefore needs test bot credentials.
- **Slack:** configure app/workspace metadata, signing secret, bot token, Events request URL, subscriptions, scopes, and installation. Verification uses `auth.test` and needs a test token; channel membership is ultimately proven by provider delivery.
- **Microsoft Teams:** configure app ID, application type, tenant policy, and client secret. There is no public unauthenticated Connector sandbox. Automated tests use Emulator-shaped Activities and mocked contract boundaries; a fixture pass is not a live tenant check.
- **Discord:** configure application ID, Interactions public key, intents, and bot token; enable `MESSAGE_CONTENT` where required. Current-user verification uses `GET /users/@me` and needs a test bot token.

If a credential-gated live test skips, report it as **not run (credentials unavailable)**. Never convert a skip into a pass.

## Ingress authentication and routing

Managed/native bridges use a fresh timestamp plus `Authorization: Bearer ...` or `X-Code-UX-Bridge-Token`; add a unique `X-Code-UX-Nonce` or `X-Request-Id` for durable replay rejection. Generic webhooks require their configured HMAC and fresh timestamp and do not fall back to bearer-only authentication. Official modes follow their provider's authentication contract rather than invented Code UX headers.

After authentication, Code UX normalizes provider identity and atomically inserts the external message ID before posting to chat. Duplicate provider retries return the existing delivery. For immediate-callback profiles, the acknowledgement is sent only after durable acceptance and model work continues asynchronously.

A binding stores provider connection, external channel, project, optional agent preset, selectors, and inbound/outbound/`suppressRichWidgets` flags. Project authorization comes from the persisted binding. If several projects share an external channel, a selector must choose exactly one; otherwise the delivery records `disambiguation_needed` and no project is guessed.

## Delivery state and control

Outbound replies exist only for turns sourced from connector ingress. Provider payload and lease fields stay private; public REST/MCP reads expose IDs, direction, status, attempts, sanitized error, and next retry time.

- `pending`: durable queue entry.
- `sending`: a worker owns the attempt lease.
- `delivered`: provider/bridge accepted the reply.
- `retryable_failure`: a durable next-attempt time exists.
- `failed`: terminal configuration, provider, ambiguity, or exhausted-attempt failure.
- `cancelled`: operator/runtime cancellation won before completion.

Workers use expiring compare-and-set leases. Restart recovery reclaims expired work; shutdown aborts HTTP/native/session work and releases owned leases safely. Manual retry requires explicit approval because it can duplicate a message. Provider-declared ambiguous outcomes are terminal so an automatic retry does not blindly resend.

## Secret migration and verification invalidation

Connector credentials are encrypted in a dedicated envelope table. Startup seals legacy plaintext rows only after secure key-provider readiness, commits with secret-version compare-and-set, and clears the legacy column only after success. Partial/failing migrations remain resumable. Restore the original key material and restart/rerun until the migration reports no pending rows; do not copy credentials back into plaintext as rollback.

Replacing or clearing secrets, switching bridge mode, or replacing setup invalidates verification. Display-name, enabled, or status-only edits preserve it. A transport edit to an active connection is demoted to the draft/reverification path.

## MCP examples

Create a draft official Telegram connection with placeholders:

```json
{
  "action": "create_connection",
  "providerKind": "telegram",
  "displayName": "Telegram test connector",
  "bridgeMode": "official_api",
  "status": "draft",
  "enabled": false,
  "setup": { "botUsername": "example_bot" },
  "secrets": {
    "botToken": "replace-with-test-token",
    "webhookSecret": "replace-with-test-webhook-secret"
  },
  "baseUrl": "https://codeux.example.test"
}
```

The response returns `/api/chat-providers/ingress/<id>` guidance and redacted credentials, never the two secret values.

Verify and inspect health:

```json
{ "action": "verify_connection", "providerConnectionId": "connection-example" }
```

```json
{ "action": "get_health" }
```

Bind a generic channel to an authorized test project:

```json
{
  "action": "create_channel_binding",
  "providerConnectionId": "connection-example",
  "externalChannelId": "channel-example",
  "externalChannelName": "Test channel",
  "projectId": "project-example",
  "routingHints": { "projectSelectorPrefix": "example" },
  "inboundEnabled": true,
  "outboundEnabled": true,
  "suppressRichWidgets": true
}
```

Inspect, retry with the two-call approval handshake, or cancel:

```json
{
  "action": "list_deliveries",
  "providerConnectionId": "connection-example",
  "direction": "outbound",
  "deliveryStatus": "retryable_failure",
  "limit": 25
}
```

```json
{ "action": "retry_delivery", "deliveryId": "delivery-example" }
```

Repeat the exact request only after human confirmation:

```json
{
  "action": "retry_delivery",
  "deliveryId": "delivery-example",
  "approval": { "confirmed": true }
}
```

```json
{ "action": "cancel_delivery", "deliveryId": "delivery-example" }
```

Expected failure contracts are sanitized:

```json
{
  "status": "failed",
  "providerErrorCode": "invalid_auth",
  "retryable": false,
  "issues": ["Provider authentication failed."],
  "diagnostics": { "capability": "authentication", "status": "missing" }
}
```

Validation rejects unsupported modes/fields and bounds delivery limits to 1-500. Unauthorized bindings/deliveries fail against persisted project ownership. Verification times out with `verification_timeout` and `retryable: true`. Provider 429/temporary outages schedule retry; terminal authentication/permission failures require operator correction.

## Rollback

To revert a failed provider-native rollout without deleting known-good configuration:

1. Disable the new connection or its inbound/outbound binding.
2. Re-enable the existing managed/custom bridge connection and its previously verified binding.
3. Confirm its ingress URL, bridge credentials, project selectors, and recent health/delivery state.
4. Leave the new connection disabled for evidence collection; cancel pending deliveries that must not be sent.
5. Delete the failed connection only after approval and retention review, because deletion cascades its bindings and delivery history.

See [Security Hardening](../operations/security-hardening.md) and [Operations Runbook](../operations/runbook.md) for incident-specific recovery.
