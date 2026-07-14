import { expect, type APIRequestContext, type Page, type Route } from "@playwright/test";
import type {
  ChatProviderPublicDeliveryRecord,
  ChatProviderConnectionRecord,
} from "../../../src/contracts/chat-provider-types.js";

const fixtureTimestamp = "2026-07-14T12:00:00.000Z";

export async function createSlackFixtureConnection(request: APIRequestContext): Promise<ChatProviderConnectionRecord & { ingressUrl: string }> {
  const response = await request.post("/api/chat-providers/connections", {
    headers: { "Content-Type": "application/json" },
    data: {
      providerKind: "slack",
      displayName: "Slack acceptance fixture",
      bridgeMode: "managed_bridge",
      status: "active",
      enabled: true,
      setup: { pluginName: "fixture-slack-plugin", workspaceId: "T-FIXTURE" },
      secrets: { bridgeApiKey: "fixture-slack-browser-secret" },
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  const connection = await response.json() as ChatProviderConnectionRecord & { ingressUrl: string };
  expect(JSON.stringify(connection)).not.toContain("fixture-slack-browser-secret");
  return connection;
}

export async function installDeliveryFixtureBoundary(page: Page, connectionId: string): Promise<{
  retryId: string;
  cancelId: string;
}> {
  const retryId = "delivery-retry-fixture";
  const cancelId = "delivery-cancel-fixture";
  const deliveries: ChatProviderPublicDeliveryRecord[] = [
    delivery(connectionId, retryId, "retryable_failure", "Provider timeout token=fixture-secret-value at https://signed.example.test/path?token=fixture"),
    delivery(connectionId, cancelId, "pending", null),
  ];

  await page.route("**/api/chat-providers/**", async (route) => {
    const url = new URL(route.request().url());
    const pathname = url.pathname;
    if (route.request().method() === "GET" && pathname === `/api/chat-providers/connections/${connectionId}/delivery-status`) {
      await json(route, 200, { deliveries });
      return;
    }
    const match = pathname.match(/^\/api\/chat-providers\/deliveries\/([^/]+)(?:\/(retry|cancel))?$/);
    if (!match || ![retryId, cancelId].includes(match[1])) {
      await route.fallback();
      return;
    }
    const record = deliveries.find((entry) => entry.id === match[1])!;
    if (route.request().method() === "GET") {
      await json(route, 503, { error: "Bearer fixture-secret-value failed at https://signed.example.test/private?token=fixture-secret-value" });
      return;
    }
    if (match[2] === "retry") {
      Object.assign(record, { status: "delivered", attemptCount: record.attemptCount + 1, lastError: null, nextAttemptAt: null });
      await json(route, 200, record);
      return;
    }
    if (match[2] === "cancel") {
      Object.assign(record, { status: "cancelled", lastError: null, nextAttemptAt: null });
      await json(route, 200, record);
      return;
    }
    await route.fallback();
  });
  return { retryId, cancelId };
}

function delivery(
  providerConnectionId: string,
  id: string,
  status: ChatProviderPublicDeliveryRecord["status"],
  lastError: string | null,
): ChatProviderPublicDeliveryRecord {
  return {
    id,
    providerConnectionId,
    providerKind: "slack",
    channelBindingId: "binding-fixture",
    externalChannelId: "C-FIXTURE",
    externalMessageId: null,
    direction: "outbound",
    status,
    attemptCount: status === "retryable_failure" ? 1 : 0,
    lastError,
    conversationThreadId: "thread-fixture",
    conversationMessageId: `message-${id}`,
    nextAttemptAt: status === "retryable_failure" ? "2026-07-14T12:01:00.000Z" : null,
    createdAt: fixtureTimestamp,
    updatedAt: fixtureTimestamp,
  };
}

async function json(route: Route, status: number, body: unknown): Promise<void> {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}
