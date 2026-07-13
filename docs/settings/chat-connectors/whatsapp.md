# WhatsApp Chat Connector

The WhatsApp profile supports the direct Meta Cloud API as `official_api` while retaining the existing `managed_bridge` and generic `webhook` records unchanged.

## Official Cloud API setup

Configure these non-secret fields:

- `graphApiVersion`: a version in `v{major}.{minor}` form, such as `v23.0`.
- `phoneNumberId`: the numeric ID of the business phone number that receives and sends messages.
- `appId` and `businessAccountId`: optional Meta application metadata.

Configure `accessToken`, `appSecret`, and `webhookVerifyToken` as secret fields. They are write-only connection credentials and are never returned in connection responses. Official mode always uses `https://graph.facebook.com`; it does not accept a custom Graph host or fall back to a configured webhook URL.

## Webhooks

For Meta's GET subscription check, the profile accepts only `hub.mode=subscribe` with a constant-time match against the configured `webhookVerifyToken`, then returns `hub.challenge`. Other modes, missing values, and token mismatches fail closed.

For POST callbacks, the runtime validates `X-Hub-Signature-256` as an HMAC-SHA256 over the exact raw request bytes with `appSecret`. Meta does not supply a request timestamp, so official mode explicitly authenticates the raw body without one; timestamp freshness remains required for existing managed and generic webhook authentication modes. Parsing or reserializing JSON before verification changes the signed bytes and must fail validation.

Message callbacks and delivery/status callbacks are normalized separately. Only message callbacks enter the inbound conversation flow; status-only callbacks receive a successful `ignored` acknowledgement without creating a delivery or conversation message. The business `metadata.phone_number_id` is the external channel, the inbound message `wamid` is the idempotency key, and `messages[].from` is retained as the sender and future outbound recipient. Text bodies and image, video, or document captions are supported.

## Outbound replies and verification

Official text and reply requests are sent only to:

```text
https://graph.facebook.com/{graphApiVersion}/{phoneNumberId}/messages
```

Requests include `messaging_product: whatsapp`; replies also include `context.message_id`. The recipient is the original sender WhatsApp ID, never the business phone-number channel ID. Successful `messages[].id` values are retained as outbound `wamid` delivery IDs. Non-2xx Graph responses are classified through sanitized status, error-code, subcode, and transient metadata so structured Meta throttling errors can retry without echoing tokens or recipient data.

Connection verification is read-only. It performs a GET for the configured test or registered phone-number resource and checks that Meta returns the same ID. It never sends a WhatsApp message. Send-based testing remains reserved for the separately opted-in Meta test-number workflow.

## Legacy compatibility

Managed setup still uses `pluginName`, optional `workspaceId`, and `bridgeApiKey`. Generic webhook setup still uses `webhookUrl`, optional `verifyTokenName`, `webhookSecret`, and optional `verifyToken`. Their URL fallback, credential lookup, payload, response parsing, and stored record meanings are unchanged.

Official references: [WhatsApp Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api), [Meta Webhooks](https://developers.facebook.com/docs/graph-api/webhooks/getting-started), and [Meta's WhatsApp Business Platform Postman collection](https://www.postman.com/meta/whatsapp-business-platform/overview).
