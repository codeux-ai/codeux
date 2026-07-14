import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { ChatProviderActions } from "../../../src/mcp/management/chat-provider-actions.js";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ChatProviderRepository } from "../../../src/repositories/chat-provider-repository.js";
import { ConnectionChatRepository } from "../../../src/repositories/connection-chat-repository.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import type { ManagementResponseEnvelope } from "../../../src/contracts/internal-management-types.js";
import { createChatProviderSecretFixture } from "../helpers/chat-provider-secret-fixture.js";
import type { ChatProviderSecretService } from "../../../src/services/chat-provider-secret-service.js";
import { ChatProviderVerificationService } from "../../../src/services/chat-provider-verification-service.js";
import { CHAT_CONNECTOR_REGISTRY, createChatConnectorRegistry } from "../../../src/domain/chat-connectors/registry.js";

const tempDirs: string[] = [];
const openStorages: AppDbStorage[] = [];

async function createHarness(): Promise<{
  storage: AppDbStorage;
  projectRepository: ProjectManagementRepository;
  providerRepository: ChatProviderRepository;
  conversationRepository: ConnectionChatRepository;
  actions: ChatProviderActions;
  secretService: ChatProviderSecretService;
  verificationService: ChatProviderVerificationService;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-mcp-chat-providers-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  openStorages.push(storage);
  const providerRepository = new ChatProviderRepository(storage);
  const secretService = createChatProviderSecretFixture(providerRepository);
  const verificationService = new ChatProviderVerificationService({
    chatProviderRepository: providerRepository,
    chatProviderSecretService: secretService,
  });
  return {
    storage,
    projectRepository: new ProjectManagementRepository(storage),
    providerRepository,
    conversationRepository: new ConnectionChatRepository(storage),
    actions: new ChatProviderActions(providerRepository, secretService, { chatProviderVerificationService: verificationService }),
    secretService,
    verificationService,
  };
}

function expectResult(envelope: ManagementResponseEnvelope): Record<string, unknown> {
  expect(envelope.approvalRequired).toBeUndefined();
  expect(envelope.result).toBeTruthy();
  return envelope.result as Record<string, unknown>;
}

afterEach(async () => {
  vi.useRealTimers();
  for (const storage of openStorages.splice(0).reverse()) {
    storage.close();
  }
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("ChatProviderActions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00.000Z"));
  });

  it("lists provider setup definitions with generated ingress guidance", async () => {
    const { actions } = await createHarness();

    const allResult = expectResult(await actions.handleChatProviderAction({
      domain: "chat_providers",
      action: "list_provider_definitions",
      payload: { baseUrl: "https://codeux.example.test/" },
    }));
    expect((allResult.providerDefinitions as Array<{ kind: string }>).map((definition) => definition.kind).sort()).toEqual([
      "discord", "imessage", "microsoft-teams", "slack", "telegram", "whatsapp",
    ]);

    const result = expectResult(await actions.handleChatProviderAction({
      domain: "chat_providers",
      action: "list_provider_definitions",
      payload: { providerKind: "slack", baseUrl: "https://codeux.example.test/" },
    }));

    expect(result.status).toBe("success");
    const definitions = result.providerDefinitions as Array<Record<string, unknown>>;
    expect(definitions).toHaveLength(1);
    expect(definitions[0]).toMatchObject({
      kind: "slack",
      defaultBridgeMode: "managed_bridge",
      setupGuidance: {
        providerKind: "slack",
        ingressUrlTemplate: "https://codeux.example.test/api/chat-providers/ingress/{providerConnectionId}",
      },
    });
    expect(JSON.stringify(definitions[0])).toContain("signingSecret");
  });

  it("creates, lists, gets, and updates redacted provider connections", async () => {
    const { actions, secretService } = await createHarness();

    const createdResult = expectResult(await actions.handleChatProviderAction({
      domain: "chat_providers",
      action: "create_connection",
      payload: {
        providerKind: "telegram",
        displayName: "Telegram bridge",
        bridgeMode: "webhook",
        status: "active",
        setup: {
          webhookUrl: "https://example.test/telegram",
          botToken: "must-not-be-saved-in-setup",
        },
        secrets: {
          botToken: "telegram-secret-value",
        },
      },
    }));
    const connection = createdResult.connection as Record<string, unknown>;

    expect(connection).toMatchObject({
      providerKind: "telegram",
      displayName: "Telegram bridge",
      bridgeMode: "webhook",
      status: "active",
      setup: { webhookUrl: "https://example.test/telegram" },
      ingressUrls: {
        connectionIngressUrl: expect.stringContaining(`/api/chat-providers/ingress/${connection.id as string}`),
      },
    });
    expect(JSON.stringify(createdResult)).not.toContain("telegram-secret-value");
    expect(JSON.stringify(createdResult)).not.toContain("must-not-be-saved-in-setup");
    expect(connection).not.toHaveProperty("secrets");
    expect(connection).toHaveProperty("credentials");
    expect((await secretService.resolveConnection(connection.id as string)).secrets).toEqual({
      botToken: "telegram-secret-value",
    });

    const listResult = expectResult(await actions.handleChatProviderAction({
      domain: "chat_providers",
      action: "list_connections",
      payload: { providerKind: "telegram", enabledOnly: true },
    }));
    expect((listResult.connections as Array<Record<string, unknown>>).map((item) => item.id)).toEqual([connection.id]);

    const getResult = expectResult(await actions.handleChatProviderAction({
      domain: "chat_providers",
      action: "get_connection",
      payload: { connectionId: connection.id },
    }));
    expect((getResult.connection as Record<string, unknown>).id).toBe(connection.id);

    const updatePayload = {
      providerConnectionId: connection.id,
      displayName: "Telegram bridge renamed",
      enabled: false,
      setup: { webhookUrl: "https://example.test/telegram-v2" },
    };
    const updatePreflight = await actions.handleChatProviderAction({
      domain: "chat_providers",
      action: "update_connection",
      payload: updatePayload,
    });
    expect(updatePreflight.approvalRequired).toBe(true);
    const updateResult = expectResult(await actions.handleChatProviderAction({
      domain: "chat_providers",
      action: "update_connection",
      payload: updatePayload,
      approval: { confirmed: true },
    }));
    expect(updateResult.connection).toMatchObject({
      id: connection.id,
      displayName: "Telegram bridge renamed",
      enabled: false,
      setup: { webhookUrl: "https://example.test/telegram-v2" },
    });
    expect((await secretService.resolveConnection(connection.id as string)).secrets).toEqual({
      botToken: "telegram-secret-value",
    });
  });

  it("returns validation failures without exposing secret payloads", async () => {
    const { actions } = await createHarness();

    await expect(actions.handleChatProviderAction({
      domain: "chat_providers",
      action: "create_connection",
      payload: {
        providerKind: "not-a-provider",
        displayName: "Invalid bridge",
        secrets: { botToken: "secret-should-not-appear" },
      },
    })).rejects.toThrow("Invalid value for providerKind");

    await expect(actions.handleChatProviderAction({
      domain: "chat_providers",
      action: "create_connection",
      payload: {
        providerKind: "slack",
        displayName: "Invalid secrets",
        secrets: "secret-should-not-appear",
      },
    })).rejects.not.toThrow("secret-should-not-appear");
  });

  it("requires one-use approval before replacing non-empty secret payloads", async () => {
    const { actions, secretService } = await createHarness();
    const connection = await secretService.createConnection({
      providerKind: "slack",
      displayName: "Slack bridge",
      bridgeMode: "webhook",
      secrets: { signingSecret: "old-secret" },
    });

    const first = await actions.handleChatProviderAction({
      domain: "chat_providers",
      action: "update_connection",
      payload: {
        providerConnectionId: connection.id,
        secrets: { signingSecret: "new-secret" },
      },
    });

    expect(first.approvalRequired).toBe(true);
    expect(JSON.stringify(first)).not.toContain("new-secret");
    expect((await secretService.resolveConnection(connection.id)).secrets).toEqual({ signingSecret: "old-secret" });

    const mismatchedApproval = await actions.handleChatProviderAction({
      domain: "chat_providers",
      action: "update_connection",
      payload: {
        providerConnectionId: connection.id,
        secrets: { signingSecret: "different-secret" },
      },
      approval: { confirmed: true },
    });
    expect(mismatchedApproval.approvalRequired).toBe(true);
    expect((await secretService.resolveConnection(connection.id)).secrets).toEqual({ signingSecret: "old-secret" });

    const approved = expectResult(await actions.handleChatProviderAction({
      domain: "chat_providers",
      action: "update_connection",
      payload: {
        providerConnectionId: connection.id,
        secrets: { signingSecret: "new-secret" },
      },
      approval: { confirmed: true },
    }));

    expect(approved.connection).toMatchObject({ id: connection.id });
    expect(JSON.stringify(approved)).not.toContain("new-secret");
    expect((await secretService.resolveConnection(connection.id)).secrets).toEqual({ signingSecret: "new-secret" });

    const reused = await actions.handleChatProviderAction({
      domain: "chat_providers",
      action: "update_connection",
      payload: {
        providerConnectionId: connection.id,
        secrets: { signingSecret: "new-secret" },
      },
      approval: { confirmed: true },
    });
    expect(reused.approvalRequired).toBe(true);
  });

  it("requires approval before deleting connections and channel bindings", async () => {
    const { actions, projectRepository, providerRepository } = await createHarness();
    const project = projectRepository.createProject({
      name: "Chat Provider Delete Project",
      sourceType: "local",
      sourceRef: "/tmp/chat-provider-delete",
    });
    const connection = providerRepository.createConnection({
      providerKind: "discord",
      displayName: "Discord gateway",
    });
    const binding = providerRepository.createChannelBinding({
      providerConnectionId: connection.id,
      externalChannelId: "ops-channel",
      externalChannelName: "ops",
      projectId: project.id,
    });

    const bindingPreflight = await actions.handleChatProviderAction({
      domain: "chat_providers",
      action: "delete_channel_binding",
      payload: { channelBindingId: binding.id },
    });
    expect(bindingPreflight.approvalRequired).toBe(true);
    expect(providerRepository.getChannelBinding(binding.id)).toBeTruthy();

    const bindingDelete = expectResult(await actions.handleChatProviderAction({
      domain: "chat_providers",
      action: "delete_channel_binding",
      payload: { channelBindingId: binding.id },
      approval: { confirmed: true },
    }));
    expect(bindingDelete.deleted).toBe(true);
    expect(providerRepository.getChannelBinding(binding.id)).toBeNull();

    const connectionPreflight = await actions.handleChatProviderAction({
      domain: "chat_providers",
      action: "delete_connection",
      payload: { providerConnectionId: connection.id },
    });
    expect(connectionPreflight.approvalRequired).toBe(true);
    expect(providerRepository.getConnection(connection.id)).toBeTruthy();

    const connectionDelete = expectResult(await actions.handleChatProviderAction({
      domain: "chat_providers",
      action: "delete_connection",
      payload: { providerConnectionId: connection.id },
      approval: { confirmed: true },
    }));
    expect(connectionDelete.deleted).toBe(true);
    expect(providerRepository.getConnection(connection.id)).toBeNull();
  });

  it("supports channel binding management and multi-project bindings to one external channel", async () => {
    const { actions, projectRepository, providerRepository } = await createHarness();
    const projectA = projectRepository.createProject({
      name: "Chat Binding Project A",
      sourceType: "local",
      sourceRef: "/tmp/chat-binding-project-a",
    });
    const projectB = projectRepository.createProject({
      name: "Chat Binding Project B",
      sourceType: "local",
      sourceRef: "/tmp/chat-binding-project-b",
    });
    const connection = providerRepository.createConnection({
      providerKind: "slack",
      displayName: "Slack bridge",
    });

    const bindingAResult = expectResult(await actions.handleChatProviderAction({
      domain: "chat_providers",
      action: "create_channel_binding",
      payload: {
        providerConnectionId: connection.id,
        externalChannelId: "shared-channel",
        externalChannelName: "incidents",
        externalChannelMetadata: { workspace: "test" },
        projectId: projectA.id,
        routingHints: { priority: "high" },
      },
    }));
    const bindingBResult = expectResult(await actions.handleChatProviderAction({
      domain: "chat_providers",
      action: "create_channel_binding",
      payload: {
        providerConnectionId: connection.id,
        externalChannelId: "shared-channel",
        externalChannelName: "incidents",
        projectId: projectB.id,
      },
    }));
    const bindingA = bindingAResult.channelBinding as Record<string, unknown>;
    const bindingB = bindingBResult.channelBinding as Record<string, unknown>;

    expect(bindingA).toMatchObject({
      externalChannelId: "shared-channel",
      projectId: projectA.id,
      suppressRichWidgets: true,
      ingressUrls: {
        channelIngressUrl: expect.stringContaining(`/api/chat-providers/ingress/${connection.id}`),
      },
    });
    expect(bindingB).toMatchObject({
      externalChannelId: "shared-channel",
      projectId: projectB.id,
    });

    const listResult = expectResult(await actions.handleChatProviderAction({
      domain: "chat_providers",
      action: "list_channel_bindings",
      payload: {
        externalChannelId: "shared-channel",
        projectIds: [projectA.id, projectB.id],
      },
    }));
    expect((listResult.channelBindings as Array<Record<string, unknown>>).map((binding) => binding.id).sort()).toEqual(
      [bindingA.id, bindingB.id].sort(),
    );

    const updated = expectResult(await actions.handleChatProviderAction({
      domain: "chat_providers",
      action: "update_channel_binding",
      payload: {
        bindingId: bindingA.id,
        inboundEnabled: false,
        outboundEnabled: true,
        routingHints: { priority: "normal" },
      },
    }));
    expect(updated.channelBinding).toMatchObject({
      id: bindingA.id,
      inboundEnabled: false,
      outboundEnabled: true,
      routingHints: { priority: "normal" },
    });
  });

  it("lists pending outbound delivery records for delivery-state inspection", async () => {
    const { actions, projectRepository, providerRepository, conversationRepository } = await createHarness();
    const project = projectRepository.createProject({
      name: "Delivery State Project",
      sourceType: "local",
      sourceRef: "/tmp/delivery-state",
    });
    const connection = providerRepository.createConnection({
      providerKind: "whatsapp",
      displayName: "WhatsApp bridge",
      bridgeMode: "webhook",
    });
    const binding = providerRepository.createChannelBinding({
      providerConnectionId: connection.id,
      externalChannelId: "delivery-channel",
      externalChannelName: "Delivery",
      projectId: project.id,
    });
    const message = conversationRepository.postDashboardMessage(project.id, {
      title: "Delivery state",
      bodyMarkdown: "hello",
    });
    const pending = providerRepository.upsertOutboundDelivery({
      providerConnectionId: connection.id,
      channelBindingId: binding.id,
      externalChannelId: "delivery-channel",
      conversationThreadId: message.threadId,
      conversationMessageId: message.id,
      payload: { bodyMarkdown: "hello" },
    });
    const otherMessage = conversationRepository.postDashboardMessage(project.id, {
      title: "Other delivery state",
      bodyMarkdown: "hello again",
    });
    providerRepository.upsertOutboundDelivery({
      providerConnectionId: connection.id,
      channelBindingId: binding.id,
      externalChannelId: "other-channel",
      conversationThreadId: otherMessage.threadId,
      conversationMessageId: otherMessage.id,
      status: "sending",
    });

    const result = expectResult(await actions.handleChatProviderAction({
      domain: "chat_providers",
      action: "list_outbound_deliveries",
      payload: {
        providerConnectionId: connection.id,
        externalChannelId: "delivery-channel",
        deliveryStatus: "pending",
        limit: "20",
      },
    }));

    expect(result.deliveries).toEqual([
      expect.objectContaining({
        id: pending.id,
        providerConnectionId: connection.id,
        channelBindingId: binding.id,
        externalChannelId: "delivery-channel",
        conversationMessageId: message.id,
        direction: "outbound",
        status: "pending",
      }),
    ]);
    expect(JSON.stringify(result.deliveries)).not.toContain("bodyMarkdown");

    providerRepository.updateDeliveryState(pending.id, {
      status: "delivered",
      externalMessageId: "provider-message-1",
    });

    const deliveredResult = expectResult(await actions.handleChatProviderAction({
      domain: "chat_providers",
      action: "list_outbound_deliveries",
      payload: {
        providerConnectionId: connection.id,
        deliveryStatus: "delivered",
      },
    }));

    expect(deliveredResult.deliveries).toEqual([
      expect.objectContaining({
        id: pending.id,
        externalMessageId: "provider-message-1",
        status: "delivered",
      }),
    ]);
  });

  it("verifies a configured connection and returns redacted health diagnostics", async () => {
    const { actions, secretService } = await createHarness();
    const connection = await secretService.createConnection({
      providerKind: "discord",
      displayName: "Discord verification",
      bridgeMode: "webhook",
      secrets: { botToken: "discord-secret-token" },
    });

    const verified = expectResult(await actions.handleChatProviderAction({
      domain: "chat_providers",
      action: "verify_connection",
      payload: { providerConnectionId: connection.id },
    }));
    expect(verified.verification).toMatchObject({
      status: "verified",
      capabilities: ["setup", "authentication", "outbound"],
      providerErrorCode: null,
      retryable: false,
    });

    const health = expectResult(await actions.handleChatProviderAction({
      domain: "chat_providers",
      action: "get_health",
      payload: {},
    }));
    expect(health.health).toMatchObject({ configuredCount: 1, verifiedCount: 1, errorCount: 0 });
    expect(JSON.stringify({ verified, health })).not.toContain("discord-secret-token");
  });

  it("runs the read-only WhatsApp provider request through MCP and redacts failures", async () => {
    const accessToken = "mcp-meta-access-token-that-must-stay-private";
    const phoneNumberId = "109876543210987";
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error(
      `Meta request failed for ${accessToken} at https://graph.facebook.com/private?token=${accessToken}`,
    ));
    const { providerRepository, secretService } = await createHarness();
    const verificationService = new ChatProviderVerificationService({
      chatProviderRepository: providerRepository,
      chatProviderSecretService: secretService,
      fetchImplementation: fetchMock,
    });
    const actions = new ChatProviderActions(providerRepository, secretService, {
      chatProviderVerificationService: verificationService,
    });
    const connection = await secretService.createConnection({
      providerKind: "whatsapp",
      displayName: "WhatsApp MCP verification",
      bridgeMode: "official_api",
      setup: { graphApiVersion: "v23.0", phoneNumberId },
      secrets: {
        accessToken,
        appSecret: "mcp-meta-app-secret",
        webhookVerifyToken: "mcp-meta-webhook-token",
      },
    });

    const result = expectResult(await actions.handleChatProviderAction({
      domain: "chat_providers",
      action: "verify_connection",
      payload: { providerConnectionId: connection.id },
    }));

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `https://graph.facebook.com/v23.0/${phoneNumberId}?fields=id,display_phone_number,verified_name,quality_rating`,
    );
    expect(init).toMatchObject({ method: "GET", headers: { authorization: `Bearer ${accessToken}` } });
    expect(init).not.toHaveProperty("body");
    expect(result.verification).toMatchObject({
      providerKind: "whatsapp",
      status: "failed",
      providerErrorCode: "provider_verification_failed",
      retryable: true,
      setupGuidance: { liveVerificationAvailable: true },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(accessToken);
    expect(serialized).not.toContain("graph.facebook.com/private");
    expect(serialized).not.toContain("authorization");
  });

  it("reports verification timeouts without serializing credentials", async () => {
    const { providerRepository, secretService } = await createHarness();
    const discord = CHAT_CONNECTOR_REGISTRY.get("discord");
    const registry = createChatConnectorRegistry(CHAT_CONNECTOR_REGISTRY.profiles.map((profile) => profile.kind === "discord"
      ? {
        ...discord,
        verification: {
          ...discord.verification,
          strategy: "configuration_and_live" as const,
          verifyLive: () => new Promise(() => undefined),
        },
        liveTest: { available: true, modes: ["webhook"] as const },
      }
      : profile));
    const verificationService = new ChatProviderVerificationService({
      chatProviderRepository: providerRepository,
      chatProviderSecretService: secretService,
      connectorRegistry: registry,
      timeoutMs: 25,
    });
    const actions = new ChatProviderActions(providerRepository, secretService, {
      chatProviderVerificationService: verificationService,
      connectorRegistry: registry,
    });
    const connection = await secretService.createConnection({
      providerKind: "discord",
      displayName: "Timeout verification",
      secrets: { botToken: "timeout-secret-token" },
    });

    const verificationPromise = actions.handleChatProviderAction({
      domain: "chat_providers",
      action: "verify_connection",
      payload: { providerConnectionId: connection.id },
    });
    await vi.advanceTimersByTimeAsync(30);
    const result = expectResult(await verificationPromise);
    expect(result.verification).toMatchObject({
      status: "failed",
      providerErrorCode: "verification_timeout",
      retryable: true,
    });
    expect(JSON.stringify(result)).not.toContain("timeout-secret-token");
  });

  it("returns provider failure codes while removing sensitive diagnostics", async () => {
    const { providerRepository, secretService } = await createHarness();
    const discord = CHAT_CONNECTOR_REGISTRY.get("discord");
    const registry = createChatConnectorRegistry(CHAT_CONNECTOR_REGISTRY.profiles.map((profile) => profile.kind === "discord"
      ? {
        ...discord,
        verification: {
          ...discord.verification,
          strategy: "configuration_and_live" as const,
          verifyLive: async () => ({
            valid: false,
            issues: ["Provider rejected provider-secret-token at https://provider.example.test/private-check."],
            providerErrorCode: "invalid_bot_identity",
            retryable: false,
            diagnostics: {
              capability: "authentication",
              message: "Provider echoed provider-secret-token at https://provider.example.test/private-check.",
              authorization: "Bearer provider-secret-token",
              signedUrl: "https://provider.example.test/check?signature=provider-secret-token",
            },
          }),
        },
        liveTest: { available: true, modes: ["webhook"] as const },
      }
      : profile));
    const verificationService = new ChatProviderVerificationService({
      chatProviderRepository: providerRepository,
      chatProviderSecretService: secretService,
      connectorRegistry: registry,
    });
    const actions = new ChatProviderActions(providerRepository, secretService, {
      chatProviderVerificationService: verificationService,
      connectorRegistry: registry,
    });
    const connection = await secretService.createConnection({
      providerKind: "discord",
      displayName: "Provider failure",
      bridgeMode: "webhook",
      secrets: { botToken: "provider-secret-token" },
    });

    const result = expectResult(await actions.handleChatProviderAction({
      domain: "chat_providers",
      action: "verify_connection",
      payload: { providerConnectionId: connection.id },
    }));

    expect(result.verification).toMatchObject({
      status: "failed",
      providerErrorCode: "invalid_bot_identity",
      retryable: false,
      diagnostics: {
        capability: "authentication",
        message: "Provider echoed [REDACTED] at [REDACTED_URL]",
      },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("provider-secret-token");
    expect(serialized).not.toContain("authorization");
    expect(serialized).not.toContain("signedUrl");
  });

  it("rejects MCP credential, endpoint, command, and verification mutations when credential administration is disabled", async () => {
    const { providerRepository, secretService, verificationService } = await createHarness();
    const actions = new ChatProviderActions(providerRepository, secretService, {
      chatProviderVerificationService: verificationService,
      allowCredentialMutation: () => false,
    });
    const connection = await secretService.createConnection({
      providerKind: "slack",
      displayName: "Credential authorization",
      bridgeMode: "webhook",
      setup: { eventsUrl: "https://provider.example.test/events" },
      secrets: { signingSecret: "existing-signing-secret" },
    });
    const commandConnection = providerRepository.createConnection({
      providerKind: "imessage",
      displayName: "Command authorization",
      bridgeMode: "native_bridge",
      setup: { command: "/usr/local/bin/existing-bridge" },
    });

    await expect(actions.handleChatProviderAction({
      domain: "chat_providers",
      action: "create_connection",
      payload: {
        providerKind: "slack",
        displayName: "Denied credential",
        secrets: { bridgeApiKey: "denied-secret" },
      },
    })).rejects.toThrow(/credential administration is disabled/i);
    await expect(actions.handleChatProviderAction({
      domain: "chat_providers",
      action: "update_connection",
      payload: {
        providerConnectionId: connection.id,
        setup: { eventsUrl: "https://provider.example.test/new-events" },
      },
    })).rejects.toThrow(/credential administration is disabled/i);
    await expect(actions.handleChatProviderAction({
      domain: "chat_providers",
      action: "update_connection",
      payload: {
        providerConnectionId: commandConnection.id,
        setup: { command: "/usr/local/bin/new-bridge" },
      },
    })).rejects.toThrow(/credential administration is disabled/i);
    await expect(actions.handleChatProviderAction({
      domain: "chat_providers",
      action: "verify_connection",
      payload: { providerConnectionId: connection.id },
    })).rejects.toThrow(/credential administration is disabled/i);
  });

  it("compares persisted URL and command setup before requiring exact one-use approval", async () => {
    const { providerRepository, secretService, verificationService } = await createHarness();
    const endpointConnection = providerRepository.createConnection({
      providerKind: "slack",
      displayName: "Endpoint mutation",
      bridgeMode: "webhook",
      setup: { eventsUrl: "https://provider.example.test/events" },
    });
    const commandConnection = providerRepository.createConnection({
      providerKind: "imessage",
      displayName: "Command mutation",
      bridgeMode: "native_bridge",
      setup: { command: "/usr/local/bin/existing-bridge" },
    });
    const deniedActions = new ChatProviderActions(providerRepository, secretService, {
      chatProviderVerificationService: verificationService,
      allowCredentialMutation: () => false,
    });

    for (const [providerConnectionId, setup] of [
      [endpointConnection.id, {}],
      [endpointConnection.id, { eventsUrl: "https://provider.example.test/replacement" }],
      [commandConnection.id, {}],
      [commandConnection.id, { command: "/usr/local/bin/replacement-bridge" }],
    ] as const) {
      await expect(deniedActions.handleChatProviderAction({
        domain: "chat_providers",
        action: "update_connection",
        payload: { providerConnectionId, setup },
      })).rejects.toThrow(/credential administration is disabled/i);
    }

    const actions = new ChatProviderActions(providerRepository, secretService, {
      chatProviderVerificationService: verificationService,
    });
    const clearPayload = { providerConnectionId: endpointConnection.id, setup: {} };
    const clearPreflight = await actions.handleChatProviderAction({
      domain: "chat_providers",
      action: "update_connection",
      payload: clearPayload,
    });
    expect(clearPreflight.approvalRequired).toBe(true);
    expectResult(await actions.handleChatProviderAction({
      domain: "chat_providers",
      action: "update_connection",
      payload: clearPayload,
      approval: { confirmed: true },
    }));
    expect(providerRepository.getConnection(endpointConnection.id)?.setup).toEqual({});

    const replacementPayload = {
      providerConnectionId: commandConnection.id,
      setup: { command: "/usr/local/bin/replacement-bridge" },
    };
    const replacementPreflight = await actions.handleChatProviderAction({
      domain: "chat_providers",
      action: "update_connection",
      payload: replacementPayload,
    });
    expect(replacementPreflight.approvalRequired).toBe(true);
    const mismatched = await actions.handleChatProviderAction({
      domain: "chat_providers",
      action: "update_connection",
      payload: {
        providerConnectionId: commandConnection.id,
        setup: { command: "/usr/local/bin/different-bridge" },
      },
      approval: { confirmed: true },
    });
    expect(mismatched.approvalRequired).toBe(true);
    expect(providerRepository.getConnection(commandConnection.id)?.setup).toEqual({
      command: "/usr/local/bin/existing-bridge",
    });
    expectResult(await actions.handleChatProviderAction({
      domain: "chat_providers",
      action: "update_connection",
      payload: replacementPayload,
      approval: { confirmed: true },
    }));
    expect(providerRepository.getConnection(commandConnection.id)?.setup).toEqual({
      command: "/usr/local/bin/replacement-bridge",
    });

    providerRepository.updateConnection(commandConnection.id, {
      setup: { command: "/usr/local/bin/existing-bridge" },
    });
    const reused = await actions.handleChatProviderAction({
      domain: "chat_providers",
      action: "update_connection",
      payload: replacementPayload,
      approval: { confirmed: true },
    });
    expect(reused.approvalRequired).toBe(true);
    expect(providerRepository.getConnection(commandConnection.id)?.setup).toEqual({
      command: "/usr/local/bin/existing-bridge",
    });
  });

  it("enforces persisted project ownership and one-use delivery retry approval", async () => {
    const { projectRepository, providerRepository, conversationRepository, secretService, verificationService } = await createHarness();
    const allowed = projectRepository.createProject({ name: "Allowed", sourceType: "local", sourceRef: "/tmp/allowed" });
    const denied = projectRepository.createProject({ name: "Denied", sourceType: "local", sourceRef: "/tmp/denied" });
    const connection = providerRepository.createConnection({ providerKind: "discord", displayName: "Scoped" });
    const deniedBinding = providerRepository.createChannelBinding({
      providerConnectionId: connection.id,
      externalChannelId: "denied-channel",
      externalChannelName: "Denied",
      projectId: denied.id,
    });
    const message = conversationRepository.postDashboardMessage(denied.id, {
      title: "Scoped delivery",
      bodyMarkdown: "must stay private",
    });
    const delivery = providerRepository.upsertOutboundDelivery({
      providerConnectionId: connection.id,
      channelBindingId: deniedBinding.id,
      externalChannelId: "denied-channel",
      conversationThreadId: message.threadId,
      conversationMessageId: message.id,
      payload: { bodyMarkdown: "must stay private" },
    });
    const retryDelivery = vi.fn(async () => providerRepository.updateDeliveryState(delivery.id, { status: "pending" }));
    const scopedActions = new ChatProviderActions(providerRepository, secretService, {
      chatProviderVerificationService: verificationService,
      chatProviderOutboundService: { retryDelivery } as any,
      authorizeProject: (projectId) => projectId === allowed.id,
    });

    await expect(scopedActions.handleChatProviderAction({
      domain: "chat_providers",
      action: "update_channel_binding",
      payload: { channelBindingId: deniedBinding.id, externalChannelName: "Unauthorized" },
    })).rejects.toThrow(/not authorized/i);

    const hidden = expectResult(await scopedActions.handleChatProviderAction({
      domain: "chat_providers",
      action: "list_deliveries",
      payload: { projectId: allowed.id },
    }));
    expect(hidden.deliveries).toEqual([]);

    const unrestrictedActions = new ChatProviderActions(providerRepository, secretService, {
      chatProviderVerificationService: verificationService,
      chatProviderOutboundService: { retryDelivery } as any,
    });
    const preflight = await unrestrictedActions.handleChatProviderAction({
      domain: "chat_providers",
      action: "retry_delivery",
      payload: { deliveryId: delivery.id },
    });
    expect(preflight.approvalRequired).toBe(true);
    const retried = expectResult(await unrestrictedActions.handleChatProviderAction({
      domain: "chat_providers",
      action: "retry_delivery",
      payload: { deliveryId: delivery.id },
      approval: { confirmed: true },
    }));
    expect(retried.delivery).not.toHaveProperty("payload");
    expect(retryDelivery).toHaveBeenCalledTimes(1);
    const reused = await unrestrictedActions.handleChatProviderAction({
      domain: "chat_providers",
      action: "retry_delivery",
      payload: { deliveryId: delivery.id },
      approval: { confirmed: true },
    });
    expect(reused.approvalRequired).toBe(true);
    expect(retryDelivery).toHaveBeenCalledTimes(1);
  });
});
