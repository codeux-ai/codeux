# Microsoft Teams Connector Profile

Microsoft Teams retains `managed_bridge` and custom `webhook` transports and provides a direct `official_api` profile based on Bot Connector Activities. Managed/custom endpoints remain operator-selected and are not represented as Microsoft-certified.

## Configuration and authentication

Official setup stores app ID, `MultiTenant` or `SingleTenant` application type, optional/required tenant policy, and a write-only client secret. No setup field accepts a Connector service URL.

Incoming Bearer JWT validation requires `RS256`, Microsoft's fixed OpenID/JWKS contract, issuer, app-ID audience, time window, exact Activity/JWT service URL match, channel endorsement, tenant policy, and a documented HTTPS Bot Framework host. Signing keys cache for at most 24 hours and an unknown key triggers one bounded refresh. There is no insecure bypass.

## Activity identity and outbound

Only `message` Activities enter chat. The normalizer removes the bot's own mention and preserves activity/conversation/reply, locale, tenant/team/channel, sender/recipient, and a validated conversation reference. JWTs, tokens, secrets, and signing keys are excluded.

OAuth client-credential tokens use Microsoft's documented authority and `https://api.botframework.com/.default`, remain memory-only, and expire early. Replies post to the authenticated `{serviceUrl}/v3/conversations/{conversationId}/activities/{activityId}`; setup cannot select an arbitrary destination. 429/transient failures are retryable; invalid trust input is terminal.

## Verification eligibility

Microsoft has no public unauthenticated Bot Connector sandbox. Automated coverage uses Emulator-shaped Activities and mocked OpenID, JWKS, OAuth, and Connector boundaries. Those fixtures are deterministic contract coverage, not a live Teams deployment; localhost is not trusted as an official service URL.

References: [Bot Connector authentication](https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-authentication?view=azure-bot-service-4.0), [send and receive messages](https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-send-and-receive-messages?view=azure-bot-service-4.0), [Activity protocol](https://learn.microsoft.com/en-us/microsoft-365/agents-sdk/activity-protocol), [Teams bots](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/build-conversational-capability), and [local bot testing](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/debug/locally-with-an-ide).
