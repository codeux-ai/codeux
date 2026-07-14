# Chat Connector Registry

Code UX registers one typed, independently editable profile for each external chat connector. Profiles own setup schemas, implemented transport modes, authentication and handshake metadata, inbound normalization, external identity, outbound construction and parsing, verification capabilities, session requirements, official references, live-test availability, and lifecycle state.

The registry is static and side-effect free. Network requests and native command execution remain in service-layer facades. Lookup fails closed when a provider or provider/mode combination is not registered.

The `official_api` mode is provider-native and does not change the persisted meaning of `managed_bridge`, `webhook`, or `native_bridge`. Profiles advertise only implemented modes. Registry presence is not provider certification or production readiness, and a skipped credential-gated test is not a live pass.

## Provider Profiles

- [WhatsApp](./whatsapp.md)
- [iMessage](./imessage.md)
- [Telegram](./telegram.md)
- [Slack](./slack.md)
- [Microsoft Teams](./microsoft-teams.md)
- [Discord](./discord.md)
