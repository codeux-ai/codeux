import { createHmac } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ChatProviderChannelBindingRecord,
  ChatProviderConnectionInternalRecord,
  ChatProviderMessageDeliveryRecord,
} from "../../../../src/contracts/chat-provider-types.js";
import {
  getSlackChallengeResponse,
  getSlackIgnoredEventReason,
  normalizeSlackEvent,
  parseSlackAuthTestResponse,
  parseSlackPostMessageResponse,
  slackChatConnectorProfile,
} from "../../../../src/domain/chat-connectors/providers/slack.js";
import type { ChatConnectorOutboundContext } from "../../../../src/domain/chat-connectors/types.js";
import {
  ChatProviderOutboundAdapterError,
  ConfiguredChatProviderOutboundAdapter,
} from "../../../../src/services/chat-provider-adapters.js";
import {
  ChatProviderIngressSecurity,
  ChatProviderIngressSecurityError,
} from "../../../../src/services/chat-provider-security.js";
import { registerChatProviderIngressRoutes } from "../../../../src/server/chat-provider-ingress-routes.js";
import type { DashboardDependencies } from "../../../../src/server/dashboard-server.js";

const OFFICIAL_SIGNING_SECRET = "8f742231b10e8888abcd99yyyzzz85a5";
const OFFICIAL_TIMESTAMP = "1531420618";
const OFFICIAL_BODY = "token=xyzz0WbapA4vBCDEFasx0q6G&team_id=T1DC2JH3J&team_domain=testteamnow&channel_id=G8PSS9T3V&channel_name=foobar&user_id=U2CERLKJA&user_name=roadrunner&command=%2Fwebhook-collect&text=&response_url=https%3A%2F%2Fhooks.slack.com%2Fcommands%2FT1DC2JH3J%2F397700885554%2F96rGlfmibIGlgcZRskXaIFfN&trigger_id=398738663015.47445629121.803a0bc887a14d10d2c447fce8b6703c";
const OFFICIAL_SIGNATURE = "v0=a2114d57b48eac39b9ad189dd8316235a7b4a8d21a10bd27519666489c69b503";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Slack chat connector profile", () => {
  it("adds a write-only official API schema without changing legacy bridge schemas", () => {
    expect(slackChatConnectorProfile.supportedTransportModes).toEqual([
      "managed_bridge",
      "webhook",
      "official_api",
    ]);
    expect(slackChatConnectorProfile.setupSchema.bridgeModes).toEqual([
      expect.objectContaining({
        mode: "managed_bridge",
        setupFields: expect.arrayContaining([expect.objectContaining({ key: "pluginName" })]),
        secretFields: [expect.objectContaining({ key: "bridgeApiKey" })],
      }),
      expect.objectContaining({
        mode: "webhook",
        setupFields: expect.arrayContaining([expect.objectContaining({ key: "eventsUrl" })]),
        secretFields: [
          expect.objectContaining({ key: "signingSecret" }),
          expect.objectContaining({ key: "botToken", required: false }),
        ],
      }),
      expect.objectContaining({
        mode: "official_api",
        integration: "official_api",
        setupFields: [
          expect.objectContaining({ key: "appId", required: true }),
          expect.objectContaining({ key: "workspaceId", required: true }),
          expect.objectContaining({ key: "workspaceName", required: false }),
        ],
        secretFields: [
          expect.objectContaining({ key: "signingSecret", required: true }),
          expect.objectContaining({ key: "botToken", required: true }),
        ],
      }),
    ]);
  });

  it("accepts Slack's published v0 vector and rejects a modified raw body", () => {
    const connection = officialConnection({ signingSecret: OFFICIAL_SIGNING_SECRET, botToken: "xoxb-test-token-value" });
    const now = new Date(Number(OFFICIAL_TIMESTAMP) * 1_000);

    expect(new ChatProviderIngressSecurity().verify(connection, {
      headers: {
        "X-Slack-Request-Timestamp": OFFICIAL_TIMESTAMP,
        "X-Slack-Signature": OFFICIAL_SIGNATURE,
      },
      rawBody: OFFICIAL_BODY,
      now,
    })).toEqual({ authenticated: true, method: "hmac" });

    expect(() => new ChatProviderIngressSecurity().verify(connection, {
      headers: {
        "x-slack-request-timestamp": OFFICIAL_TIMESTAMP,
        "x-slack-signature": OFFICIAL_SIGNATURE,
      },
      rawBody: `${OFFICIAL_BODY}&text=modified`,
      now,
    })).toThrowError(expect.objectContaining<Partial<ChatProviderIngressSecurityError>>({
      code: "signature_mismatch",
    }));
  });

  it("requires the exact Slack timestamp/signature headers and five-minute freshness window", () => {
    const connection = officialConnection({ signingSecret: "signing-secret", botToken: "xoxb-test-token-value" });
    const timestamp = "1783900800";
    const rawBody = JSON.stringify({ type: "event_callback", event_id: "Ev-one" });
    const signature = `v0=${createHmac("sha256", "signing-secret").update(`v0:${timestamp}:${rawBody}`).digest("hex")}`;
    const security = new ChatProviderIngressSecurity();

    expect(() => security.verify(connection, {
      headers: {
        "x-slack-request-timestamp": timestamp,
        "x-slack-signature": signature,
      },
      rawBody,
      now: new Date((Number(timestamp) * 1_000) + (5 * 60 * 1_000) + 1),
    })).toThrowError(expect.objectContaining<Partial<ChatProviderIngressSecurityError>>({ code: "stale_timestamp" }));

    expect(() => new ChatProviderIngressSecurity().verify(connection, {
      headers: {
        "x-code-ux-timestamp": timestamp,
        "x-code-ux-signature": signature,
      },
      rawBody,
      now: new Date(Number(timestamp) * 1_000),
    })).toThrowError(expect.objectContaining<Partial<ChatProviderIngressSecurityError>>({ code: "missing_timestamp" }));

    expect(() => new ChatProviderIngressSecurity().verify(connection, {
      headers: {
        "x-slack-request-timestamp": timestamp,
        "x-slack-signature": signature.replace("v0=", "sha256="),
      },
      rawBody,
      now: new Date(Number(timestamp) * 1_000),
    })).toThrowError(expect.objectContaining<Partial<ChatProviderIngressSecurityError>>({ code: "invalid_signature" }));
  });

  it("returns URL verification challenges synchronously and marks event callbacks for immediate acknowledgement", () => {
    expect(getSlackChallengeResponse({ type: "url_verification", challenge: "challenge-value" })).toEqual({
      challenge: "challenge-value",
    });
    expect(getSlackChallengeResponse({ type: "event_callback", challenge: "ignored" })).toBeNull();
    expect(slackChatConnectorProfile.ingress.handshake).toMatchObject({
      type: "challenge",
      challengeField: "challenge",
      responseField: "challenge",
      modes: ["official_api"],
    });
    expect(slackChatConnectorProfile.ingress.acknowledgement).toMatchObject({
      statusCode: 200,
      immediateModes: ["official_api"],
    });
  });

  it("answers challenges and acknowledges callbacks without waiting for event processing", async () => {
    const providerConnection = officialConnection({
      signingSecret: "route-signing-secret",
      botToken: "xoxb-test-token-value",
    });
    let finishProcessing: (() => void) | undefined;
    const processing = new Promise<void>((resolve) => {
      finishProcessing = resolve;
    });
    const processInbound = vi.fn(async () => {
      await processing;
      return {
        status: "accepted" as const,
        message: "processed",
        providerConnectionId: providerConnection.id,
        providerKind: "slack" as const,
      };
    });
    const app = express();
    app.use(express.json({
      verify: (req, _res, buffer) => {
        (req as typeof req & { rawBody?: string }).rawBody = buffer.toString("utf8");
      },
    }));
    registerChatProviderIngressRoutes(app, {
      chatProviderRepository: { getConnectionInternal: () => providerConnection },
      chatProviderIngressService: { processInbound },
    } as unknown as DashboardDependencies);

    const challengeBody = JSON.stringify({ type: "url_verification", challenge: "route-challenge" });
    const challengeHeaders = signedRouteHeaders(challengeBody, "route-signing-secret");
    const challenge = await request(app)
      .post(`/api/chat-providers/ingress/${providerConnection.id}`)
      .set(challengeHeaders)
      .set("content-type", "application/json")
      .send(challengeBody);
    expect(challenge.status).toBe(200);
    expect(challenge.body).toEqual({ challenge: "route-challenge" });
    expect(processInbound).not.toHaveBeenCalled();

    const callbackBody = JSON.stringify({
      type: "event_callback",
      event_id: "Ev-fast-ack",
      event: { type: "message", channel: "C-channel", user: "U-user", text: "process later", ts: "1.2" },
    });
    const callbackHeaders = signedRouteHeaders(callbackBody, "route-signing-secret");
    const callback = await request(app)
      .post(`/api/chat-providers/ingress/${providerConnection.id}`)
      .set(callbackHeaders)
      .set("content-type", "application/json")
      .send(callbackBody);

    expect(callback.status).toBe(200);
    expect(callback.text).toBe("");
    await vi.waitFor(() => expect(processInbound).toHaveBeenCalledTimes(1));
    finishProcessing?.();
  });

  it("normalizes event IDs and Slack thread identity while keeping duplicate IDs stable", () => {
    const payload = {
      type: "event_callback",
      event_id: "Ev-duplicate",
      event: {
        type: "message",
        channel: "C-channel",
        user: "U-user",
        text: "A threaded request",
        ts: "1783900800.000200",
        thread_ts: "1783900700.000100",
      },
    };

    expect(normalizeSlackEvent(payload)).toEqual({
      externalChannelId: "C-channel",
      externalChannelName: "C-channel",
      externalSenderId: "U-user",
      externalSenderName: "U-user",
      textBody: "A threaded request",
      externalMessageId: "Ev-duplicate",
      conversationThreadId: "1783900700.000100",
      timestamp: "1783900800.000200",
    });
    expect(normalizeSlackEvent({ ...payload, event: { ...payload.event, text: "Slack retry" } }).externalMessageId)
      .toBe("Ev-duplicate");
  });

  it("suppresses bot loops, connector-generated messages, and unusable message changes", () => {
    expect(getSlackIgnoredEventReason({
      type: "event_callback",
      event: { type: "message", bot_id: "B-bot", text: "bot output" },
    })).toBe("bot_message");
    expect(getSlackIgnoredEventReason({
      type: "event_callback",
      event: {
        type: "message",
        text: "connector output",
        metadata: { event_type: "codeux_connector_message" },
      },
    })).toBe("connector_generated");
    expect(getSlackIgnoredEventReason({
      type: "event_callback",
      event: { type: "message", subtype: "message_changed", message: { ts: "1.2" } },
    })).toBe("message_change_without_text");
    expect(normalizeSlackEvent({
      type: "event_callback",
      event_id: "Ev-change",
      event: {
        type: "message",
        subtype: "message_changed",
        channel: "C-channel",
        message: { user: "U-user", text: "edited text", ts: "2.3", thread_ts: "1.2" },
      },
    })).toMatchObject({
      externalMessageId: "Ev-change",
      textBody: "edited text",
      conversationThreadId: "1.2",
    });
  });

  it("posts accessible text to Slack's fixed API URL and preserves parent thread timestamps", () => {
    const request = slackChatConnectorProfile.outbound.buildRequest(outboundContext("official_api"));

    expect(request).toMatchObject({
      transport: "http",
      url: "https://slack.com/api/chat.postMessage",
      bearerSecretKeys: ["botToken"],
      body: {
        channel: "C-channel",
        text: "Accessible reply text",
        thread_ts: "1783900700.000100",
        metadata: { event_type: "codeux_connector_message" },
      },
      rateLimit: {
        key: "slack:connection-slack:C-channel",
        minimumIntervalMs: 1_000,
      },
    });
    expect(request.transport === "http" ? request.url : "").not.toContain("configured.example.test");
  });

  it("parses Slack API envelopes independently of HTTP status and reports channel capability failures", () => {
    expect(parseSlackPostMessageResponse(JSON.stringify({ ok: true, ts: "1783900800.000300" }), {
      statusCode: 200,
      headers: {},
    })).toEqual({
      externalMessageId: "1783900800.000300",
      responseMetadata: { ok: true },
    });
    expect(parseSlackPostMessageResponse(JSON.stringify({ ok: false, error: "missing_scope" }), {
      statusCode: 200,
      headers: {},
    })).toMatchObject({
      failure: {
        message: "Slack chat.postMessage failed: missing_scope.",
        retryable: false,
        diagnostic: { capability: "chat:write", status: "missing" },
      },
    });
    expect(parseSlackPostMessageResponse(JSON.stringify({ ok: false, error: "not_in_channel" }), {
      statusCode: 200,
      headers: {},
    })).toMatchObject({
      failure: {
        message: "Slack chat.postMessage failed: not_in_channel.",
        retryable: false,
        diagnostic: { capability: "channel_membership", status: "missing" },
      },
    });
    expect(JSON.stringify(parseSlackPostMessageResponse(JSON.stringify({
      ok: false,
      error: "xoxb-secret-token-value-that-must-not-escape",
    })))).not.toContain("xoxb-secret");
  });

  it("preserves Retry-After seconds from Slack 429 responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: false, error: "ratelimited" }), {
      status: 429,
      headers: { "content-type": "application/json", "retry-after": "42" },
    })));
    const adapter = new ConfiguredChatProviderOutboundAdapter();

    const error = await adapter.send(outboundContext("official_api")).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ChatProviderOutboundAdapterError);
    expect(error).toMatchObject({
      retryable: true,
      statusCode: 429,
      retryAfterMs: 42_000,
    });
  });

  it("paces official posts independently per Slack channel", async () => {
    vi.useFakeTimers({ now: new Date("2026-07-13T00:00:00.000Z") });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, ts: "1.2" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new ConfiguredChatProviderOutboundAdapter();

    await adapter.send(outboundContext("official_api"));
    const second = adapter.send(outboundContext("official_api"));
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await second;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("builds auth.test verification and returns redacted capability diagnostics", () => {
    expect(slackChatConnectorProfile.verification.live?.buildRequest({
      setup: { appId: "A-app", workspaceId: "T-workspace" },
      correlationId: "corr-slack",
    })).toMatchObject({
      url: "https://slack.com/api/auth.test",
      bearerSecretKeys: ["botToken"],
      body: {},
    });

    expect(parseSlackAuthTestResponse(JSON.stringify({
      ok: true,
      team_id: "T-workspace",
      bot_id: "B-bot",
      user_id: "U-bot",
    }), {
      statusCode: 200,
      headers: { "x-oauth-scopes": "commands,chat:write" },
    }, { workspaceId: "T-workspace" })).toMatchObject({
      valid: true,
      issues: [],
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ capability: "bot_identity", status: "available" }),
        expect.objectContaining({ capability: "workspace_binding", status: "available" }),
        expect.objectContaining({ capability: "chat:write", status: "available" }),
        expect.objectContaining({ capability: "channel_membership", status: "unknown" }),
      ]),
    });

    const mismatch = parseSlackAuthTestResponse(JSON.stringify({
      ok: true,
      team_id: "T-other",
      bot_id: "B-bot",
    }), {
      statusCode: 200,
      headers: { "x-oauth-scopes": "commands" },
    }, { workspaceId: "T-configured" });
    expect(mismatch).toMatchObject({
      valid: false,
      issues: [
        "Slack token workspace does not match the configured workspace.",
        "Slack bot token is missing the chat:write scope.",
      ],
    });
    expect(JSON.stringify(mismatch)).not.toContain("T-other");
    expect(JSON.stringify(mismatch)).not.toContain("T-configured");

    const revoked = parseSlackAuthTestResponse(JSON.stringify({ ok: false, error: "token_revoked" }), {
      statusCode: 200,
      headers: {},
    }, { workspaceId: "T-configured" });
    expect(revoked).toMatchObject({
      valid: false,
      issues: ["Slack bot token is invalid or revoked."],
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ capability: "bot_token", status: "missing" }),
      ]),
    });
  });

  it("retains managed bridge and explicit custom webhook outbound behavior", () => {
    const managed = slackChatConnectorProfile.outbound.buildRequest(outboundContext("managed_bridge"));
    const webhook = slackChatConnectorProfile.outbound.buildRequest(outboundContext("webhook"));

    expect(managed).toMatchObject({
      transport: "http",
      url: "https://configured.example.test/managed",
      body: expect.objectContaining({ replyText: "Accessible reply text" }),
    });
    expect(webhook).toMatchObject({
      transport: "http",
      url: "https://configured.example.test/events",
      body: expect.objectContaining({ replyText: "Accessible reply text" }),
    });
  });
});

function officialConnection(secrets: Record<string, unknown>): ChatProviderConnectionInternalRecord {
  return connection("official_api", secrets);
}

function connection(
  bridgeMode: ChatProviderConnectionInternalRecord["bridgeMode"],
  secrets: Record<string, unknown>,
): ChatProviderConnectionInternalRecord {
  return {
    id: "connection-slack",
    providerKind: "slack",
    displayName: "Slack test",
    bridgeMode,
    status: "active",
    enabled: true,
    setup: {
      appId: "A-app",
      workspaceId: "T-workspace",
      bridgeUrl: "https://configured.example.test/managed",
      eventsUrl: "https://configured.example.test/events",
    },
    secrets,
    createdAt: "2026-07-13T00:00:00.000Z",
    updatedAt: "2026-07-13T00:00:00.000Z",
  };
}

function outboundContext(
  bridgeMode: ChatProviderConnectionInternalRecord["bridgeMode"],
): ChatConnectorOutboundContext {
  const providerConnection = connection(bridgeMode, {
    botToken: "xoxb-test-token-value",
    bridgeApiKey: "bridge-secret",
    signingSecret: "signing-secret",
  });
  const binding: ChatProviderChannelBindingRecord = {
    id: "binding-slack",
    providerConnectionId: providerConnection.id,
    providerKind: "slack",
    externalChannelId: "C-channel",
    externalChannelName: "channel",
    externalChannelMetadata: null,
    projectId: "project-test",
    agentPresetId: null,
    routingHints: null,
    enabled: true,
    inboundEnabled: true,
    outboundEnabled: true,
    suppressRichWidgets: true,
    createdAt: "2026-07-13T00:00:00.000Z",
    updatedAt: "2026-07-13T00:00:00.000Z",
  };
  const delivery: ChatProviderMessageDeliveryRecord = {
    id: "delivery-slack",
    providerConnectionId: providerConnection.id,
    providerKind: "slack",
    channelBindingId: binding.id,
    externalChannelId: binding.externalChannelId,
    externalMessageId: null,
    direction: "outbound",
    status: "pending",
    attemptCount: 0,
    lastError: null,
    conversationThreadId: "thread-codeux",
    conversationMessageId: "message-codeux",
    payload: null,
    createdAt: "2026-07-13T00:00:00.000Z",
    updatedAt: "2026-07-13T00:00:00.000Z",
  };
  return {
    connection: providerConnection,
    binding,
    delivery,
    correlationId: "corr-slack",
    payload: {
      providerKind: "slack",
      providerConnectionId: providerConnection.id,
      channelId: binding.externalChannelId,
      threadId: "thread-codeux",
      conversationMessageId: "message-codeux",
      replyText: "Accessible reply text",
      replyToExternalMessageId: "Ev-inbound",
      metadata: {
        inboundPayload: {
          rawMetadata: {
            event: {
              ts: "1783900800.000200",
              thread_ts: "1783900700.000100",
            },
          },
        },
      },
    },
  };
}

function signedRouteHeaders(rawBody: string, signingSecret: string): Record<string, string> {
  const timestamp = String(Math.floor(Date.now() / 1_000));
  return {
    "x-slack-request-timestamp": timestamp,
    "x-slack-signature": `v0=${createHmac("sha256", signingSecret).update(`v0:${timestamp}:${rawBody}`).digest("hex")}`,
  };
}
