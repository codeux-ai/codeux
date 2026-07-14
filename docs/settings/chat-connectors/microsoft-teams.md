# Microsoft Teams Chat Connector

Microsoft Teams supports three explicit modes:

- `managed_bridge`: the existing managed-plugin contract (`pluginName`, optional `tenantId`, and write-only `bridgeApiKey`).
- `webhook`: the existing custom bot-webhook contract (`botEndpointUrl`, optional `tenantId`, write-only `botAppPassword`, and optional `webhookSecret`).
- `official_api`: Microsoft Bot Connector Activity and authentication protocols.

Managed and webhook endpoints are operator-selected bridges. Their presence in the registry is not Microsoft certification or a production-readiness claim.

## Official API setup

| Setting | Required | Purpose |
| --- | --- | --- |
| `microsoftAppId` | Yes | Audience for incoming Connector JWTs and client ID for outgoing OAuth tokens. |
| `applicationType` | Yes | `MultiTenant` or `SingleTenant`; defaults to `MultiTenant`. |
| `tenantId` | `SingleTenant` only | Selects the tenant authority and restricts accepted Activities. On multi-tenant setup it acts as an optional tenant allowlist. |
| `clientSecret` | Yes, write-only | Microsoft Entra client secret used for OAuth client credentials. |

Do not configure a Bot Connector `serviceUrl`. Code UX accepts one only after it appears in an authenticated Activity, exactly matches the JWT claim, and uses a documented Bot Framework host. Setup and unauthenticated payloads cannot select an arbitrary outbound host.

## Incoming Activities

Official ingress requires a Bearer JWT and fails closed unless:

- it uses `RS256` and a key from Microsoft's fixed Bot Connector OpenID metadata/JWKS endpoints;
- issuer is `https://api.botframework.com` and audience is the configured app ID;
- `nbf`, optional `iat`, and `exp` are valid with five-minute skew;
- JWT and Activity `serviceUrl` values match exactly;
- the signing key endorses the Activity channel (`msteams` for Teams);
- the Activity tenant satisfies the configured policy; and
- the service URL is HTTPS on a documented Bot Framework/Teams Connector host.

Keys are cached for at most 24 hours. An unknown key ID triggers at most one bounded refresh for key rotation.

Only `message` Activities create Code UX chat messages. The normalizer removes the bot's own mention while preserving other mentions. Locale, tenant, team/channel, conversation, reply, sender/recipient, and the authenticated service URL form a durable conversation reference. JWTs, OAuth tokens, client secrets, and signing keys are never copied into delivery payloads.

## Replies and token caching

Multi-tenant applications request client-credential tokens from:

```text
https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token
```

Single-tenant applications replace `botframework.com` with the configured tenant ID. The scope is `https://api.botframework.com/.default`. Tokens remain memory-only and expire from cache before provider expiry.

Replies use the authenticated conversation reference:

```text
{validated-serviceUrl}/v3/conversations/{conversationId}/activities/{activityId}
```

The reply swaps the original sender/recipient, preserves conversation and locale, and sets `replyToId` to the incoming Activity ID. Microsoft 429 and transient service failures are retryable; invalid identity, claims, signatures, endorsements, tenants, and service URLs are terminal until input or configuration changes.

## Verification and local test eligibility

Microsoft does not provide a public unauthenticated Bot Connector sandbox. Automated coverage is deterministic: Bot Framework Emulator-shaped Activities and local fixtures exercise normalization, while OpenID, JWKS, OAuth, and Connector boundaries are mocked. Emulator input is not proof of a live Teams deployment, localhost is not trusted as an official Connector service URL, and there is no switch that bypasses authentication or host validation.

Official references: [Bot Connector authentication](https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-authentication?view=azure-bot-service-4.0), [send and receive messages](https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-send-and-receive-messages?view=azure-bot-service-4.0), [Activity protocol](https://learn.microsoft.com/en-us/microsoft-365/agents-sdk/activity-protocol), [Teams conversational bots](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/build-conversational-capability), and [local bot testing](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/debug/locally-with-an-ide).
