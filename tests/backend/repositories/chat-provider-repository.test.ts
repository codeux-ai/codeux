import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ChatProviderRepository } from "../../../src/repositories/chat-provider-repository.js";
import { ConnectionChatRepository } from "../../../src/repositories/connection-chat-repository.js";
import { ensureChatProviderTables } from "../../../src/repositories/db/app-db-migrations.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";

const tempDirs: string[] = [];
const openStorages: AppDbStorage[] = [];

async function createRepositories(): Promise<{
  storage: AppDbStorage;
  projectRepository: ProjectManagementRepository;
  providerRepository: ChatProviderRepository;
  conversationRepository: ConnectionChatRepository;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-chat-provider-repo-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  openStorages.push(storage);
  return {
    storage,
    projectRepository: new ProjectManagementRepository(storage),
    providerRepository: new ChatProviderRepository(storage),
    conversationRepository: new ConnectionChatRepository(storage),
  };
}

afterEach(async () => {
  vi.useRealTimers();
  for (const storage of openStorages.splice(0).reverse()) {
    storage.close();
  }
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("ChatProviderRepository", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T12:00:00.000Z"));
  });

  it("creates connections from setup schemas and redacts public credentials", async () => {
    const { providerRepository } = await createRepositories();

    const schemas = providerRepository.getSetupSchemas();
    expect(schemas.map((schema) => schema.kind)).toEqual([
      "whatsapp",
      "imessage",
      "telegram",
      "slack",
      "microsoft-teams",
      "discord",
    ]);
    expect(schemas.find((schema) => schema.kind === "imessage")?.bridgeModes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          mode: "native_bridge",
          integration: "native_bridge",
          setupFields: expect.arrayContaining([expect.objectContaining({ key: "command", type: "command" })]),
        }),
      ]),
    );
    expect(schemas.find((schema) => schema.kind === "discord")?.bridgeModes[0]).toMatchObject({
      integration: "bot_gateway",
    });

    const connection = providerRepository.createConnection({
      providerKind: "slack",
      displayName: "Slack bridge",
      bridgeMode: "webhook",
      status: "active",
      setup: {
        eventsUrl: "https://example.test/slack/events",
        signingSecret: "must-not-be-stored-in-setup",
      },
      secrets: {
        signingSecret: "secret-signing-value",
        botToken: "xoxb-secret",
      },
    });

    expect(connection).toMatchObject({
      providerKind: "slack",
      bridgeMode: "webhook",
      status: "active",
      enabled: true,
      setup: { eventsUrl: "https://example.test/slack/events" },
    });
    expect(connection.setup).not.toHaveProperty("signingSecret");
    expect(JSON.stringify(connection)).not.toContain("secret-signing-value");
    expect(JSON.stringify(connection)).not.toContain("xoxb-secret");
    expect(connection.credentials).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "signingSecret",
          configured: true,
          redactedValue: "********",
        }),
        expect.objectContaining({
          key: "botToken",
          configured: true,
          redactedValue: "********",
        }),
      ]),
    );

    const internal = providerRepository.getConnectionInternal(connection.id);
    expect(internal?.secrets).toMatchObject({
      signingSecret: "secret-signing-value",
      botToken: "xoxb-secret",
    });
  });

  it("preserves secrets when updates omit them and clears them only when requested", async () => {
    const { providerRepository } = await createRepositories();
    const connection = providerRepository.createConnection({
      providerKind: "telegram",
      displayName: "Telegram bridge",
      bridgeMode: "webhook",
      secrets: { botToken: "telegram-secret" },
      setup: { webhookUrl: "https://example.test/telegram" },
    });

    const updated = providerRepository.updateConnection(connection.id, {
      displayName: "Telegram bridge renamed",
      setup: { webhookUrl: "https://example.test/telegram-v2", botToken: "setup-secret" },
    });

    expect(updated.displayName).toBe("Telegram bridge renamed");
    expect(updated.setup).toEqual({ webhookUrl: "https://example.test/telegram-v2" });
    expect(providerRepository.getConnectionInternal(connection.id)?.secrets).toEqual({
      botToken: "telegram-secret",
    });

    providerRepository.updateConnection(connection.id, { secrets: null });

    const redacted = providerRepository.getConnection(connection.id);
    expect(providerRepository.getConnectionInternal(connection.id)?.secrets).toBeNull();
    expect(redacted?.credentials).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "botToken", configured: false, redactedValue: null }),
      ]),
    );
  });

  it("supports same-channel multi-project bindings and multi-channel single-project bindings", async () => {
    const { projectRepository, providerRepository } = await createRepositories();
    const projectA = projectRepository.createProject({
      name: "Chat Binding Project A",
      sourceType: "local",
      sourceRef: "/tmp/chat-binding-a",
    });
    const projectB = projectRepository.createProject({
      name: "Chat Binding Project B",
      sourceType: "local",
      sourceRef: "/tmp/chat-binding-b",
    });
    const connection = providerRepository.createConnection({
      providerKind: "discord",
      displayName: "Discord gateway",
      bridgeMode: "webhook",
    });

    const channelA = providerRepository.createChannelBinding({
      providerConnectionId: connection.id,
      externalChannelId: "external-channel-1",
      externalChannelName: "incidents",
      externalChannelMetadata: { team: "platform" },
      projectId: projectA.id,
      routingHints: { priority: "high" },
    });
    const channelB = providerRepository.createChannelBinding({
      providerConnectionId: connection.id,
      externalChannelId: "external-channel-1",
      externalChannelName: "incidents",
      projectId: projectB.id,
    });
    const channelC = providerRepository.createChannelBinding({
      providerConnectionId: connection.id,
      externalChannelId: "external-channel-2",
      externalChannelName: "qa",
      projectId: projectA.id,
      suppressRichWidgets: false,
    });

    expect(channelA.suppressRichWidgets).toBe(true);
    expect(channelC.suppressRichWidgets).toBe(false);
    expect(providerRepository.listChannelBindings({ externalChannelId: "external-channel-1" }).map((binding) => binding.id).sort()).toEqual(
      [channelA.id, channelB.id].sort(),
    );
    expect(providerRepository.listChannelBindings({ projectId: projectA.id }).map((binding) => binding.id).sort()).toEqual(
      [channelA.id, channelC.id].sort(),
    );

    const updated = providerRepository.updateChannelBinding(channelA.id, {
      inboundEnabled: false,
      outboundEnabled: true,
      routingHints: { priority: "normal", labels: ["ops"] },
    });

    expect(updated).toMatchObject({
      inboundEnabled: false,
      outboundEnabled: true,
      routingHints: { priority: "normal", labels: ["ops"] },
    });
  });

  it("detects duplicate inbound external messages by provider connection and message id", async () => {
    const { projectRepository, providerRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Inbound Idempotency Project",
      sourceType: "local",
      sourceRef: "/tmp/inbound-idempotency",
    });
    const connection = providerRepository.createConnection({
      providerKind: "whatsapp",
      displayName: "WhatsApp webhook",
      bridgeMode: "webhook",
    });
    const binding = providerRepository.createChannelBinding({
      providerConnectionId: connection.id,
      externalChannelId: "wa-channel",
      externalChannelName: "WhatsApp Ops",
      projectId: project.id,
    });

    const first = providerRepository.recordInboundMessage({
      providerConnectionId: connection.id,
      channelBindingId: binding.id,
      externalChannelId: "wa-channel",
      externalMessageId: "external-message-1",
      payload: { text: "hello" },
    });
    const duplicate = providerRepository.recordInboundMessage({
      providerConnectionId: connection.id,
      channelBindingId: binding.id,
      externalChannelId: "wa-channel",
      externalMessageId: "external-message-1",
      payload: { text: "changed" },
    });

    expect(first.duplicate).toBe(false);
    expect(first.delivery.status).toBe("processed");
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.delivery.id).toBe(first.delivery.id);
    expect(duplicate.delivery.payload).toEqual({ text: "hello" });
    expect(providerRepository.findInboundDelivery(connection.id, "external-message-1")?.id).toBe(first.delivery.id);
  });

  it("upserts outbound delivery state and lists pending deliveries", async () => {
    const { projectRepository, providerRepository, conversationRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Outbound Delivery Project",
      sourceType: "local",
      sourceRef: "/tmp/outbound-delivery",
    });
    const conversationMessage = conversationRepository.postDashboardMessage(project.id, {
      title: "Send outbound",
      bodyMarkdown: "Please send this message.",
    });
    const thread = conversationRepository.getThread(conversationMessage.threadId);
    const connection = providerRepository.createConnection({
      providerKind: "microsoft-teams",
      displayName: "Teams bot",
      bridgeMode: "webhook",
    });
    const binding = providerRepository.createChannelBinding({
      providerConnectionId: connection.id,
      externalChannelId: "teams-channel",
      externalChannelName: "Team Channel",
      projectId: project.id,
    });

    const pending = providerRepository.upsertOutboundDelivery({
      providerConnectionId: connection.id,
      channelBindingId: binding.id,
      externalChannelId: "teams-channel",
      conversationThreadId: thread.id,
      conversationMessageId: conversationMessage.id,
      payload: { markdown: conversationMessage.bodyMarkdown },
    });

    expect(pending).toMatchObject({
      direction: "outbound",
      status: "pending",
      attemptCount: 0,
      conversationMessageId: conversationMessage.id,
    });
    expect(providerRepository.listPendingOutboundDeliveries()).toHaveLength(1);

    const sending = providerRepository.updateDeliveryState(pending.id, {
      status: "sending",
      attemptCount: 1,
      lastError: "rate limited",
    });
    expect(sending).toMatchObject({
      status: "sending",
      attemptCount: 1,
      lastError: "rate limited",
    });

    const delivered = providerRepository.upsertOutboundDelivery({
      providerConnectionId: connection.id,
      channelBindingId: binding.id,
      externalChannelId: "teams-channel",
      externalMessageId: "teams-message-1",
      conversationThreadId: thread.id,
      conversationMessageId: conversationMessage.id,
      status: "delivered",
      attemptCount: 2,
      lastError: null,
      payload: { markdown: conversationMessage.bodyMarkdown, delivered: true },
    });

    expect(delivered.id).toBe(pending.id);
    expect(delivered).toMatchObject({
      status: "delivered",
      attemptCount: 2,
      lastError: null,
      externalMessageId: "teams-message-1",
      payload: { markdown: conversationMessage.bodyMarkdown, delivered: true },
    });
    expect(providerRepository.listPendingOutboundDeliveries()).toEqual([]);
  });

  it("deletes bindings directly and cascades bindings plus deliveries when a provider is deleted", async () => {
    const { projectRepository, providerRepository, conversationRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Provider Delete Project",
      sourceType: "local",
      sourceRef: "/tmp/provider-delete",
    });
    const conversationMessage = conversationRepository.postDashboardMessage(project.id, {
      title: "Cascade outbound",
      bodyMarkdown: "Cascade this message.",
    });
    const connection = providerRepository.createConnection({
      providerKind: "imessage",
      displayName: "iMessage native",
      bridgeMode: "native_bridge",
    });
    const deletedBinding = providerRepository.createChannelBinding({
      providerConnectionId: connection.id,
      externalChannelId: "imessage-deleted",
      externalChannelName: "Deleted Chat",
      projectId: project.id,
    });
    expect(providerRepository.deleteChannelBinding(deletedBinding.id)).toBe(true);
    expect(providerRepository.getChannelBinding(deletedBinding.id)).toBeNull();

    const binding = providerRepository.createChannelBinding({
      providerConnectionId: connection.id,
      externalChannelId: "imessage-live",
      externalChannelName: "Live Chat",
      projectId: project.id,
    });
    const inbound = providerRepository.recordInboundMessage({
      providerConnectionId: connection.id,
      channelBindingId: binding.id,
      externalChannelId: "imessage-live",
      externalMessageId: "imessage-inbound-1",
    });
    const outbound = providerRepository.upsertOutboundDelivery({
      providerConnectionId: connection.id,
      channelBindingId: binding.id,
      externalChannelId: "imessage-live",
      conversationMessageId: conversationMessage.id,
    });

    expect(providerRepository.deleteConnection(connection.id)).toBe(true);
    expect(providerRepository.getConnection(connection.id)).toBeNull();
    expect(providerRepository.listChannelBindings({ providerConnectionId: connection.id })).toEqual([]);
    expect(providerRepository.getDelivery(inbound.delivery.id)).toBeNull();
    expect(providerRepository.getDelivery(outbound.id)).toBeNull();
  });

  it("creates chat provider migration tables and indexes idempotently", async () => {
    const { storage } = await createRepositories();
    const db = storage.getDatabase();

    ensureChatProviderTables(db);
    ensureChatProviderTables(db);

    const tableRows = db.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name IN (
          'chat_provider_connections',
          'chat_provider_channel_bindings',
          'chat_provider_message_deliveries'
        )
      ORDER BY name ASC
    `).all() as Array<{ name: string }>;
    expect(tableRows.map((row) => row.name)).toEqual([
      "chat_provider_channel_bindings",
      "chat_provider_connections",
      "chat_provider_message_deliveries",
    ]);

    const indexNames = [
      "idx_chat_provider_connections_kind",
      "idx_chat_provider_connections_enabled",
      "idx_chat_provider_channel_bindings_project",
      "idx_chat_provider_channel_bindings_provider_channel",
      "idx_chat_provider_message_deliveries_inbound_dedupe",
      "idx_chat_provider_message_deliveries_pending_outbound",
    ];
    for (const indexName of indexNames) {
      const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?").get(indexName) as { name: string } | undefined;
      expect(row?.name).toBe(indexName);
    }
  });
});
