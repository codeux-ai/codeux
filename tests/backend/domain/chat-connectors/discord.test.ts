import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type {
  ChatProviderChannelBindingRecord,
  ChatProviderConnectionInternalRecord,
  ChatProviderMessageDeliveryRecord,
} from "../../../../src/contracts/chat-provider-types.js";
import {
  DISCORD_API_BASE_URL,
  DISCORD_DEFAULT_INTENTS,
  DISCORD_MESSAGE_CONTENT_INTENT,
  DiscordApiError,
  DiscordOfficialApiClient,
  discordChatConnectorProfile,
  normalizeDiscordGatewayEvent,
  stableDiscordNonce,
  verifyDiscordInteractionRequest,
} from "../../../../src/domain/chat-connectors/providers/discord.js";
import type { ChatConnectorOutboundContext } from "../../../../src/domain/chat-connectors/types.js";

const PRIVATE_KEY = createPrivateKey({
  key: Buffer.from("302e020100300506032b6570042204209d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60", "hex"),
  format: "der",
  type: "pkcs8",
});
const PUBLIC_KEY = createPublicKey(PRIVATE_KEY).export({ format: "der", type: "spki" }).subarray(-32).toString("hex");
const NOW = new Date("2026-07-13T12:00:00.000Z");
const TIMESTAMP = String(Math.floor(NOW.getTime() / 1_000));

describe("Discord connector profile", () => {
  it("retains the legacy webhook contract and adds official_api setup", () => {
    expect(discordChatConnectorProfile.setupSchema.defaultBridgeMode).toBe("webhook");
    expect(discordChatConnectorProfile.supportedTransportModes).toEqual(["webhook", "official_api"]);
    expect(discordChatConnectorProfile.setupSchema.bridgeModes).toEqual([
      expect.objectContaining({
        mode: "webhook",
        setupFields: expect.arrayContaining([expect.objectContaining({ key: "gatewayUrl" })]),
      }),
      expect.objectContaining({
        mode: "official_api",
        setupFields: expect.arrayContaining([
          expect.objectContaining({ key: "applicationId", required: true }),
          expect.objectContaining({ key: "publicKey", required: true }),
          expect.objectContaining({ key: "intents", defaultValue: String(DISCORD_DEFAULT_INTENTS) }),
        ]),
        secretFields: [expect.objectContaining({ key: "botToken", required: true })],
      }),
    ]);
  });

  it("requires a valid public key, intents bitfield, and privileged MESSAGE_CONTENT intent", () => {
    const withoutIntent = discordChatConnectorProfile.verification.verifyConfiguration(
      "official_api",
      { applicationId: "123", publicKey: PUBLIC_KEY, intents: "513" },
      { botToken: "write-only-token" },
    );
    expect(withoutIntent).toEqual({
      valid: false,
      issues: ["Discord MESSAGE_CONTENT intent is required to receive ordinary message text."],
    });
    expect(DISCORD_DEFAULT_INTENTS & DISCORD_MESSAGE_CONTENT_INTENT).toBe(DISCORD_MESSAGE_CONTENT_INTENT);
  });

  it("verifies Ed25519 over the exact timestamp and raw body and returns PONG", () => {
    const rawBody = '{ "type": 1, "exact": "  spacing  " }';
    const result = verifyDiscordInteractionRequest(signedRequest(rawBody));

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      kind: "ping",
      response: {
        statusCode: 200,
        headers: { "content-type": "application/json" },
        body: { type: 1 },
      },
    }));

    const reformatted = verifyDiscordInteractionRequest({
      ...signedRequest(rawBody),
      rawBody: JSON.stringify(JSON.parse(rawBody)),
    });
    expect(reformatted).toMatchObject({ ok: false, code: "signature_mismatch", statusCode: 401 });
  });

  it("rejects invalid, malformed, and stale interaction authentication deterministically", () => {
    const valid = signedRequest('{"type":1}');
    expect(verifyDiscordInteractionRequest({ ...valid, headers: {} })).toMatchObject({ ok: false, code: "missing_signature" });
    expect(verifyDiscordInteractionRequest({
      ...valid,
      headers: { ...valid.headers, "X-Signature-Ed25519": "not-hex" },
    })).toMatchObject({ ok: false, code: "malformed_signature" });
    expect(verifyDiscordInteractionRequest({ ...valid, now: new Date("2026-07-13T12:10:00.000Z") })).toMatchObject({
      ok: false,
      code: "stale_timestamp",
    });
  });

  it("normalizes supported HTTP interactions into stable message and thread identities", () => {
    const rawBody = JSON.stringify({
      id: "111111111111111111",
      type: 2,
      channel_id: "222222222222222222",
      channel: { id: "222222222222222222", name: "triage", type: 11 },
      member: { nick: "Alex", user: { id: "333333333333333333", username: "alex" } },
      data: { name: "ask", options: [{ name: "prompt", value: "repair CI" }] },
    });
    const result = verifyDiscordInteractionRequest(signedRequest(rawBody));

    expect(result).toMatchObject({
      ok: true,
      kind: "message",
      normalized: {
        externalChannelId: "222222222222222222",
        externalChannelName: "triage",
        externalSenderId: "333333333333333333",
        externalSenderName: "alex",
        externalMessageId: "111111111111111111",
        externalThreadId: "222222222222222222",
        textBody: "repair CI",
      },
    });
  });

  it("normalizes MESSAGE_CREATE and suppresses only the connector bot's own messages", () => {
    const payload = {
      op: 0,
      t: "MESSAGE_CREATE",
      s: 42,
      d: {
        id: "111111111111111111",
        channel_id: "222222222222222222",
        content: "Investigate the failure",
        timestamp: "2026-07-13T12:00:00.000Z",
        author: { id: "333333333333333333", username: "alex" },
      },
    };
    expect(normalizeDiscordGatewayEvent(payload, "999999999999999999")).toMatchObject({
      kind: "message",
      normalized: {
        externalChannelId: "222222222222222222",
        externalSenderId: "333333333333333333",
        externalMessageId: "111111111111111111",
        textBody: "Investigate the failure",
      },
    });
    expect(normalizeDiscordGatewayEvent(payload, "333333333333333333")).toEqual({ kind: "ignored", reason: "self_message" });
  });

  it("keeps legacy gateway URLs but pins official replies to Discord API v10", () => {
    const legacy = discordChatConnectorProfile.outbound.buildRequest(outboundContext("webhook"));
    expect(legacy).toMatchObject({ url: "https://bridge.example.test/discord", bearerSecretKeys: expect.arrayContaining(["botToken"]) });

    const official = discordChatConnectorProfile.outbound.buildRequest(outboundContext("official_api"));
    expect(official.url).toBe(`${DISCORD_API_BASE_URL}/channels/222222222222222222/messages`);
    expect(official.url).not.toContain("bridge.example.test");
    expect(official).toMatchObject({
      headers: { authorization: "Bot discord-test-token" },
      body: {
        content: "Fixed the workflow",
        allowed_mentions: { parse: [] },
        enforce_nonce: true,
        message_reference: { message_id: "111111111111111111", fail_if_not_exists: false },
      },
    });
    expect((official.body as { nonce: string }).nonce).toBe(stableDiscordNonce("delivery-1"));
  });
});

describe("Discord official REST client", () => {
  it("sends safe idempotent replies and parses returned snowflakes", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: "444444444444444444" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    const client = new DiscordOfficialApiClient({ fetch: fetchImpl });

    await expect(client.sendReply({
      botToken: "secret-token",
      channelId: "222222222222222222",
      content: "@everyone safe reply",
      deliveryId: "delivery-1",
      replyToMessageId: "111111111111111111",
    })).resolves.toMatchObject({ externalMessageId: "444444444444444444" });

    expect(fetchImpl).toHaveBeenCalledWith(
      `${DISCORD_API_BASE_URL}/channels/222222222222222222/messages`,
      expect.objectContaining({ method: "POST", headers: expect.objectContaining({ authorization: "Bot secret-token" }) }),
    );
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(body).toEqual(expect.objectContaining({
      allowed_mentions: { parse: [] },
      nonce: stableDiscordNonce("delivery-1"),
      enforce_nonce: true,
      message_reference: { message_id: "111111111111111111", fail_if_not_exists: false },
    }));
  });

  it("honors one 429 retry and does not create a retry storm", async () => {
    const wait = vi.fn(async () => undefined);
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429, headers: { "retry-after": "1.25" } }))
      .mockResolvedValueOnce(new Response("still limited", { status: 429, headers: { "retry-after": "2" } }));
    const client = new DiscordOfficialApiClient({ fetch: fetchImpl, wait, now: () => 1_000 });

    await expect(client.sendReply({
      botToken: "secret-token",
      channelId: "222222222222222222",
      content: "reply",
      deliveryId: "delivery-1",
    })).rejects.toMatchObject({ code: "rate_limited", retryable: true, retryAfterMs: 2_000 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(1_250, undefined);
  });

  it("honors the JSON retry_after fallback when Discord omits rate-limit headers", async () => {
    const wait = vi.fn(async () => undefined);
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ retry_after: 0.25, global: false }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "444444444444444444" }), { status: 200 }));
    const client = new DiscordOfficialApiClient({ fetch: fetchImpl, wait, now: () => 1_000 });

    await expect(client.sendReply({
      botToken: "secret-token",
      channelId: "222222222222222222",
      content: "reply",
      deliveryId: "delivery-1",
    })).resolves.toMatchObject({ externalMessageId: "444444444444444444" });
    expect(wait).toHaveBeenCalledWith(250, undefined);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it.each([
    [401, "invalid_auth"],
    [403, "missing_permissions"],
    [429, "rate_limited"],
  ] as const)("classifies credential HTTP %s without exposing the token", async (status, classification) => {
    const client = new DiscordOfficialApiClient({
      fetch: vi.fn(async () => new Response(`server echoed highly-sensitive-bot-token`, { status })),
    });
    const result = await client.verifyCredentials("highly-sensitive-bot-token");
    expect(result).toMatchObject({ valid: false, classification });
    expect(JSON.stringify(result)).not.toContain("highly-sensitive-bot-token");
  });

  it("uses only the read-only current-user endpoint for credential verification", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      id: "555555555555555555",
      username: "codeux-bot",
    }), { status: 200 }));
    const client = new DiscordOfficialApiClient({ fetch: fetchImpl });

    await expect(client.verifyCredentials("secret-token")).resolves.toEqual({
      valid: true,
      classification: "verified",
      botUserId: "555555555555555555",
      botUsername: "codeux-bot",
      issues: [],
    });
    expect(fetchImpl).toHaveBeenCalledWith(`${DISCORD_API_BASE_URL}/users/@me`, expect.objectContaining({ method: "GET" }));
  });

  it("classifies timeouts, cancellation, and ambiguous network outcomes", async () => {
    const timedOut = new DOMException("timed out", "TimeoutError");
    const timeoutClient = new DiscordOfficialApiClient({ fetch: vi.fn(async () => { throw timedOut; }) });
    expect(await timeoutClient.verifyCredentials("token")).toMatchObject({ classification: "timeout" });

    const controller = new AbortController();
    controller.abort();
    const cancelledClient = new DiscordOfficialApiClient({ fetch: vi.fn(async () => { throw new Error("cancelled"); }) });
    expect(await cancelledClient.verifyCredentials("token", controller.signal)).toMatchObject({ classification: "cancelled" });

    const networkClient = new DiscordOfficialApiClient({ fetch: vi.fn(async () => { throw new Error("token in socket error"); }) });
    const result = await networkClient.verifyCredentials("token in socket error");
    expect(result).toMatchObject({ classification: "ambiguous_network" });
    expect(JSON.stringify(result)).not.toContain("token in socket error");
  });

  it("uses typed errors without retaining secrets", () => {
    const error = new DiscordApiError("invalid_auth", "Discord rejected bot authentication.", false, 401);
    expect(JSON.stringify(error)).not.toContain("secret-token");
  });
});

function signedRequest(rawBody: string) {
  const signature = sign(null, Buffer.from(`${TIMESTAMP}${rawBody}`), PRIVATE_KEY).toString("hex");
  return {
    rawBody,
    publicKey: PUBLIC_KEY,
    now: NOW,
    headers: {
      "X-Signature-Ed25519": signature,
      "X-Signature-Timestamp": TIMESTAMP,
    },
  };
}

function outboundContext(mode: "webhook" | "official_api"): ChatConnectorOutboundContext {
  const connection = {
    id: "connection-1",
    providerKind: "discord",
    displayName: "Discord",
    bridgeMode: mode,
    status: "active",
    enabled: true,
    setup: { gatewayUrl: "https://bridge.example.test/discord" },
    secrets: { botToken: "discord-test-token" },
    credentials: [],
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  } satisfies ChatProviderConnectionInternalRecord;
  const binding = {
    id: "binding-1",
    providerConnectionId: connection.id,
    providerKind: "discord",
    externalChannelId: "222222222222222222",
    externalChannelName: "triage",
    externalChannelMetadata: null,
    projectId: "project-1",
    agentPresetId: null,
    routingHints: null,
    enabled: true,
    inboundEnabled: true,
    outboundEnabled: true,
    suppressRichWidgets: true,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  } satisfies ChatProviderChannelBindingRecord;
  const delivery = {
    id: "delivery-1",
    providerConnectionId: connection.id,
    providerKind: "discord",
    channelBindingId: binding.id,
    externalChannelId: binding.externalChannelId,
    externalMessageId: null,
    direction: "outbound",
    status: "sending",
    attemptCount: 1,
    lastError: null,
    conversationThreadId: "thread-1",
    conversationMessageId: "conversation-message-1",
    payload: null,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  } satisfies ChatProviderMessageDeliveryRecord;
  return {
    connection,
    binding,
    delivery,
    correlationId: "correlation-1",
    payload: {
      providerKind: "discord",
      providerConnectionId: connection.id,
      channelId: binding.externalChannelId,
      threadId: "thread-1",
      conversationMessageId: "conversation-message-1",
      replyText: "Fixed the workflow",
      replyToExternalMessageId: "111111111111111111",
      metadata: {},
    },
  };
}

