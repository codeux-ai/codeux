# Telegram Chat Connector

Telegram supports three connection modes. `official_api` connects Code UX directly to Telegram's provider-controlled Bot API. `managed_bridge` and `webhook` retain the existing managed and custom bridge contracts.

## Official Bot API setup

Choose `official_api` and configure:

| Field | Required | Storage | Purpose |
| --- | --- | --- | --- |
| Bot username | No | Setup | Optional identity check, with or without a leading `@` |
| Bot token | Yes | Write-only secret | Authenticates `getMe`, `getWebhookInfo`, and `sendMessage` |
| Webhook secret token | Yes | Write-only secret | Matches Telegram's `secret_token` value for webhook delivery |

Configure the bot's Telegram webhook to the connection's Code UX ingress URL and pass the same webhook secret token as Telegram's `secret_token`. The secret must contain 1-256 characters from `A-Z`, `a-z`, `0-9`, `_`, and `-`. Webhook configuration remains an explicit operator action: connection verification never calls `setWebhook` or `deleteWebhook`.

Telegram webhook requests are authenticated only by an exact, constant-time comparison of `X-Telegram-Bot-Api-Secret-Token`. Official ingress does not expect Code UX HMAC, signature, nonce, or timestamp headers because Telegram does not send them.

## Inbound updates

The official profile accepts text or caption content from:

- `message`
- `channel_post`
- `edited_message`
- `edited_channel_post`

Duplicate control combines `update_id`, chat ID, and message ID. Telegram identifiers are preserved as decimal strings where Code UX stores external identity, including chat and user identifiers larger than signed 32-bit values. `message_thread_id` is retained for replies into forum topics. Updates whose `from.is_bot` value is true are acknowledged and ignored to prevent reply loops.

Unsupported update kinds or message objects without text/caption content are not converted into Code UX messages.

## Replies and failure handling

Official replies always use Telegram's fixed `api.telegram.org` Bot API origin and `sendMessage`; setup values cannot override that origin. Code UX sends the bound `chat_id`, retained `message_thread_id` when present, and `reply_parameters.message_id` for the source message. Text is bounded to Telegram's 4,096-character `sendMessage` limit without splitting Unicode surrogate pairs.

Code UX validates the Bot API response envelope even when the HTTP response is `200`. A response succeeds only when `ok` is true and the returned message contains `message_id`. Error responses retain the Bot API `error_code` and `description`; a `429` uses `parameters.retry_after` as the exact retry delay.

Timeouts and transport failures after dispatch have an ambiguous delivery outcome, so official mode records them as terminal failures instead of automatically sending a possible duplicate. The bot token is never placed in persisted delivery metadata or log messages, including as part of a Bot API URL.

## Verification and diagnostics

Official verification calls `getMe` to validate the bot token and bot identity, then calls the read-only `getWebhookInfo` method. Diagnostics include the bot identity, whether a webhook is configured, pending update count, allowed updates, connection limits, and the latest webhook delivery error when Telegram supplies one. Verification does not alter the existing webhook.

## Legacy bridges

- `managed_bridge` keeps optional `workspaceId` and `botUsername` setup with the required `bridgeApiKey` secret.
- `webhook` keeps required `webhookUrl`, optional `botUsername`, required `botToken`, and optional `webhookSecret`. Its endpoint and generic HMAC bridge contract remain unchanged.

Custom outbound endpoints are available only through these explicit legacy modes. They are never considered by `official_api`.

Official reference: [Telegram Bot API](https://core.telegram.org/bots/api).
