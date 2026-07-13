# iMessage Connector Architecture

The iMessage profile is a transparent third-party bridge contract. It advertises only `managed_bridge` and `native_bridge`; it does not expose `official_api`, imply Apple endorsement, or verify an Apple provider endpoint.

Apple documents the [Messages framework](https://developer.apple.com/documentation/messages) for app extensions, [iMessage apps and Messages for Business experiences](https://developer.apple.com/imessage/), and [Message UI](https://developer.apple.com/documentation/messageui) for composing messages inside apps. Those public surfaces do not define a general-purpose personal-iMessage server bot API or public personal-account sandbox. Consequently, Code UX models bridge-owned identifiers without treating third-party payloads as undocumented Apple objects.

## Profile boundary

`src/domain/chat-connectors/providers/imessage.ts` owns:

- the unchanged persisted setup schemas for existing managed and native records;
- shared bearer authentication metadata for both inbound modes;
- opaque message/chat GUID normalization and reply/thread identity mapping;
- the version `1.0` send and health envelope;
- managed HTTP and native command request mapping; and
- the explicit `liveTest.available = false` provider-native verification declaration.

The protocol envelope always contains `protocolVersion`, `operation`, `correlation`, `message`, `chat`, `sender`, `reply`, `result`, and `error`. Send requests fill message/chat/reply data and leave result/error null. Health requests leave identity fields null. Send parsing requires `operation: send`, `result.status: sent`, every stable field, and the request's correlation id, so a health response or malformed envelope cannot complete outbound delivery. Failures return stable `error.code`, `error.message`, and `error.retryable` values. Existing native records receive transitional top-level send aliases, and recognized legacy message-id send responses remain readable; health negotiation is strict.

Inbound HTTP routes still pass through `ChatProviderIngressSecurity`. Both modes require a fresh timestamp and use the shared constant-time bearer check plus nonce replay cache. The native setup schema keeps `bridgeToken` optional for outbound-only commands, but a native bridge posting inbound events must configure it because ingress fails closed without a secret.

Outbound credential lookup preserves stored-record compatibility. Managed delivery checks `bridgeApiKey`, `bridgeToken`, `botToken`, then `webhookSecret`; native delivery checks `bridgeToken`, `botToken`, then `webhookSecret`. Inbound verification remains restricted to the declared credential for its mode.

## Native execution boundary

`src/services/chat-providers/imessage-native-bridge.ts` is the process and bridge-health boundary. The default outbound adapter routes iMessage native sends through it.

The service:

- parses legacy command records into an executable plus argv without shell evaluation;
- preserves quoted arguments, spaces, macOS paths, and Windows drive-path separators;
- spawns with `shell: false` and writes exactly one JSON request to stdin;
- inherits only a minimal OS environment and exposes the bridge secret solely as `CODEUX_CHAT_BRIDGE_TOKEN`;
- bounds stdout, stderr, managed response bodies, and execution time;
- redacts the configured credential from errors;
- negotiates protocol/correlation/result fields before accepting a health result; and
- tracks active children so cancellation, timeout, output overflow, disposal, or runtime shutdown terminates the process group and escalates to a forced kill.

Native health diagnostics distinguish `unsupported_platform`, `missing_executable`, `permission_denied`, `protocol_version_mismatch`, `correlation_mismatch`, `timeout`, `cancelled`, `shutdown`, `output_limit_exceeded`, `malformed_response`, `nonzero_exit`, `spawn_failed`, and bridge-declared errors. Managed checks add deterministic network and HTTP diagnostics.

Managed health accepts only third-party HTTP(S) URLs and rejects Apple-owned hosts as `provider_native_verification_unavailable`. Tests use Node subprocess fixtures and mocked Fetch responses on every platform. No test calls an Apple network endpoint, uses AppleScript, reads the local Messages database, or signs into a real Messages account.
