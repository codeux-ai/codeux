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

const tempDirs: string[] = [];
const openStorages: AppDbStorage[] = [];

async function createHarness(): Promise<{
  storage: AppDbStorage;
  projectRepository: ProjectManagementRepository;
  providerRepository: ChatProviderRepository;
  conversationRepository: ConnectionChatRepository;
  actions: ChatProviderActions;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-mcp-chat-providers-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  openStorages.push(storage);
  const providerRepository = new ChatProviderRepository(storage);
  return {
    storage,
    projectRepository: new ProjectManagementRepository(storage),
    providerRepository,
    conversationRepository: new ConnectionChatRepository(storage),
    actions: new ChatProviderActions(providerRepository),
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
        ingressUrlTemplate: "https://codeux.example.test/api/chat-providers/{providerConnectionId}/channels/{externalChannelId}/ingress",
      },
    });
    expect(JSON.stringify(definitions[0])).toContain("signingSecret");
  });

  it("creates, lists, gets, and updates redacted provider connections", async () => {
    const { actions, providerRepository } = await createHarness();

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
        connectionIngressUrl: expect.stringContaining(`/api/chat-providers/${connection.id as string}/ingress`),
      },
    });
    expect(JSON.stringify(createdResult)).not.toContain("telegram-secret-value");
    expect(JSON.stringify(createdResult)).not.toContain("must-not-be-saved-in-setup");
    expect(connection).not.toHaveProperty("secrets");
    expect(connection).toHaveProperty("credentials");
    expect(providerRepository.getConnectionInternal(connection.id as string)?.secrets).toEqual({
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

    const updateResult = expectResult(await actions.handleChatProviderAction({
      domain: "chat_providers",
      action: "update_connection",
      payload: {
        providerConnectionId: connection.id,
        displayName: "Telegram bridge renamed",
        enabled: false,
        setup: { webhookUrl: "https://example.test/telegram-v2" },
      },
    }));
    expect(updateResult.connection).toMatchObject({
      id: connection.id,
      displayName: "Telegram bridge renamed",
      enabled: false,
      setup: { webhookUrl: "https://example.test/telegram-v2" },
    });
    expect(providerRepository.getConnectionInternal(connection.id as string)?.secrets).toEqual({
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
    const { actions, providerRepository } = await createHarness();
    const connection = providerRepository.createConnection({
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
    expect(providerRepository.getConnectionInternal(connection.id)?.secrets).toEqual({ signingSecret: "old-secret" });

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
    expect(providerRepository.getConnectionInternal(connection.id)?.secrets).toEqual({ signingSecret: "new-secret" });
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
        channelIngressUrl: expect.stringContaining("/channels/shared-channel/ingress"),
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
});
