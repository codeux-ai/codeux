# WhatsApp Chat Connector

The baseline WhatsApp profile supports `managed_bridge` and `webhook`. Managed delivery uses the existing bridge contract; webhook ingress retains HMAC authentication and WhatsApp Cloud API payload normalization.

Setup remains compatible with stored connections: managed setup uses `pluginName` and optional `workspaceId` with `bridgeApiKey`; webhook setup uses `webhookUrl`, optional `verifyTokenName`, `webhookSecret`, and optional `verifyToken`.

Live provider testing and direct `official_api` transport are not implemented by this baseline profile.

Official reference: [WhatsApp Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api).
