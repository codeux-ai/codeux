# Microsoft Teams Chat Connector

The Microsoft Teams profile supports three connection modes:

- `managed_bridge` keeps the existing managed-plugin contract (`pluginName`, optional `tenantId`, and write-only `bridgeApiKey`).
- `webhook` keeps the existing custom bot-webhook contract (`botEndpointUrl`, optional `tenantId`, write-only `botAppPassword`, and optional `webhookSecret`).
- `official_api` uses the Microsoft Bot Connector Activity and authentication protocols directly.

## Official API setup

Configure `official_api` with:

| Setting | Required | Purpose |
| --- | --- | --- |
| `microsoftAppId` | Yes | Audience used for incoming Connector JWTs and client ID used for outgoing OAuth tokens. |
| `applicationType` | Yes | `MultiTenant` or `SingleTenant`. Defaults to `MultiTenant`. |
| `tenantId` | For `SingleTenant` | Selects the tenant OAuth endpoint and restricts accepted Teams Activities to that tenant. For a multi-tenant app, supplying it also acts as a tenant allowlist. |
| `clientSecret` | Yes, write-only | Microsoft Entra client secret used only for OAuth client-credential requests. |

Do not enter a Bot Connector `serviceUrl` in setup. Code UX accepts a service URL only after it appears in a successfully authenticated Activity, exactly matches the JWT `serviceUrl` claim, and resolves to a documented Bot Framework host. This prevents a connection record or inbound payload from selecting an arbitrary outbound host.

## Incoming Activities

The official path requires a Bearer JWT in the `Authorization` header. Validation fails closed unless all of these checks pass:

- the token uses `RS256` and a key from Microsoft's fixed Bot Connector OpenID metadata and JWKS endpoints;
- issuer is `https://api.botframework.com` and audience is the configured Microsoft app ID;
- `nbf`, `iat` when present, and `exp` are valid with the documented five-minute clock skew;
- the JWT `serviceUrl` claim exactly matches the Activity `serviceUrl`;
- the signing key endorses the Activity's channel ID (`msteams` for Teams);
- the Activity tenant matches the configured tenant policy; and
- the service URL uses HTTPS and a documented Bot Framework/Teams Connector host.

Signing keys are cached for no more than 24 hours. An unknown key ID can trigger one bounded refresh so normal Microsoft key rotation works without allowing unlimited JWKS fetches.

Only `message` Activities create Code UX chat messages. `conversationUpdate`, `event`, `invoke`, `typing`, and unknown Activity types are rejected by the message normalizer. For accepted messages, Code UX removes the bot's own mention from user-visible text while preserving other mentions. It retains locale, tenant, team/channel, conversation, reply, sender/recipient, and the authenticated service URL in a durable conversation reference. Tokens, JWTs, client secrets, and signing keys are not copied into delivery payloads.

## Replies and token caching

For multi-tenant apps, Code UX requests a client-credential token from:

```text
https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token
```

For single-tenant apps, `botframework.com` is replaced by the configured tenant ID. The scope is `https://api.botframework.com/.default`. Access tokens remain in memory and are reused only until a safe pre-expiry boundary; they are never persisted.

Replies use the authenticated, persisted conversation reference and are sent to:

```text
{validated-serviceUrl}/v3/conversations/{conversationId}/activities/{activityId}
```

The reply Activity swaps the original sender and recipient, preserves the conversation and locale, and sets `replyToId` to the incoming Activity ID.

## Diagnostics

Connection diagnostics return stable codes instead of Microsoft response bodies or credentials. They distinguish invalid app identity, token acquisition failure, OpenID metadata failure, JWKS failure, tenant mismatch, expired signing keys, Microsoft throttling, and unavailable/timeout conditions. HTTP `429` and transient Microsoft service failures are marked retryable; invalid identity, claims, signatures, endorsements, tenants, and service URLs are terminal until configuration or input changes.

## Local testing

Microsoft does not provide a public unauthenticated Bot Connector sandbox. Use Bot Framework Emulator or Microsoft 365 Agents/Teams local development tooling with mocked OpenID, JWKS, OAuth, and Connector boundaries for automated tests. Emulator-shaped Activities are useful normalization fixtures, but localhost is not trusted as an official Connector service URL and there is no switch that bypasses JWT, signature, endorsement, tenant, or service URL validation.

Official references:

- [Bot Connector authentication](https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-authentication?view=azure-bot-service-4.0)
- [Send and receive messages](https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-send-and-receive-messages?view=azure-bot-service-4.0)
- [Activity protocol](https://learn.microsoft.com/en-us/microsoft-365/agents-sdk/activity-protocol)
- [Local bot testing](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/debug/locally-with-an-ide)
