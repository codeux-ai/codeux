# Chat Connector Profiles

Each supported external chat connector has an independently editable runtime profile. A profile owns its setup schema, implemented transport modes, ingress authentication and normalization, conversation identity rules, outbound mapping, verification capabilities, session requirements, official references, and lifecycle metadata.

The `official_api` mode is provider-native; managed, webhook, and native modes remain operator-selected bridge contracts. A connector page lists only modes its profile implements, and existing bridge records keep their established endpoint meaning when official support is added.

Registry presence is an advertised software contract, not provider certification or proof that a connection is production-ready. Credential-gated tests that skip are not live passes; each provider page states its actual verification eligibility and sandbox limitations.

## Providers

- [WhatsApp](./whatsapp.md)
- [iMessage](./imessage.md)
- [Telegram](./telegram.md)
- [Slack](./slack.md)
- [Microsoft Teams](./microsoft-teams.md)
- [Discord](./discord.md)

Provider profiles contain no connection secrets and registry construction performs no network requests or process execution.
