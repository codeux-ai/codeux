# WhatsApp Connector Profile

WhatsApp implements `managed_bridge`, `webhook`, and direct Meta Cloud API `official_api` transport. The legacy schemas and bridge mappings retain their original meaning; official mode is additive.

The official profile fixes Graph traffic to `https://graph.facebook.com/{version}/{phoneNumberId}` and validates both path components before building a request. Outbound messages use the original inbound sender WhatsApp ID as `to`, while `metadata.phone_number_id` remains the channel binding. Replies map the inbound `wamid` to `context.message_id`, and successful response `wamid` values become outbound delivery IDs.

Webhook hooks implement Meta's `hub.mode`, `hub.verify_token`, and `hub.challenge` GET handshake and verify POST `X-Hub-Signature-256` values over exact raw bytes with the app secret. Official authentication explicitly opts out of the shared timestamp requirement because Meta does not send one; all existing profiles retain timestamp enforcement by default. Message and status payloads are discriminated before normalization, and status-only callbacks return an `ignored` acknowledgement without creating delivery or conversation records. Text and media-caption message bodies are supported.

The profile exposes read-only verification of the configured phone-number resource even when the separate live-test/send capability is disabled. It uses a bounded timeout and supplies the shared outbound facade with a mode-aware, sanitized classifier for structured Meta error codes, including error envelopes carried by HTTP 200 responses. Response parsing receives the active bridge mode, HTTP status, and headers: only `official_api` interprets Graph envelopes, while managed and webhook modes retain legacy parsing and raw non-2xx error behavior. Returned official errors and verification metadata omit access tokens and recipient values. Normal verification never sends a message; the separate opted-in Meta test-number path owns any future send-based test.

Credentials (`accessToken`, `appSecret`, and `webhookVerifyToken`) remain secret-schema fields and are not exposed through public connection records. Official mode cannot use a custom Graph host or silently fall back to the generic webhook URL.

References: [WhatsApp Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api), [Meta Webhooks](https://developers.facebook.com/docs/graph-api/webhooks/getting-started), and [Meta's official Postman collection](https://www.postman.com/meta/whatsapp-business-platform/overview).
