import { describe, expect, it } from "vitest";
import type {
  ChatProviderChannelBindingRecord,
  ChatProviderMessageDeliveryRecord,
} from "../../../dashboard/src/v2/types.js";
import type {
  DashboardChatProviderConnectionRecord,
  DashboardChatProviderSetupDefinition,
} from "../../../dashboard/src/v2/lib/chat-provider-api.js";
import {
  buildChatProviderCatalogViewModel,
  createDefaultSetupForBridge,
  redactChatProviderError,
} from "../../../dashboard/src/v2/lib/chat-provider-view-models.js";

const definition: DashboardChatProviderSetupDefinition = {
  kind: "slack",
  label: "Slack",
  defaultBridgeMode: "openclaw",
  ingressUrlTemplate: "http://localhost/api/chat-providers/ingress/{connectionId}",
  bridgeModes: [
    {
      mode: "openclaw",
      label: "OpenClaw Slack plugin",
      integration: "openclaw_plugin",
      setupFields: [
        { key: "pluginName", label: "Plugin name", type: "string", required: true, defaultValue: "slack" },
        { key: "workspaceId", label: "Workspace", type: "string", required: false },
      ],
      secretFields: [
        { key: "openclawApiKey", label: "OpenClaw API key", required: true },
      ],
    },
  ],
};

const connection: DashboardChatProviderConnectionRecord = {
  id: "conn-1",
  providerKind: "slack",
  displayName: "Slack Bridge",
  bridgeMode: "openclaw",
  status: "active",
  enabled: true,
  setup: { pluginName: "slack" },
  credentials: [
    { key: "openclawApiKey", label: "OpenClaw API key", configured: true, redactedValue: "••••••••" },
  ],
  ingressUrl: "http://localhost/api/chat-providers/ingress/conn-1",
  setupHints: {
    bridgeModeLabel: "OpenClaw Slack plugin",
    integration: "openclaw_plugin",
    requiredSetupFields: ["pluginName"],
    requiredSecretFields: ["openclawApiKey"],
  },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const createBinding = (overrides: Partial<ChatProviderChannelBindingRecord>): ChatProviderChannelBindingRecord => ({
  id: "binding-1",
  providerConnectionId: "conn-1",
  providerKind: "slack",
  externalChannelId: "C123",
  externalChannelName: "engineering",
  externalChannelMetadata: null,
  projectId: "project-1",
  agentPresetId: null,
  routingHints: null,
  enabled: true,
  inboundEnabled: true,
  outboundEnabled: true,
  suppressRichWidgets: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

const createDelivery = (overrides: Partial<ChatProviderMessageDeliveryRecord>): ChatProviderMessageDeliveryRecord => ({
  id: "delivery-1",
  providerConnectionId: "conn-1",
  providerKind: "slack",
  channelBindingId: "binding-1",
  externalChannelId: "C123",
  externalMessageId: null,
  direction: "outbound",
  status: "failed",
  attemptCount: 2,
  lastError: "Bearer sk-abcdefghijklmnopqrstuvwxyz123456 leaked",
  conversationThreadId: null,
  conversationMessageId: "message-1",
  payload: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

describe("chat provider view models", () => {
  it("builds provider health counts and redacts failed delivery errors", () => {
    const [card] = buildChatProviderCatalogViewModel({
      definitions: [definition],
      connections: [connection],
      bindings: [
        createBinding({ id: "binding-1", projectId: "project-1", externalChannelId: "C123" }),
        createBinding({ id: "binding-2", projectId: "project-2", externalChannelId: "C123", outboundEnabled: false }),
      ],
      deliveriesByConnection: {
        "conn-1": [
          createDelivery({ id: "delivery-1", status: "failed" }),
          createDelivery({ id: "delivery-2", status: "pending", lastError: null }),
        ],
      },
    });

    expect(card.connectionCount).toBe(1);
    expect(card.activeConnectionCount).toBe(1);
    expect(card.configuredChannelCount).toBe(1);
    expect(card.boundProjectCount).toBe(2);
    expect(card.pendingOutboundCount).toBe(1);
    expect(card.failedOutboundCount).toBe(1);
    expect(card.outboundRepliesEnabled).toBe(true);
    expect(card.connections[0]?.authStatusLabel).toBe("Authenticated");
    expect(card.connections[0]?.recentFailedDeliveries[0]?.redactedError).toContain("[redacted]");
    expect(card.connections[0]?.recentFailedDeliveries[0]?.redactedError).not.toContain("abcdefghijklmnopqrstuvwxyz123456");
  });

  it("creates default setup and redacts common credential patterns", () => {
    expect(createDefaultSetupForBridge(definition, "openclaw")).toEqual({ pluginName: "slack" });
    expect(redactChatProviderError("token=abc123 secret: super-secret password=hunter2")).toBe("token=[redacted] secret: [redacted] password=[redacted]");
  });
});
