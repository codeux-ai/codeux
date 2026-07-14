# Chat Connector Profiles

Each supported external chat connector has an independently editable runtime profile. A profile owns its setup schema, implemented transport modes, ingress authentication and normalization, conversation identity rules, outbound mapping, verification capabilities, session requirements, official references, and lifecycle metadata.

The additive `official_api` bridge mode is implemented by WhatsApp, Telegram, Slack, Microsoft Teams, and Discord. A connector page lists only modes its profile implements; existing `managed_bridge`, `webhook`, and `native_bridge` records keep their established meaning.

## Providers

- [WhatsApp](./whatsapp.md)
- [iMessage](./imessage.md)
- [Telegram](./telegram.md)
- [Slack](./slack.md)
- [Microsoft Teams](./microsoft-teams.md)
- [Discord](./discord.md)

Provider profiles contain no connection secrets and registry construction performs no network requests or process execution.
