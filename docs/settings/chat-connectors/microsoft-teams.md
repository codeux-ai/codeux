# Microsoft Teams Chat Connector

The baseline Microsoft Teams profile supports `managed_bridge` and `webhook`. It normalizes Bot Framework-style activity payloads and keeps delivery behind the configured managed or bot webhook bridge.

Setup remains compatible with stored connections: managed setup uses `pluginName` and optional `tenantId` with `bridgeApiKey`; webhook setup uses `botEndpointUrl`, optional `tenantId`, `botAppPassword`, and optional `webhookSecret`.

Live provider testing and direct `official_api` transport are not implemented by this baseline profile.

Official reference: [Teams conversational bots](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/build-conversational-capability).
