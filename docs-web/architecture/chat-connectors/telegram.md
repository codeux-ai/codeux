# Telegram Connector Profile

Telegram implements `managed_bridge`, `webhook`, and direct `official_api` transports. The two legacy modes preserve their existing schemas, bridge URL fallbacks, authentication metadata, response parsing, and retry classification. Only `official_api` can call Telegram directly.

## Official ingress contract

Official webhook authentication uses a dedicated header-secret descriptor. The security facade compares `X-Telegram-Bot-Api-Secret-Token` exactly and in constant time against the write-only `webhookSecret`; this path intentionally bypasses timestamp, replay-nonce, and synthetic HMAC requirements.

The profile selects `message`, `channel_post`, `edited_message`, or `edited_channel_post` from each Bot API `Update`. It normalizes numeric identifiers without 32-bit coercion and constructs the inbound idempotency key from `update_id`, chat ID, and message ID. Forum `message_thread_id` remains in the update metadata and profile identity so outbound mapping can return to the same topic. Bot-authored messages are acknowledged as ignored before routing or delivery creation.

## Official outbound contract

The profile builds only `POST https://api.telegram.org/bot<token>/sendMessage` requests. It does not read endpoint overrides from connection setup. The request maps:

| Code UX source | Bot API field |
| --- | --- |
| Bound external channel | `chat_id` |
| Retained forum topic | `message_thread_id` |
| Sanitized reply text | `text` (maximum 4,096 Unicode code points) |
| Source Telegram message | `reply_parameters.message_id` |

The adapter never adds a bearer header for official mode. It parses `ok`, `result`, `error_code`, `description`, and `parameters.retry_after` independently of the HTTP status. Consequently, an `ok: false` response at HTTP `200` fails delivery, while `429` records the provider-specified retry time. Network and timeout failures are terminal because Telegram may have accepted the message before the response was lost; retrying would risk a duplicate external message.

The token-bearing request URL is transient. Error text, logs, response metadata, and persisted deliveries do not contain it.

## Verification

The profile advertises live verification for `official_api`. Verification calls `getMe`, optionally checks the configured username, and returns sanitized `getWebhookInfo` diagnostics. It requires explicitly configured test bot credentials; a skipped credential-gated check is not a pass. It never invokes webhook mutation methods, so checking a connection cannot replace or delete an operator-managed webhook.

Registry construction remains static and performs no network requests. Provider calls occur only through explicit outbound delivery or live verification actions.

Official reference: [Telegram Bot API](https://core.telegram.org/bots/api).
