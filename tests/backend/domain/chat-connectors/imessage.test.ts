import { describe, expect, it } from "vitest";
import type { ChatProviderConnectionInternalRecord } from "../../../../src/contracts/chat-provider-types.js";
import {
  buildImessageBridgeRequest,
  IMESSAGE_BRIDGE_PROTOCOL_VERSION,
  imessageChatConnectorProfile,
  normalizeImessageBridgeGuid,
  parseImessageBridgeResponse,
} from "../../../../src/domain/chat-connectors/providers/imessage.js";
import type { ChatConnectorOutboundContext } from "../../../../src/domain/chat-connectors/types.js";
import {
  ChatProviderIngressSecurity,
  ChatProviderIngressSecurityError,
} from "../../../../src/services/chat-provider-security.js";

describe("iMessage connector profile", () => {
  it("advertises only transparent third-party bridge modes", () => {
    expect(imessageChatConnectorProfile.supportedTransportModes).toEqual(["managed_bridge", "native_bridge"]);
    expect(imessageChatConnectorProfile.setupSchema.bridgeModes.map(({ mode, label }) => ({ mode, label }))).toEqual([
      { mode: "managed_bridge", label: "Third-party managed iMessage bridge contract" },
      { mode: "native_bridge", label: "Local third-party iMessage bridge command" },
    ]);
    expect(imessageChatConnectorProfile.liveTest).toMatchObject({
      available: false,
      modes: [],
      reason: expect.stringContaining("provider-native endpoint verification is unavailable"),
    });
    expect(imessageChatConnectorProfile.officialDocumentation.map((entry) => entry.url)).toEqual([
      "https://developer.apple.com/documentation/messages",
      "https://developer.apple.com/imessage/",
      "https://developer.apple.com/documentation/messageui",
    ]);
  });

  it("builds the stable versioned send envelope while preserving legacy command records", () => {
    const context = buildOutboundContext();
    const request = imessageChatConnectorProfile.outbound.buildRequest(context);

    expect(request).toMatchObject({
      transport: "command",
      command: '"/Applications/Bridge App/bridge" --profile "Personal Relay"',
      workingDirectory: "/Users/operator/Bridge Workspace",
      tokenSecretKeys: ["bridgeToken", "botToken", "webhookSecret"],
      body: {
        protocolVersion: IMESSAGE_BRIDGE_PROTOCOL_VERSION,
        operation: "send",
        correlation: { id: "corr-1" },
        message: { guid: "conversation-message-1", text: "Bridge reply", timestamp: null },
        chat: { guid: "chat-guid-1", name: "Operations" },
        sender: { id: null, name: null },
        reply: { messageGuid: "message-guid-1", threadId: "thread-1" },
        result: null,
        error: null,
      },
    });
    expect((request.body as Record<string, unknown>).channelId).toBe("chat-guid-1");
    expect((request.body as Record<string, unknown>).replyToExternalMessageId).toBe("message-guid-1");

    const managedContext = buildOutboundContext();
    managedContext.connection.bridgeMode = "managed_bridge";
    managedContext.connection.setup = { bridgeUrl: "https://third-party-bridge.example.test/send" };
    expect(imessageChatConnectorProfile.outbound.buildRequest(managedContext)).toMatchObject({
      transport: "http",
      bearerSecretKeys: ["bridgeApiKey", "bridgeToken", "botToken", "webhookSecret"],
    });

    expect(buildImessageBridgeRequest("health_check", "health-1")).toEqual({
      protocolVersion: IMESSAGE_BRIDGE_PROTOCOL_VERSION,
      operation: "health_check",
      correlation: { id: "health-1" },
      message: null,
      chat: null,
      sender: null,
      reply: null,
      result: null,
      error: null,
    });
  });

  it("normalizes contract GUIDs and preserves opaque reply/thread identity", () => {
    const body = {
      protocolVersion: IMESSAGE_BRIDGE_PROTOCOL_VERSION,
      operation: "send",
      correlation: { id: "corr-inbound" },
      message: { guid: "  message-e\u0301  ", text: "Inbound bridge text", timestamp: "2026-07-13T00:00:00.000Z" },
      chat: { guid: "  iMessage;-;+15550001111  ", name: "Bridge chat" },
      sender: { id: "+15550002222", name: "Sender" },
      reply: { messageGuid: "prior-message-guid", threadId: "conversation-thread-1" },
      result: null,
      error: null,
    };

    expect(imessageChatConnectorProfile.ingress.normalize(body)).toMatchObject({
      externalChannelId: "iMessage;-;+15550001111",
      externalSenderId: "+15550002222",
      externalMessageId: "message-é",
      textBody: "Inbound bridge text",
    });
    expect(imessageChatConnectorProfile.identity.resolve(
      imessageChatConnectorProfile.ingress.normalize(body),
      body,
    )).toEqual({ conversationId: "iMessage;-;+15550001111", threadId: "conversation-thread-1" });
    expect(normalizeImessageBridgeGuid("bad\0guid")).toBeUndefined();
    expect(normalizeImessageBridgeGuid("x".repeat(513))).toBeUndefined();
  });

  it("parses negotiated responses and rejects unsupported versions", () => {
    const response = JSON.stringify({
      protocolVersion: IMESSAGE_BRIDGE_PROTOCOL_VERSION,
      operation: "send",
      correlation: { id: "corr-1" },
      message: null,
      chat: null,
      sender: null,
      reply: null,
      result: { status: "sent", messageGuid: "out-guid-1", chatGuid: "chat-guid-1", metadata: { transport: "fixture" } },
      error: null,
    });

    expect(parseImessageBridgeResponse(response)).toEqual({
      externalMessageId: "out-guid-1",
      responseMetadata: {
        protocolVersion: IMESSAGE_BRIDGE_PROTOCOL_VERSION,
        status: "sent",
        chatGuid: "chat-guid-1",
        metadata: { transport: "fixture" },
      },
    });
    expect(() => parseImessageBridgeResponse(JSON.stringify({ protocolVersion: "2.0", result: null, error: null })))
      .toThrow("Unsupported iMessage bridge protocol version: 2.0");
  });

  it("rejects health-check and malformed envelopes as send responses", () => {
    const sendResponse = {
      protocolVersion: IMESSAGE_BRIDGE_PROTOCOL_VERSION,
      operation: "send",
      correlation: { id: "corr-1" },
      message: null,
      chat: null,
      sender: null,
      reply: null,
      result: { status: "sent", messageGuid: "out-guid-1", chatGuid: "chat-guid-1", metadata: {} },
      error: null,
    };

    expect(() => parseImessageBridgeResponse(JSON.stringify({
      ...sendResponse,
      operation: "health_check",
      result: { ...sendResponse.result, status: "healthy" },
    }))).toThrow("operation must be send");
    expect(() => parseImessageBridgeResponse(JSON.stringify(sendResponse), "different-correlation"))
      .toThrow("correlation.id does not match the request");
    expect(() => parseImessageBridgeResponse(JSON.stringify({
      protocolVersion: IMESSAGE_BRIDGE_PROTOCOL_VERSION,
      operation: "send",
      result: sendResponse.result,
      error: null,
    }))).toThrow("required protocol fields are missing");
    expect(() => parseImessageBridgeResponse("{}"))
      .toThrow("Malformed legacy iMessage bridge send response");
    expect(() => parseImessageBridgeResponse("{not-json"))
      .toThrow("Malformed iMessage bridge response: invalid JSON");
  });

  it.each([
    ["managed_bridge", "bridgeApiKey"],
    ["native_bridge", "bridgeToken"],
  ] as const)("uses shared bearer and nonce replay protection for %s ingress", (bridgeMode, secretKey) => {
    const secret = "bridge-credential-value";
    const security = new ChatProviderIngressSecurity();
    const connection = buildConnection(bridgeMode, { [secretKey]: secret });
    const now = new Date("2026-07-13T12:00:00.000Z");
    const request = {
      headers: {
        authorization: `Bearer ${secret}`,
        "x-code-ux-timestamp": String(now.getTime()),
        "x-code-ux-nonce": "nonce-1",
      },
      rawBody: "{}",
      now,
    };

    expect(security.verify(connection, request)).toEqual({ authenticated: true, method: "bearer" });
    expect(() => security.verify(connection, request)).toThrowError(expect.objectContaining({ code: "replay_detected" }));
    expect(() => security.verify(connection, {
      ...request,
      headers: { ...request.headers, authorization: "Bearer wrong", "x-code-ux-nonce": "nonce-2" },
    })).toThrowError(expect.objectContaining({ code: "invalid_bearer_token" }));
  });

  it("fails closed when a native inbound credential is absent", () => {
    const security = new ChatProviderIngressSecurity();
    try {
      security.verify(buildConnection("native_bridge", {}), {
        headers: { "x-code-ux-timestamp": String(Date.now()) },
        rawBody: "{}",
      });
      throw new Error("Expected security verification to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(ChatProviderIngressSecurityError);
      expect((error as ChatProviderIngressSecurityError).code).toBe("missing_bridge_secret");
    }
  });
});

function buildConnection(
  bridgeMode: "managed_bridge" | "native_bridge",
  secrets: Record<string, unknown>,
): ChatProviderConnectionInternalRecord {
  return {
    id: `imessage-${bridgeMode}`,
    providerKind: "imessage",
    displayName: "Fixture bridge",
    bridgeMode,
    status: "active",
    enabled: true,
    setup: {},
    secrets,
    createdAt: "2026-07-13T00:00:00.000Z",
    updatedAt: "2026-07-13T00:00:00.000Z",
  };
}

function buildOutboundContext(): ChatConnectorOutboundContext {
  const connection = buildConnection("native_bridge", { bridgeToken: "fixture-secret" });
  connection.setup = {
    command: '"/Applications/Bridge App/bridge" --profile "Personal Relay"',
    workingDirectory: "/Users/operator/Bridge Workspace",
  };
  return {
    connection,
    binding: {
      id: "binding-1",
      providerConnectionId: connection.id,
      providerKind: "imessage",
      externalChannelId: "chat-guid-1",
      externalChannelName: "Operations",
      externalChannelMetadata: null,
      projectId: "project-1",
      agentPresetId: null,
      routingHints: null,
      enabled: true,
      inboundEnabled: true,
      outboundEnabled: true,
      suppressRichWidgets: true,
      createdAt: "2026-07-13T00:00:00.000Z",
      updatedAt: "2026-07-13T00:00:00.000Z",
    },
    delivery: {
      id: "delivery-1",
      providerConnectionId: connection.id,
      providerKind: "imessage",
      channelBindingId: "binding-1",
      externalChannelId: "chat-guid-1",
      externalMessageId: null,
      direction: "outbound",
      status: "sending",
      attemptCount: 1,
      lastError: null,
      conversationThreadId: "thread-1",
      conversationMessageId: "conversation-message-1",
      payload: null,
      createdAt: "2026-07-13T00:00:00.000Z",
      updatedAt: "2026-07-13T00:00:00.000Z",
    },
    payload: {
      providerKind: "imessage",
      providerConnectionId: connection.id,
      channelId: "chat-guid-1",
      threadId: "thread-1",
      conversationMessageId: "conversation-message-1",
      replyText: "Bridge reply",
      replyToExternalMessageId: "message-guid-1",
      metadata: {},
    },
    correlationId: "corr-1",
  };
}
