import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ChatProviderBridgeMode,
  ChatProviderChannelBindingRecord,
  ChatProviderConnectionInternalRecord,
  ChatProviderMessageDeliveryRecord,
} from "../../../../src/contracts/chat-provider-types.js";
import {
  parseTelegramSendMessageResponse,
  telegramChatConnectorProfile,
  verifyTelegramOfficialApi,
} from "../../../../src/domain/chat-connectors/providers/telegram.js";
import { ChatConnectorOutboundResponseError } from "../../../../src/domain/chat-connectors/types.js";
import {
  ConfiguredChatProviderOutboundAdapter,
} from "../../../../src/services/chat-provider-adapters.js";
import { ChatProviderOutboundService } from "../../../../src/services/chat-provider-outbound-service.js";
import {
  ChatProviderIngressSecurity,
  ChatProviderIngressSecurityError,
} from "../../../../src/services/chat-provider-security.js";

const BOT_TOKEN = "123456789:telegram-test-token";
const WEBHOOK_SECRET = "telegram_webhook-secret";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Telegram chat connector profile", () => {
  it("adds official Bot API credentials without changing legacy bridge schemas", () => {
    expect(telegramChatConnectorProfile.setupSchema.bridgeModes).toEqual([
      expect.objectContaining({
        mode: "managed_bridge",
        setupFields: expect.arrayContaining([expect.objectContaining({ key: "workspaceId" })]),
        secretFields: [expect.objectContaining({ key: "bridgeApiKey", required: true })],
      }),
      expect.objectContaining({
        mode: "webhook",
        setupFields: expect.arrayContaining([expect.objectContaining({ key: "webhookUrl" })]),
        secretFields: [
          expect.objectContaining({ key: "botToken", required: true }),
          expect.objectContaining({ key: "webhookSecret", required: false }),
        ],
      }),
      expect.objectContaining({
        mode: "official_api",
        integration: "official_api",
        setupFields: [expect.objectContaining({ key: "botUsername", required: false })],
        secretFields: [
          expect.objectContaining({ key: "botToken", required: true }),
          expect.objectContaining({ key: "webhookSecret", required: true }),
        ],
      }),
    ]);
    expect(telegramChatConnectorProfile.verification.verifyConfiguration(
      "official_api",
      {},
      { botToken: BOT_TOKEN, webhookSecret: "contains spaces" },
    )).toMatchObject({
      valid: false,
      issues: [expect.stringContaining("1-256 characters")],
    });
  });

  it("accepts only the exact Telegram webhook secret header without timestamps or synthetic signatures", () => {
    const security = new ChatProviderIngressSecurity();
    const connection = buildConnection("official_api");

    expect(security.verify(connection, {
      headers: { "X-Telegram-Bot-Api-Secret-Token": WEBHOOK_SECRET },
      rawBody: "{}",
    })).toEqual({ authenticated: true, method: "header_secret" });

    for (const headers of [
      {},
      { "X-Telegram-Bot-Api-Secret-Token": `${WEBHOOK_SECRET} ` },
      { "X-Telegram-Bot-Api-Secret-Token": "wrong-secret" },
      { "x-code-ux-signature": WEBHOOK_SECRET, "x-code-ux-timestamp": String(Date.now()) },
    ]) {
      expect(() => security.verify(connection, { headers, rawBody: "{}" }))
        .toThrow(ChatProviderIngressSecurityError);
    }
  });

  it.each([
    "message",
    "channel_post",
    "edited_message",
    "edited_channel_post",
  ] as const)("normalizes %s updates with composite duplicate identity", (updateKey) => {
    const payload = {
      update_id: 9_000_000_001,
      [updateKey]: {
        message_id: 4_000_000_001,
        message_thread_id: 7_000_000_001,
        date: 1_783_430_400,
        edit_date: updateKey.startsWith("edited") ? 1_783_430_500 : undefined,
        text: `Body from ${updateKey}`,
        chat: { id: -1_001_234_567_890, title: "Operations" },
        from: { id: 5_001_234_567_890, first_name: "Taylor", is_bot: false },
      },
    };

    const normalized = telegramChatConnectorProfile.ingress.normalize(payload, "official_api");
    const identity = telegramChatConnectorProfile.identity.resolve(normalized, payload, "official_api");

    expect(normalized).toMatchObject({
      externalChannelId: "-1001234567890",
      externalSenderId: "5001234567890",
      textBody: `Body from ${updateKey}`,
      externalMessageId: "telegram:9000000001:-1001234567890:4000000001",
    });
    expect(identity).toEqual({
      conversationId: "-1001234567890",
      threadId: "7000000001",
    });
  });

  it("uses update_id and message identity together for duplicate control", () => {
    const first = telegramChatConnectorProfile.ingress.normalize(buildUpdate(101, 41), "official_api");
    const replay = telegramChatConnectorProfile.ingress.normalize(buildUpdate(101, 41), "official_api");
    const edit = telegramChatConnectorProfile.ingress.normalize(buildUpdate(102, 41, "edited_message"), "official_api");

    expect(first.externalMessageId).toBe(replay.externalMessageId);
    expect(edit.externalMessageId).not.toBe(first.externalMessageId);
    expect(edit.externalMessageId).toContain(":41");
  });

  it("suppresses bot-originated official updates while leaving legacy bridges unchanged", () => {
    const payload = buildUpdate(201, 51);
    (payload.message.from as Record<string, unknown>).is_bot = true;

    expect(telegramChatConnectorProfile.ingress.ignore?.(payload, "official_api"))
      .toEqual({ ignored: true, reason: "bot_originated_update" });
    expect(telegramChatConnectorProfile.ingress.ignore?.(payload, "managed_bridge"))
      .toEqual({ ignored: false });
  });

  it("builds sendMessage requests only against Telegram's fixed origin with topic and reply parameters", () => {
    const context = buildOutboundContext();
    context.connection.setup = { botUsername: "codeux_test_bot", webhookUrl: "https://attacker.invalid/send" };
    context.payload.replyText = `${"😀".repeat(4_095)}tail`;
    context.payload.metadata = {
      inboundPayload: {
        rawMetadata: buildUpdate(301, 61, "message", 77),
      },
    };

    const request = telegramChatConnectorProfile.outbound.buildRequest(context);

    expect(request.transport).toBe("http");
    if (request.transport !== "http") {
      throw new Error("Expected HTTP request.");
    }
    expect(request.url).toBe(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`);
    expect(request.url).not.toContain("attacker.invalid");
    expect(request.bearerSecretKeys).toEqual([]);
    expect(request.timeoutMs).toBe(15_000);
    expect(request.body).toMatchObject({
      chat_id: "-1001234567890",
      message_thread_id: 77,
      reply_parameters: { message_id: 61, allow_sending_without_reply: true },
    });
    const body = request.body as { text: string };
    expect(Array.from(body.text)).toHaveLength(4_096);
    expect(body.text.endsWith("t")).toBe(true);
  });

  it("rejects invalid Bot API envelopes even when HTTP status is 200", async () => {
    expect(() => parseTelegramSendMessageResponse(JSON.stringify({
      ok: false,
      error_code: 400,
      description: "Bad Request: chat not found",
    }), 200)).toThrowError(ChatConnectorOutboundResponseError);

    try {
      parseTelegramSendMessageResponse(JSON.stringify({ ok: false, error_code: 400 }), 200);
    } catch (error) {
      expect(error).toMatchObject({ retryable: false, statusCode: 400 });
    }
    expect(() => parseTelegramSendMessageResponse(JSON.stringify({ result: {} }), 200))
      .toThrow("invalid response envelope");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      ok: false,
      error_code: 400,
      description: `Bad Request at https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
    }, 200)));
    const adapterError = await new ConfiguredChatProviderOutboundAdapter()
      .send(buildOutboundContext())
      .catch((caught: unknown) => caught);
    expect(adapterError).toMatchObject({ retryable: false, statusCode: 400 });
    expect((adapterError as Error).message).not.toContain(BOT_TOKEN);
  });

  it("parses successful sendMessage results and explicit 429 retry delays", () => {
    expect(parseTelegramSendMessageResponse(JSON.stringify({
      ok: true,
      result: {
        message_id: 91,
        message_thread_id: 77,
        date: 1_783_430_400,
        chat: { id: -1_001_234_567_890 },
      },
    }))).toEqual({
      externalMessageId: "91",
      responseMetadata: {
        ok: true,
        chatId: "-1001234567890",
        messageThreadId: "77",
        date: 1_783_430_400,
      },
    });

    try {
      parseTelegramSendMessageResponse(JSON.stringify({
        ok: false,
        error_code: 429,
        description: "Too Many Requests",
        parameters: { retry_after: 17 },
      }), 429);
      throw new Error("Expected 429 failure.");
    } catch (error) {
      expect(error).toMatchObject({ retryable: true, statusCode: 429, retryAfterMs: 17_000 });
    }
  });

  it("treats official send timeouts as ambiguous terminal failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("timed out", "TimeoutError")));
    const adapter = new ConfiguredChatProviderOutboundAdapter();

    const error = await adapter.send(buildOutboundContext()).catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      retryable: false,
      message: expect.stringContaining("delivery status is unknown"),
    });
    expect((error as Error).message).not.toContain(BOT_TOKEN);
  });

  it("propagates Telegram 429 retry_after into the scheduled retry time", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      ok: false,
      error_code: 429,
      description: "Too Many Requests",
      parameters: { retry_after: 17 },
    }, 429)));
    const now = new Date("2026-07-13T12:00:00.000Z");
    const delivery = buildDelivery();
    const updates: Array<{ status: string; payload?: Record<string, unknown> | null }> = [];
    const repository = {
      getDelivery: vi.fn(() => delivery),
      getConnectionInternal: vi.fn(() => buildConnection("official_api")),
      getChannelBinding: vi.fn(() => buildBinding()),
      updateDeliveryState: vi.fn((_id: string, input: { status: string; payload?: Record<string, unknown> | null }) => {
        updates.push(input);
        return { ...delivery, ...input, attemptCount: input.status === "sending" ? 1 : delivery.attemptCount };
      }),
    };
    const service = new ChatProviderOutboundService({
      chatProviderRepository: repository as never,
      adapter: new ConfiguredChatProviderOutboundAdapter(),
      initialBackoffMs: 30_000,
      now: () => now,
    });

    const result = await service.attemptDelivery(delivery.id);

    expect(result.status).toBe("retryable_failure");
    expect(updates.at(-1)?.payload?.delivery).toEqual({
      state: "retryable_failure",
      retryable: true,
      nextAttemptAt: "2026-07-13T12:00:17.000Z",
    });
  });

  it("verifies with getMe and exposes non-mutating getWebhookInfo diagnostics", async () => {
    const requests: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      requests.push(url);
      if (url.endsWith("/getMe")) {
        return jsonResponse({
          ok: true,
          result: { id: 5_001_234_567_890, is_bot: true, first_name: "Code UX", username: "codeux_test_bot" },
        });
      }
      return jsonResponse({
        ok: true,
        result: {
          url: "https://codeux.example.test/api/chat-providers/ingress/telegram",
          has_custom_certificate: false,
          pending_update_count: 3,
          max_connections: 40,
          allowed_updates: ["message", "edited_message", "channel_post", "edited_channel_post"],
        },
      });
    });

    const result = await verifyTelegramOfficialApi(
      "official_api",
      { botUsername: "@codeux_test_bot" },
      { botToken: BOT_TOKEN, webhookSecret: WEBHOOK_SECRET },
      fetchMock as typeof fetch,
    );

    expect(result).toMatchObject({
      valid: true,
      issues: [],
      diagnostics: {
        bot: { id: "5001234567890", username: "codeux_test_bot" },
        webhook: {
          url: "https://codeux.example.test/api/chat-providers/ingress/telegram",
          pendingUpdateCount: 3,
          allowedUpdates: ["message", "edited_message", "channel_post", "edited_channel_post"],
        },
      },
    });
    expect(requests).toEqual([
      `https://api.telegram.org/bot${BOT_TOKEN}/getMe`,
      `https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`,
    ]);
    expect(requests.every((url) => !url.includes("setWebhook") && !url.includes("deleteWebhook"))).toBe(true);
  });

  it("retains managed and custom webhook outbound bridges", () => {
    const managed = buildOutboundContext("managed_bridge");
    managed.connection.setup = { bridgeUrl: "https://managed.example.test/send" };
    managed.connection.secrets = { bridgeApiKey: "bridge-key" };
    const custom = buildOutboundContext("webhook");
    custom.connection.setup = { webhookUrl: "https://custom.example.test/send" };

    expect(telegramChatConnectorProfile.outbound.buildRequest(managed)).toMatchObject({
      transport: "http",
      url: "https://managed.example.test/send",
      bearerSecretKeys: expect.arrayContaining(["bridgeApiKey"]),
    });
    expect(telegramChatConnectorProfile.outbound.buildRequest(custom)).toMatchObject({
      transport: "http",
      url: "https://custom.example.test/send",
      bearerSecretKeys: expect.arrayContaining(["botToken"]),
    });
    expect(telegramChatConnectorProfile.outbound.parseResponse(
      JSON.stringify({ messageId: "legacy-telegram-1" }),
      { mode: "webhook", statusCode: 200 },
    )).toMatchObject({ externalMessageId: "legacy-telegram-1" });
    expect(telegramChatConnectorProfile.outbound.isRetryableStatus(503, "webhook")).toBe(true);
  });
});

function buildUpdate(
  updateId: number,
  messageId: number,
  key: "message" | "edited_message" = "message",
  threadId?: number,
): Record<string, unknown> & { message: Record<string, unknown> } {
  const message = {
    message_id: messageId,
    ...(threadId !== undefined ? { message_thread_id: threadId } : {}),
    date: 1_783_430_400,
    text: "Telegram update",
    chat: { id: -1_001_234_567_890, title: "Operations" },
    from: { id: 5_001_234_567_890, first_name: "Taylor", is_bot: false },
  };
  return {
    update_id: updateId,
    [key]: message,
  } as Record<string, unknown> & { message: Record<string, unknown> };
}

function buildConnection(mode: ChatProviderBridgeMode): ChatProviderConnectionInternalRecord {
  return {
    id: "telegram-connection",
    providerKind: "telegram",
    displayName: "Telegram",
    bridgeMode: mode,
    status: "active",
    enabled: true,
    setup: {},
    secrets: { botToken: BOT_TOKEN, webhookSecret: WEBHOOK_SECRET },
    createdAt: "2026-07-13T00:00:00.000Z",
    updatedAt: "2026-07-13T00:00:00.000Z",
  };
}

function buildBinding(): ChatProviderChannelBindingRecord {
  return {
    id: "telegram-binding",
    providerConnectionId: "telegram-connection",
    providerKind: "telegram",
    externalChannelId: "-1001234567890",
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
  };
}

function buildDelivery(): ChatProviderMessageDeliveryRecord {
  return {
    id: "telegram-delivery",
    providerConnectionId: "telegram-connection",
    providerKind: "telegram",
    channelBindingId: "telegram-binding",
    externalChannelId: "-1001234567890",
    externalMessageId: null,
    direction: "outbound",
    status: "pending",
    attemptCount: 0,
    lastError: null,
    conversationThreadId: "conversation-thread",
    conversationMessageId: "conversation-message",
    payload: {
      providerKind: "telegram",
      providerConnectionId: "telegram-connection",
      channelId: "-1001234567890",
      threadId: "conversation-thread",
      conversationMessageId: "conversation-message",
      replyText: "Reply",
      replyToExternalMessageId: "telegram:301:-1001234567890:61",
      metadata: {},
    },
    createdAt: "2026-07-13T00:00:00.000Z",
    updatedAt: "2026-07-13T00:00:00.000Z",
  };
}

function buildOutboundContext(mode: ChatProviderBridgeMode = "official_api") {
  return {
    connection: buildConnection(mode),
    binding: buildBinding(),
    delivery: buildDelivery(),
    payload: {
      providerKind: "telegram",
      providerConnectionId: "telegram-connection",
      channelId: "-1001234567890",
      threadId: "conversation-thread",
      conversationMessageId: "conversation-message",
      replyText: "Telegram reply",
      replyToExternalMessageId: "telegram:301:-1001234567890:61",
      metadata: {},
    },
    correlationId: "correlation-1",
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
