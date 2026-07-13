import { describe, expect, it } from "vitest";
import {
  buildMicrosoftTeamsActivityReplyRequest,
  microsoftTeamsChatConnectorProfile,
  normalizeMicrosoftTeamsActivity,
  UnsupportedMicrosoftTeamsActivityError,
  verifyMicrosoftTeamsConfiguration,
  type MicrosoftTeamsConversationReference,
} from "../../../../src/domain/chat-connectors/providers/microsoft-teams.js";
import { normalizeInboundPayload } from "../../../../src/services/chat-provider-ingress-service.js";
import type { ChatProviderConnectionInternalRecord } from "../../../../src/contracts/chat-provider-types.js";

describe("Microsoft Teams chat connector profile", () => {
  it("adds official_api app identity fields while retaining managed and webhook bridges", () => {
    expect(microsoftTeamsChatConnectorProfile.supportedTransportModes).toEqual([
      "managed_bridge",
      "webhook",
      "official_api",
    ]);
    const modes = microsoftTeamsChatConnectorProfile.setupSchema.bridgeModes;
    expect(modes.slice(0, 2).map((mode) => mode.mode)).toEqual(["managed_bridge", "webhook"]);
    expect(modes[2]).toMatchObject({
      mode: "official_api",
      integration: "official_api",
      setupFields: [
        { key: "microsoftAppId", required: true },
        { key: "applicationType", type: "select", options: ["MultiTenant", "SingleTenant"] },
        { key: "tenantId", required: false },
      ],
      secretFields: [{ key: "clientSecret", required: true }],
    });
    expect(modes[2].setupFields.some((field) => field.key === "serviceUrl")).toBe(false);
  });

  it("requires a tenant for single-tenant app registrations", () => {
    expect(verifyMicrosoftTeamsConfiguration("official_api", {
      microsoftAppId: "bot-app-id",
      applicationType: "SingleTenant",
    }, { clientSecret: "write-only" })).toEqual({
      valid: false,
      issues: ["Missing required setup field for SingleTenant application: tenantId"],
    });
    expect(verifyMicrosoftTeamsConfiguration("official_api", {
      microsoftAppId: "bot-app-id",
      applicationType: "MultiTenant",
    }, { clientSecret: "write-only" })).toEqual({ valid: true, issues: [] });
  });

  it("normalizes message Activities, removes only the bot mention, and preserves Teams context", () => {
    const normalized = normalizeMicrosoftTeamsActivity(activityFixture());

    expect(normalized).toEqual({
      activityType: "message",
      externalChannelId: "conversation-1",
      externalChannelName: "Engineering",
      externalSenderId: "aad-user-1",
      externalSenderName: "Taylor",
      textBody: "please review with <at>Jordan</at>",
      externalMessageId: "activity-1",
      timestamp: "2026-07-13T12:00:00.000Z",
      channelId: "msteams",
      locale: "en-US",
      tenantId: "tenant-1",
      teamId: "team-1",
      teamsChannelId: "channel-1",
      replyToId: "parent-activity",
      conversation: {
        id: "conversation-1",
        name: "Conversation name",
        conversationType: "channel",
        isGroup: true,
      },
    });
  });

  it("rejects non-message Activities before generic ingress can create a chat message", () => {
    const connection = buildOfficialConnection();
    expect(() => normalizeInboundPayload(connection, {
      ...activityFixture(),
      type: "conversationUpdate",
    })).toThrow(UnsupportedMicrosoftTeamsActivityError);
  });

  it("normalizes Bot Emulator-shaped message fixtures without treating localhost as trusted transport", () => {
    const normalized = normalizeMicrosoftTeamsActivity({
      type: "message",
      id: "emulator-activity",
      channelId: "emulator",
      serviceUrl: "http://localhost:61570",
      text: "hello from Emulator",
      from: { id: "emulator-user", name: "User" },
      recipient: { id: "bot-app-id", name: "Bot" },
      conversation: { id: "emulator-conversation" },
      timestamp: "2026-07-13T12:00:00.000Z",
    });

    expect(normalized).toMatchObject({
      externalChannelId: "emulator-conversation",
      externalSenderId: "emulator-user",
      textBody: "hello from Emulator",
    });
    expect(normalized).not.toHaveProperty("serviceUrl");
  });

  it("builds the documented reply path only from a validated conversation reference", () => {
    const reference = conversationReference();
    const request = buildMicrosoftTeamsActivityReplyRequest(reference, "Reply text", "correlation-1");

    expect(request).toMatchObject({
      transport: "http",
      url: "https://smba.trafficmanager.net/teams/v3/conversations/conversation-1/activities/activity-1",
      bearerSecretKeys: [],
      body: {
        type: "message",
        from: { id: "bot-app-id" },
        recipient: { id: "user-1" },
        conversation: { id: "conversation-1" },
        replyToId: "activity-1",
        text: "Reply text",
      },
    });
  });
});

function activityFixture(): Record<string, unknown> {
  return {
    type: "message",
    id: "activity-1",
    replyToId: "parent-activity",
    timestamp: "2026-07-13T12:00:00.000Z",
    serviceUrl: "https://smba.trafficmanager.net/teams",
    channelId: "msteams",
    locale: "en-US",
    from: { id: "29:user", aadObjectId: "aad-user-1", name: "Taylor" },
    recipient: { id: "bot-app-id", name: "Code UX" },
    conversation: {
      id: "conversation-1",
      name: "Conversation name",
      conversationType: "channel",
      isGroup: true,
    },
    channelData: {
      tenant: { id: "tenant-1" },
      team: { id: "team-1" },
      channel: { id: "channel-1", name: "Engineering" },
    },
    text: "<at>Code UX</at> please review with <at>Jordan</at>",
    entities: [
      { type: "mention", text: "<at>Code UX</at>", mentioned: { id: "bot-app-id", name: "Code UX" } },
      { type: "mention", text: "<at>Jordan</at>", mentioned: { id: "user-jordan", name: "Jordan" } },
    ],
  };
}

function conversationReference(): MicrosoftTeamsConversationReference {
  return {
    activityId: "activity-1",
    serviceUrl: "https://smba.trafficmanager.net/teams",
    serviceUrlValidated: true,
    channelId: "msteams",
    locale: "en-US",
    tenantId: "tenant-1",
    teamId: "team-1",
    teamsChannelId: "channel-1",
    conversation: { id: "conversation-1", conversationType: "channel", isGroup: true },
    bot: { id: "bot-app-id", name: "Code UX" },
    user: { id: "user-1", name: "Taylor" },
  };
}

function buildOfficialConnection(): ChatProviderConnectionInternalRecord {
  return {
    id: "connection-1",
    providerKind: "microsoft-teams",
    displayName: "Teams official API",
    bridgeMode: "official_api",
    status: "active",
    enabled: true,
    setup: {
      microsoftAppId: "bot-app-id",
      applicationType: "SingleTenant",
      tenantId: "tenant-1",
    },
    secrets: { clientSecret: "secret" },
    createdAt: "2026-07-13T00:00:00.000Z",
    updatedAt: "2026-07-13T00:00:00.000Z",
  };
}
