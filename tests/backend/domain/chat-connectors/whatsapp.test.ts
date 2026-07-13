import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ChatProviderBridgeMode,
  ChatProviderChannelBindingRecord,
  ChatProviderConnectionInternalRecord,
  ChatProviderMessageDeliveryRecord,
} from "../../../../src/contracts/chat-provider-types.js";
import {
  classifyWhatsAppGraphError,
  normalizeWhatsAppWebhook,
  verifyWhatsAppOfficialConnection,
  verifyWhatsAppWebhookChallenge,
  verifyWhatsAppWebhookSignature,
  whatsappChatConnectorProfile,
} from "../../../../src/domain/chat-connectors/providers/whatsapp.js";
import type { ChatConnectorOutboundContext } from "../../../../src/domain/chat-connectors/types.js";
import {
  ChatProviderOutboundAdapterError,
  ConfiguredChatProviderOutboundAdapter,
} from "../../../../src/services/chat-provider-adapters.js";

const ACCESS_TOKEN = "meta-access-token-that-must-stay-private";
const APP_SECRET = "meta-app-secret";
const VERIFY_TOKEN = "webhook-verify-token";
const PHONE_NUMBER_ID = "109876543210987";
const SENDER_WA_ID = "15551234567";
const CREATED_AT = "2026-07-13T12:00:00.000Z";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("WhatsApp Cloud API profile", () => {
  it("adds the official schema without changing either legacy bridge schema", () => {
    const modes = whatsappChatConnectorProfile.setupSchema.bridgeModes.map((schema) => ({
      mode: schema.mode,
      setup: schema.setupFields.map((field) => field.key),
      secrets: schema.secretFields.map((field) => field.key),
    }));

    expect(modes).toEqual([
      {
        mode: "managed_bridge",
        setup: ["pluginName", "workspaceId"],
        secrets: ["bridgeApiKey"],
      },
      {
        mode: "webhook",
        setup: ["webhookUrl", "verifyTokenName"],
        secrets: ["webhookSecret", "verifyToken"],
      },
      {
        mode: "official_api",
        setup: ["graphApiVersion", "phoneNumberId", "appId", "businessAccountId"],
        secrets: ["accessToken", "appSecret", "webhookVerifyToken"],
      },
    ]);
    expect(whatsappChatConnectorProfile.supportedTransportModes).toEqual([
      "managed_bridge",
      "webhook",
      "official_api",
    ]);
  });

  it("returns the GET subscription challenge only for a matching subscribe request", () => {
    expect(verifyWhatsAppWebhookChallenge({
      "hub.mode": "subscribe",
      "hub.verify_token": VERIFY_TOKEN,
      "hub.challenge": "987654321",
    }, VERIFY_TOKEN)).toEqual({ verified: true, statusCode: 200, body: "987654321" });

    expect(verifyWhatsAppWebhookChallenge({
      "hub.mode": "subscribe",
      "hub.verify_token": "wrong-token",
      "hub.challenge": "987654321",
    }, VERIFY_TOKEN)).toEqual({ verified: false, statusCode: 403, body: "Forbidden" });
    expect(verifyWhatsAppWebhookChallenge({
      "hub.mode": "unsubscribe",
      "hub.verify_token": VERIFY_TOKEN,
      "hub.challenge": "987654321",
    }, VERIFY_TOKEN).verified).toBe(false);
  });

  it("validates X-Hub-Signature-256 against the exact raw request bytes", () => {
    const rawBody = Buffer.from('{"entry": [ {"id":"1"} ]}\n', "utf8");
    const signature = `sha256=${createHmac("sha256", APP_SECRET).update(rawBody).digest("hex")}`;

    expect(verifyWhatsAppWebhookSignature(rawBody, signature, APP_SECRET)).toBe(true);
    expect(verifyWhatsAppWebhookSignature(JSON.stringify(JSON.parse(rawBody.toString("utf8"))), signature, APP_SECRET)).toBe(false);
    expect(verifyWhatsAppWebhookSignature(rawBody, undefined, APP_SECRET)).toBe(false);
    expect(verifyWhatsAppWebhookSignature(rawBody, "sha256=invalid", APP_SECRET)).toBe(false);
  });

  it("normalizes text and caption messages with business channel and sender identities", () => {
    const text = normalizeWhatsAppWebhook(messageWebhook({
      id: "wamid.inbound-text",
      from: SENDER_WA_ID,
      timestamp: "1783963200",
      type: "text",
      text: { body: "Hello from WhatsApp" },
    }));
    const caption = normalizeWhatsAppWebhook(messageWebhook({
      id: "wamid.inbound-image",
      from: SENDER_WA_ID,
      timestamp: "1783963260",
      type: "image",
      image: { id: "media-id", caption: "Screenshot caption" },
    }));

    expect(text).toEqual({
      kind: "message",
      message: {
        externalChannelId: PHONE_NUMBER_ID,
        externalChannelName: "+1 555 765 4321",
        externalSenderId: SENDER_WA_ID,
        externalSenderName: "Example Sender",
        textBody: "Hello from WhatsApp",
        externalMessageId: "wamid.inbound-text",
        timestamp: "1783963200",
      },
    });
    expect(caption.kind === "message" ? caption.message.textBody : null).toBe("Screenshot caption");
  });

  it("separates delivery statuses and filters them from inbound message normalization", () => {
    const payload = statusWebhook();
    expect(normalizeWhatsAppWebhook(payload)).toEqual({
      kind: "status",
      statuses: [{
        externalChannelId: PHONE_NUMBER_ID,
        externalMessageId: "wamid.outbound",
        recipientId: SENDER_WA_ID,
        status: "delivered",
        timestamp: "1783963300",
      }],
    });
    expect(whatsappChatConnectorProfile.ingress.normalize(payload)).toEqual({});
  });

  it("builds text and reply requests for the fixed Graph endpoint and inbound sender", () => {
    const context = officialContext();
    const request = whatsappChatConnectorProfile.outbound.buildRequest(context);

    expect(request).toMatchObject({
      transport: "http",
      url: `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`,
      bearerSecretKeys: ["accessToken"],
      body: {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: SENDER_WA_ID,
        context: { message_id: "wamid.inbound-text" },
        type: "text",
        text: { preview_url: false, body: "Reply from Code UX" },
      },
    });
    expect(request.url).not.toContain("example.invalid");
    expect((request.body as { to: string }).to).not.toBe(context.binding.externalChannelId);

    const textRequest = whatsappChatConnectorProfile.outbound.buildRequest(officialContext({ replyToExternalMessageId: null }));
    expect(textRequest.body).not.toHaveProperty("context");
  });

  it("sends through the provider-neutral adapter and parses returned wamid values", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      messaging_product: "whatsapp",
      contacts: [{ input: SENDER_WA_ID, wa_id: SENDER_WA_ID }],
      messages: [{ id: "wamid.outbound-result" }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new ConfiguredChatProviderOutboundAdapter().send(officialContext());

    expect(result).toEqual({
      externalMessageId: "wamid.outbound-result",
      responseMetadata: { messagingProduct: "whatsapp", messageCount: 1 },
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`);
    expect(init?.headers).toMatchObject({ authorization: `Bearer ${ACCESS_TOKEN}` });
    expect(JSON.parse(String(init?.body))).toMatchObject({ to: SENDER_WA_ID, messaging_product: "whatsapp" });
  });

  it("classifies Graph errors and retryable HTTP responses without echoing payload data", () => {
    const responseBody = JSON.stringify({
      error: {
        message: `Temporary failure for ${SENDER_WA_ID} using ${ACCESS_TOKEN}`,
        type: "OAuthException",
        code: 130429,
        error_subcode: 2494010,
        is_transient: true,
      },
    });
    const classification = classifyWhatsAppGraphError(400, responseBody);

    expect(classification).toMatchObject({
      retryable: true,
      statusCode: 400,
      code: 130429,
      subcode: 2494010,
      type: "OAuthException",
      isTransient: true,
    });
    expect(classification.message).not.toContain(ACCESS_TOKEN);
    expect(classification.message).not.toContain(SENDER_WA_ID);
    expect(whatsappChatConnectorProfile.outbound.isRetryableStatus(429)).toBe(true);
    expect(whatsappChatConnectorProfile.outbound.isRetryableStatus(503)).toBe(true);
    expect(whatsappChatConnectorProfile.outbound.isRetryableStatus(400)).toBe(false);
  });

  it("classifies outbound timeouts as retryable without leaking authorization or recipient data", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error("The operation timed out"));
    vi.stubGlobal("fetch", fetchMock);

    const error = await new ConfiguredChatProviderOutboundAdapter().send(officialContext()).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ChatProviderOutboundAdapterError);
    expect((error as ChatProviderOutboundAdapterError).retryable).toBe(true);
    expect((error as Error).message).not.toContain(ACCESS_TOKEN);
    expect((error as Error).message).not.toContain(SENDER_WA_ID);
  });

  it("verifies the configured phone-number resource with a read-only Graph request", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      id: PHONE_NUMBER_ID,
      display_phone_number: "+1 555 765 4321",
      verified_name: "Example Business",
      quality_rating: "GREEN",
    }), { status: 200 }));

    const result = await verifyWhatsAppOfficialConnection(officialSetup(), officialSecrets(), fetchMock);

    expect(result).toEqual({
      valid: true,
      issues: [],
      retryable: false,
      resource: {
        id: PHONE_NUMBER_ID,
        displayPhoneNumber: "+1 555 765 4321",
        verifiedName: "Example Business",
        qualityRating: "GREEN",
      },
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}?fields=id,display_phone_number,verified_name,quality_rating`,
    );
    expect(init).toMatchObject({ method: "GET", headers: { authorization: `Bearer ${ACCESS_TOKEN}` } });
    expect(init).not.toHaveProperty("body");
  });

  it("fails closed for invalid official configuration and redacts verification failures", async () => {
    const invalid = whatsappChatConnectorProfile.verification.verifyConfiguration("official_api", {
      graphApiVersion: "https://example.invalid/v23.0",
      phoneNumberId: "123/messages",
    }, officialSecrets());
    expect(invalid.valid).toBe(false);
    expect(invalid.issues).toContain("Graph API version must use the v{major}.{minor} format.");
    expect(invalid.issues).toContain("Phone-number ID must contain digits only.");

    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error(`timeout while using ${ACCESS_TOKEN}`));
    const failed = await verifyWhatsAppOfficialConnection(officialSetup(), officialSecrets(), fetchMock);
    expect(failed).toMatchObject({ valid: false, retryable: true, resource: null });
    expect(failed.issues.join(" ")).not.toContain(ACCESS_TOKEN);
  });

  it("retains managed and generic webhook outbound bridge behavior", () => {
    const managed = whatsappChatConnectorProfile.outbound.buildRequest(contextForMode("managed_bridge", {
      bridgeUrl: "https://managed.example.test/send",
    }));
    const webhook = whatsappChatConnectorProfile.outbound.buildRequest(contextForMode("webhook", {
      webhookUrl: "https://webhook.example.test/send",
    }));

    expect(managed).toMatchObject({
      url: "https://managed.example.test/send",
      bearerSecretKeys: expect.arrayContaining(["bridgeApiKey"]),
      body: expect.objectContaining({ replyText: "Reply from Code UX" }),
    });
    expect(webhook).toMatchObject({
      url: "https://webhook.example.test/send",
      bearerSecretKeys: expect.arrayContaining(["webhookSecret"]),
      body: expect.objectContaining({ replyText: "Reply from Code UX" }),
    });
    expect(whatsappChatConnectorProfile.outbound.parseResponse('{"messageId":"legacy-message"}')).toMatchObject({
      externalMessageId: "legacy-message",
    });
  });
});

function messageWebhook(message: Record<string, unknown>): Record<string, unknown> {
  return {
    object: "whatsapp_business_account",
    entry: [{
      id: "waba-id",
      changes: [{
        field: "messages",
        value: {
          messaging_product: "whatsapp",
          metadata: {
            display_phone_number: "+1 555 765 4321",
            phone_number_id: PHONE_NUMBER_ID,
          },
          contacts: [{ profile: { name: "Example Sender" }, wa_id: SENDER_WA_ID }],
          messages: [message],
        },
      }],
    }],
  };
}

function statusWebhook(): Record<string, unknown> {
  return {
    object: "whatsapp_business_account",
    entry: [{
      id: "waba-id",
      changes: [{
        field: "messages",
        value: {
          messaging_product: "whatsapp",
          metadata: { phone_number_id: PHONE_NUMBER_ID },
          statuses: [{
            id: "wamid.outbound",
            status: "delivered",
            timestamp: "1783963300",
            recipient_id: SENDER_WA_ID,
          }],
        },
      }],
    }],
  };
}

function officialSetup(): Record<string, unknown> {
  return {
    graphApiVersion: "v23.0",
    phoneNumberId: PHONE_NUMBER_ID,
    appId: "1234567890",
    businessAccountId: "9876543210",
    graphApiHost: "https://example.invalid",
    webhookUrl: "https://example.invalid/webhook",
  };
}

function officialSecrets(): Record<string, unknown> {
  return {
    accessToken: ACCESS_TOKEN,
    appSecret: APP_SECRET,
    webhookVerifyToken: VERIFY_TOKEN,
  };
}

function officialContext(
  payloadOverrides: Partial<ChatConnectorOutboundContext["payload"]> = {},
): ChatConnectorOutboundContext {
  return {
    connection: connectionForMode("official_api", officialSetup(), officialSecrets()),
    binding: binding(),
    delivery: delivery(),
    correlationId: "correlation-1",
    payload: {
      providerKind: "whatsapp",
      providerConnectionId: "connection-1",
      channelId: PHONE_NUMBER_ID,
      threadId: "thread-1",
      conversationMessageId: "conversation-message-2",
      replyText: "Reply from Code UX",
      replyToExternalMessageId: "wamid.inbound-text",
      metadata: {
        inboundPayload: {
          externalSender: { id: SENDER_WA_ID, name: "Example Sender" },
        },
      },
      ...payloadOverrides,
    },
  };
}

function contextForMode(
  mode: ChatProviderBridgeMode,
  setup: Record<string, unknown>,
): ChatConnectorOutboundContext {
  const context = officialContext();
  return {
    ...context,
    connection: connectionForMode(mode, setup, { bridgeApiKey: "bridge-key", webhookSecret: "webhook-secret" }),
  };
}

function connectionForMode(
  bridgeMode: ChatProviderBridgeMode,
  setup: Record<string, unknown>,
  secrets: Record<string, unknown>,
): ChatProviderConnectionInternalRecord {
  return {
    id: "connection-1",
    providerKind: "whatsapp",
    displayName: "WhatsApp test connection",
    bridgeMode,
    status: "active",
    enabled: true,
    setup,
    secrets,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

function binding(): ChatProviderChannelBindingRecord {
  return {
    id: "binding-1",
    providerConnectionId: "connection-1",
    providerKind: "whatsapp",
    externalChannelId: PHONE_NUMBER_ID,
    externalChannelName: "+1 555 765 4321",
    externalChannelMetadata: null,
    projectId: "project-1",
    agentPresetId: null,
    routingHints: null,
    enabled: true,
    inboundEnabled: true,
    outboundEnabled: true,
    suppressRichWidgets: true,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

function delivery(): ChatProviderMessageDeliveryRecord {
  return {
    id: "delivery-1",
    providerConnectionId: "connection-1",
    providerKind: "whatsapp",
    channelBindingId: "binding-1",
    externalChannelId: PHONE_NUMBER_ID,
    externalMessageId: "wamid.inbound-text",
    direction: "outbound",
    status: "sending",
    attemptCount: 1,
    lastError: null,
    conversationThreadId: "thread-1",
    conversationMessageId: "conversation-message-2",
    payload: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}
