# Slack Chat Connector

The baseline Slack profile supports `managed_bridge` and `webhook`. Webhook ingress retains the Slack-compatible `v0` signature base alongside the existing bridge signature forms, timestamp freshness checks, and Events API normalization.

Setup remains compatible with stored connections: managed setup uses `pluginName` and optional `workspaceId` with `bridgeApiKey`; webhook setup uses `eventsUrl`, optional `appId`, `signingSecret`, and optional `botToken`.

Live provider testing and direct `official_api` transport are not implemented by this baseline profile.

Official references: [Slack Events API](https://api.slack.com/apis/connections/events-api) and [request verification](https://api.slack.com/docs/verifying-requests-from-slack).
