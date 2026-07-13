# iMessage Chat Connector

The baseline iMessage profile supports `managed_bridge` and `native_bridge`. Native delivery keeps the local command contract, writing the outbound JSON payload to stdin and optionally exposing a bridge token to the child process environment.

Setup remains compatible with stored connections: managed setup uses optional `workspaceId` and `deviceLabel` with `bridgeApiKey`; native setup uses `command`, optional `workingDirectory`, and optional `bridgeToken`.

The profile requires a reachable bridge session. Live provider testing and direct `official_api` transport are not implemented.

Official reference: [Apple Messages](https://developer.apple.com/documentation/messages).
