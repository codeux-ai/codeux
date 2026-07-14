# Microsoft Teams Connector Profile

Microsoft Teams is registered with `managed_bridge` and `webhook` transports. Its module owns the unchanged setup schemas, Bot Framework activity normalizer, ingress authentication metadata, outbound request mapping, response parsing, configuration verification, and official reference metadata.

The baseline profile has no live test and does not implement `official_api`. Registry construction never contacts Microsoft services.
