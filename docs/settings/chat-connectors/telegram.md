# Telegram Chat Connector

The baseline Telegram profile supports `managed_bridge` and `webhook`. It normalizes Telegram Bot API message and channel-post payloads while preserving generic bridge payload overrides.

Setup remains compatible with stored connections: managed setup uses optional `workspaceId` and `botUsername` with `bridgeApiKey`; webhook setup uses `webhookUrl`, optional `botUsername`, `botToken`, and optional `webhookSecret`.

Live provider testing and direct `official_api` transport are not implemented by this baseline profile.

Official reference: [Telegram Bot API](https://core.telegram.org/bots/api).
