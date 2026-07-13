import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatProviderBridgeMode, ChatProviderKind } from "../../../../src/contracts/chat-provider-types.js";

afterEach(() => {
  vi.doUnmock("node:child_process");
  vi.unstubAllGlobals();
});

describe("chat connector registry", () => {
  it("registers every chat provider kind exactly once", async () => {
    const { CHAT_CONNECTOR_KINDS, CHAT_CONNECTOR_REGISTRY, createChatConnectorRegistry } = await import(
      "../../../../src/domain/chat-connectors/registry.js"
    );

    expect(CHAT_CONNECTOR_REGISTRY.profiles.map((profile) => profile.kind)).toEqual(CHAT_CONNECTOR_KINDS);
    expect(new Set(CHAT_CONNECTOR_REGISTRY.profiles.map((profile) => profile.kind))).toHaveLength(6);
    for (const kind of CHAT_CONNECTOR_KINDS) {
      expect(CHAT_CONNECTOR_REGISTRY.get(kind).kind).toBe(kind);
    }
    expect(() => createChatConnectorRegistry([
      ...CHAT_CONNECTOR_REGISTRY.profiles,
      CHAT_CONNECTOR_REGISTRY.profiles[0],
    ])).toThrow("Duplicate chat connector profile: whatsapp");
  });

  it("retains the legacy bridge schemas and setup field contracts", async () => {
    const { CHAT_CONNECTOR_REGISTRY } = await import("../../../../src/domain/chat-connectors/registry.js");
    const schemaSummary = Object.fromEntries(CHAT_CONNECTOR_REGISTRY.profiles.map((profile) => [
      profile.kind,
      {
        defaultMode: profile.setupSchema.defaultBridgeMode,
        modes: profile.setupSchema.bridgeModes.map((bridge) => ({
          mode: bridge.mode,
          integration: bridge.integration,
          setup: bridge.setupFields.map((field) => field.key),
          secrets: bridge.secretFields.map((field) => field.key),
        })),
      },
    ]));

    expect(schemaSummary).toEqual({
      whatsapp: {
        defaultMode: "managed_bridge",
        modes: [
          { mode: "managed_bridge", integration: "managed_plugin", setup: ["pluginName", "workspaceId"], secrets: ["bridgeApiKey"] },
          { mode: "webhook", integration: "webhook", setup: ["webhookUrl", "verifyTokenName"], secrets: ["webhookSecret", "verifyToken"] },
        ],
      },
      imessage: {
        defaultMode: "managed_bridge",
        modes: [
          { mode: "managed_bridge", integration: "managed_core", setup: ["workspaceId", "deviceLabel"], secrets: ["bridgeApiKey"] },
          { mode: "native_bridge", integration: "native_bridge", setup: ["command", "workingDirectory"], secrets: ["bridgeToken"] },
        ],
      },
      telegram: {
        defaultMode: "managed_bridge",
        modes: [
          { mode: "managed_bridge", integration: "managed_core", setup: ["workspaceId", "botUsername"], secrets: ["bridgeApiKey"] },
          { mode: "webhook", integration: "webhook", setup: ["webhookUrl", "botUsername"], secrets: ["botToken", "webhookSecret"] },
        ],
      },
      slack: {
        defaultMode: "managed_bridge",
        modes: [
          { mode: "managed_bridge", integration: "managed_plugin", setup: ["pluginName", "workspaceId"], secrets: ["bridgeApiKey"] },
          { mode: "webhook", integration: "webhook", setup: ["eventsUrl", "appId"], secrets: ["signingSecret", "botToken"] },
          { mode: "official_api", integration: "official_api", setup: ["appId", "workspaceId", "workspaceName"], secrets: ["signingSecret", "botToken"] },
        ],
      },
      "microsoft-teams": {
        defaultMode: "managed_bridge",
        modes: [
          { mode: "managed_bridge", integration: "managed_plugin", setup: ["pluginName", "tenantId"], secrets: ["bridgeApiKey"] },
          { mode: "webhook", integration: "webhook", setup: ["botEndpointUrl", "tenantId"], secrets: ["botAppPassword", "webhookSecret"] },
        ],
      },
      discord: {
        defaultMode: "webhook",
        modes: [
          { mode: "webhook", integration: "bot_gateway", setup: ["gatewayUrl", "applicationId"], secrets: ["botToken", "webhookSecret"] },
        ],
      },
    });
  });

  it("fails closed for unsupported provider and mode combinations", async () => {
    const { CHAT_CONNECTOR_KINDS, getChatConnectorProfile, getChatConnectorProfileForMode } = await import(
      "../../../../src/domain/chat-connectors/registry.js"
    );

    expect(() => getChatConnectorProfile("unknown" as ChatProviderKind)).toThrow("Unsupported chat provider kind");
    expect(() => getChatConnectorProfileForMode("discord", "managed_bridge")).toThrow(
      "Unsupported bridge mode for discord: managed_bridge",
    );
    for (const kind of CHAT_CONNECTOR_KINDS.filter((candidate) => candidate !== "slack")) {
      expect(() => getChatConnectorProfileForMode(kind, "official_api" as ChatProviderBridgeMode)).toThrow(
        `Unsupported bridge mode for ${kind}: official_api`,
      );
    }
    expect(getChatConnectorProfileForMode("slack", "official_api").kind).toBe("slack");
  });

  it("constructs the registry without network or process side effects", async () => {
    vi.resetModules();
    const fetchSpy = vi.fn();
    const spawnSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.doMock("node:child_process", () => ({ spawn: spawnSpy }));
    const beforeListeners = {
      exit: process.listenerCount("exit"),
      warning: process.listenerCount("warning"),
    };

    const { CHAT_CONNECTOR_REGISTRY } = await import("../../../../src/domain/chat-connectors/registry.js");

    expect(CHAT_CONNECTOR_REGISTRY.profiles).toHaveLength(6);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(spawnSpy).not.toHaveBeenCalled();
    expect(process.listenerCount("exit")).toBe(beforeListeners.exit);
    expect(process.listenerCount("warning")).toBe(beforeListeners.warning);
  });
});
