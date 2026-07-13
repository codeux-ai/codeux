# Microsoft Teams Connector Profile

The Microsoft Teams connector retains the `managed_bridge` and custom `webhook` transports and adds a direct `official_api` profile based on Microsoft Bot Connector Activities.

## Configuration contract

`official_api` stores the non-secret Microsoft app ID, `MultiTenant` or `SingleTenant` application type, and optional tenant ID in connection setup. The client secret is a required write-only credential. Single-tenant configurations require a tenant ID; a tenant ID on a multi-tenant configuration acts as an inbound tenant restriction.

No setup field accepts an official Connector service URL. The service URL is learned only from an authenticated Activity and stored in its conversation reference after claim and host validation.

## Authentication boundary

`MicrosoftBotAuthService` owns provider-specific trust and transport behavior:

1. Read a Bearer JWT from the request header and require `RS256`.
2. Load Microsoft's fixed Bot Connector OpenID metadata and JWKS documents, validate their fixed issuer/JWKS/algorithm contract, and cache signing keys for at most 24 hours.
3. Refresh once within a bounded interval when a previously unseen key ID indicates rotation.
4. Verify the RSA signature, issuer, app-ID audience, `nbf`/`iat`/`exp` window with five-minute skew, exact Activity/JWT service URL match, channel endorsement, and configured tenant.
5. Accept only HTTPS service URLs on the documented public, GCC, GCC High, and DoD Teams Connector host allowlist; arbitrary `*.botframework.com` subdomains are rejected.

There is no insecure mode for disabling signature, claim, endorsement, tenant, or service URL validation. Authentication output contains the Activity, normalized message, and a durable conversation reference, but never the Bearer JWT or signing key.

## Activity mapping

Only `message` Activities enter chat ingestion. Unsupported types fail before delivery or conversation-message creation. The normalizer removes the bot recipient's mention entity from visible text while leaving other mentions intact and preserves:

- Activity, conversation, and reply IDs;
- locale and Bot Framework channel ID;
- tenant, team, and Teams channel IDs;
- original sender, bot recipient, and conversation account; and
- an authenticated `serviceUrlValidated: true` conversation reference.

The conversation reference is safe to persist with delivery metadata because it contains routing identities and the validated URL, not access tokens, client secrets, JWTs, or signing keys.

## Outbound transport

The service acquires app-only OAuth tokens from Microsoft's documented v2 client-credential endpoint. Multi-tenant apps use the `botframework.com` authority and single-tenant apps use their configured tenant. Tokens request `https://api.botframework.com/.default`, remain memory-only, and expire from the cache before their provider expiry.

Replies are posted with the token to the persisted reference's validated service URL at `/v3/conversations/{conversationId}/activities/{activityId}`. The reply Activity swaps the original sender/recipient, retains conversation and locale, and sets `replyToId` to the triggering Activity ID. IDs are path-encoded, request timeouts are bounded, and arbitrary setup URLs never participate in official transport.

## Diagnostics and local verification

Diagnostics have stable categories for app identity, token acquisition, OpenID metadata, JWKS retrieval, tenant mismatch, expired signing keys, unusable signing-key sets, throttling, and unavailable or timed-out Microsoft services. Signing metadata is healthy only when at least one active RSA/RS256 verification key is importable and endorses `msteams`. Retryability is explicit and upstream bodies are not exposed as credential-bearing diagnostics.

Microsoft offers Bot Framework Emulator and Microsoft 365 Agents/Teams development tooling for local bot testing, not a public unauthenticated sandbox. The automated suite therefore uses local RSA keys plus mocked OpenID, JWKS, OAuth, and Connector responses, including Emulator-shaped Activity fixtures, without contacting Microsoft tenant services.

References: [Bot Connector authentication](https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-authentication?view=azure-bot-service-4.0), [send and receive messages](https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-send-and-receive-messages?view=azure-bot-service-4.0), [Activity protocol](https://learn.microsoft.com/en-us/microsoft-365/agents-sdk/activity-protocol), and [local bot testing](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/debug/locally-with-an-ide).
