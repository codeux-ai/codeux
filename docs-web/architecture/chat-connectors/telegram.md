# Telegram Connector Profile

Telegram is registered with `managed_bridge` and `webhook` transports. Its module owns the unchanged setup schemas, Bot API update normalizer, ingress authentication metadata, outbound mapping and response parsing, configuration verification, and official documentation reference.

The baseline profile has no live test and does not implement `official_api`. Registry construction never contacts Telegram.
