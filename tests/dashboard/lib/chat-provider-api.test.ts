import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cancelChatProviderDelivery,
  fetchChatProviderDelivery,
  fetchChatProviderHealth,
  retryChatProviderDelivery,
  verifyChatProviderConnection,
} from "../../../dashboard/src/v2/lib/chat-provider-api.js";

const jsonResponse = (value: unknown): Response => new Response(JSON.stringify(value), {
  status: 200,
  headers: { "Content-Type": "application/json" },
});

describe("chat provider dashboard API", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses only Code UX REST endpoints for verification, health, and delivery inspection", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ providerConnectionId: "connection-1", providerKind: "discord", status: "verified", verifiedAt: null, capabilities: [], providerErrorCode: null, retryable: false, issues: [], diagnostics: null, setupGuidance: {} }))
      .mockResolvedValueOnce(jsonResponse({ configuredCount: 1, activeCount: 1, verifiedCount: 1, errorCount: 0, lastVerificationOutcomes: [] }))
      .mockResolvedValueOnce(jsonResponse({ id: "delivery-1" }));
    vi.stubGlobal("fetch", fetchMock);
    await verifyChatProviderConnection("connection-1");
    await fetchChatProviderHealth();
    await fetchChatProviderDelivery("delivery-1");
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/chat-providers/connections/connection-1/verify",
      "/api/chat-providers/health",
      "/api/chat-providers/deliveries/delivery-1",
    ]);
  });

  it("sends explicit approval for retry and keeps cancellation on the backend", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse({ id: "delivery-1" }));
    vi.stubGlobal("fetch", fetchMock);
    await retryChatProviderDelivery("delivery-1");
    await cancelChatProviderDelivery("delivery-1");
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({ approval: { confirmed: true } });
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/chat-providers/deliveries/delivery-1/cancel");
  });
});
