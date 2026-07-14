# Discord Chat Connector

The baseline Discord profile supports only `webhook`, matching the existing bot/webhook gateway contract. It normalizes Discord message payloads and deliberately does not advertise managed, native, or direct official API delivery.

Setup remains compatible with stored connections: optional `gatewayUrl` and `applicationId`, required `botToken`, and optional `webhookSecret`. A bot or gateway session owns provider event delivery.

Live provider testing is not implemented by this baseline profile.

Official references: [receiving interactions](https://docs.discord.com/developers/interactions/receiving-and-responding) and [message resources](https://docs.discord.com/developers/resources/message).
