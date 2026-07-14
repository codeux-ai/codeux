# iMessage Chat Connector

Code UX supports iMessage only through operator-selected third-party bridge contracts. It does not connect directly to an Apple messaging endpoint, claim Apple endorsement, or read the local Messages database.

## Supported modes

| Mode | Contract | Configuration |
| --- | --- | --- |
| `managed_bridge` | A third-party managed HTTP bridge operated or selected by the user | Existing managed records retain `workspaceId`, `deviceLabel`, and the required `bridgeApiKey`; the bridge URL continues to resolve from the stored bridge URL fields. |
| `native_bridge` | A local third-party command controlled by the operator | Existing native records retain `command`, optional `workingDirectory`, and optional outbound `bridgeToken`. A `bridgeToken` is required if the command also submits inbound requests to Code UX. |

These are the only supported modes. `official_api` is not an iMessage mode, and provider-native endpoint verification is explicitly unavailable.

Apple's public material describes [Messages framework app extensions](https://developer.apple.com/documentation/messages), [iMessage apps and stickers](https://developer.apple.com/imessage/), and [in-app message composition UI](https://developer.apple.com/documentation/messageui). Those references do not publish a general-purpose server bot API for personal iMessage accounts or a public personal-iMessage bot sandbox. The bridge contract is therefore a Code UX contract for third-party/local software, not an Apple API contract or Apple-certified automation.

## Bridge protocol v1

Native commands receive one UTF-8 JSON object on stdin and return one UTF-8 JSON object on stdout. Managed health and send operations use the same envelope as the HTTP request and response body. Protocol version `1.0` defines these stable top-level fields:

```json
{
  "protocolVersion": "1.0",
  "operation": "send",
  "correlation": { "id": "request-correlation-id" },
  "message": {
    "guid": "local-message-id",
    "text": "Reply text",
    "timestamp": null
  },
  "chat": { "guid": "opaque-chat-guid", "name": "Display name" },
  "sender": { "id": null, "name": null },
  "reply": {
    "messageGuid": "opaque-message-guid-being-replied-to",
    "threadId": "code-ux-thread-id"
  },
  "result": null,
  "error": null
}
```

Health checks use `"operation": "health_check"`; `message`, `chat`, `sender`, and `reply` are `null`. A successful response echoes the protocol, operation, and correlation fields and supplies:

```json
{
  "result": {
    "status": "healthy",
    "messageGuid": null,
    "chatGuid": null,
    "metadata": {}
  },
  "error": null
}
```

A send result uses `"operation": "send"`, `"status": "sent"`, the request correlation id, and the bridge's opaque `messageGuid` and `chatGuid`. Managed and native send delivery reject health-check responses, mismatched correlations, missing protocol fields, and malformed result/error values. An error response sets `result` to `null` and returns stable `code`, `message`, and `retryable` fields under `error`. GUIDs are treated as opaque Unicode identifiers: Code UX trims them, normalizes Unicode composition, rejects control characters and unreasonable lengths, and never infers undocumented Apple payload structure.

For existing native command records, v1 send requests also contain the former top-level send aliases during migration. A legacy response containing `externalMessageId` remains accepted for sends. Health checks always require protocol `1.0` and matching correlation identity.

## Process and secret boundary

The native command string is parsed into an executable and argument array, then spawned with shell interpretation disabled. Quoted paths, spaces, macOS application paths, and Windows drive paths remain arguments rather than executable shell text. The configured executable and working directory remain under explicit operator control.

The child receives a minimal operating-system environment. The bridge credential is exposed only as `CODEUX_CHAT_BRIDGE_TOKEN`; it is never added to argv or stdin. Stdout and stderr have byte limits, error diagnostics redact the configured credential, and every execution has a timeout. Cancellation, runtime shutdown, timeout, or output overflow terminates the complete spawned process group, with a forced-kill fallback.

New records should use `bridgeApiKey` for managed delivery and `bridgeToken` for native delivery. Existing stored outbound records remain compatible with the prior managed fallback order (`bridgeToken`, `botToken`, then `webhookSecret`) and native fallback order (`botToken`, then `webhookSecret`). These outbound fallbacks do not weaken inbound authentication, which still resolves only the mode's declared bearer credential.

Inbound callbacks in both modes use the shared timestamped bearer verifier and replay-nonce cache. Senders should provide `Authorization: Bearer <credential>` (or `X-Code-UX-Bridge-Token`), `X-Code-UX-Timestamp`, and a unique `X-Code-UX-Nonce` or `X-Request-Id`.

## Health verification

Bridge verification is deterministic and reports machine-readable diagnostics for unsupported platforms, missing executables, permission failures, invalid configuration, protocol-version or correlation mismatches, timeouts, cancellation, shutdown, oversized output, malformed JSON, bridge errors, nonzero exits, network errors, and HTTP errors.

Managed verification accepts only HTTP(S) third-party bridge URLs. Apple-owned hostnames are rejected as `provider_native_verification_unavailable`. Native verification runs only the configured command. The automated test suite uses Node-powered local fixtures and mocked HTTP responses; it does not contact Apple, invoke AppleScript, inspect the Messages database, or use a Messages account.
