import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ChatProviderRepository } from "../../../src/repositories/chat-provider-repository.js";
import { ConnectionChatRepository } from "../../../src/repositories/connection-chat-repository.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { ChatProviderIngressService, normalizeInboundPayload } from "../../../src/services/chat-provider-ingress-service.js";
import type { ChatThreadRuntimeService } from "../../../src/services/chat-thread-runtime-service.js";
import type { ChatProviderConnectionInternalRecord, ChatProviderKind } from "../../../src/contracts/chat-provider-types.js";

const tempDirs: string[] = [];
const openStorages: AppDbStorage[] = [];

afterEach(async () => {
  for (const storage of openStorages.splice(0).reverse()) {
    storage.close();
  }
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("ChatProviderIngressService", () => {
  it("routes selector-prefixed external text into the matching project thread and records delivery metadata", async () => {
    const context = await createContext();
    const projectA = context.projectRepository.createProject({
      name: "Ingress Project A",
      sourceType: "local",
      sourceRef: path.join(context.tempDir, "project-a"),
    });
    const projectB = context.projectRepository.createProject({
      name: "Ingress Project B",
      sourceType: "local",
      sourceRef: path.join(context.tempDir, "project-b"),
    });
    const thread = context.conversationRepository.createThread(projectA.id, { title: "External triage" });
    const connection = context.providerRepository.createConnection({
      providerKind: "slack",
      displayName: "Slack ingress",
      bridgeMode: "openclaw",
      status: "active",
      secrets: { openclawApiKey: "bridge-token" },
    });
    const bindingA = context.providerRepository.createChannelBinding({
      providerConnectionId: connection.id,
      externalChannelId: "C-shared",
      externalChannelName: "shared",
      projectId: projectA.id,
      routingHints: { projectSelectorPrefix: "alpha", conversationThreadId: thread.id },
    });
    context.providerRepository.createChannelBinding({
      providerConnectionId: connection.id,
      externalChannelId: "C-shared",
      externalChannelName: "shared",
      projectId: projectB.id,
      routingHints: { projectSelectorPrefix: "beta" },
    });

    const result = await context.service.processInbound({
      providerConnectionId: connection.id,
      payload: {
        event: {
          channel: "C-shared",
          channel_name: "shared",
          user: "U123",
          username: "Sam",
          client_msg_id: "msg-1",
          text: "[alpha] Fix the failing release workflow",
          event_ts: "1783430400.000100",
        },
      },
    });

    expect(result.status).toBe("accepted");
    expect(result.delivery).toMatchObject({
      providerConnectionId: connection.id,
      channelBindingId: bindingA.id,
      externalMessageId: "msg-1",
      status: "processed",
      conversationThreadId: thread.id,
      conversationMessageId: result.conversationMessage?.id,
    });
    expect(context.postMessage).toHaveBeenCalledWith(projectA.id, expect.objectContaining({
      threadId: thread.id,
      bodyMarkdown: "Fix the failing release workflow",
      metadata: expect.objectContaining({
        source: "chat_provider",
        providerKind: "slack",
        externalChannelId: "C-shared",
        inboundDeliveryId: result.delivery?.id,
        suppressRichWidgets: true,
      }),
    }));
    expect(context.conversationRepository.listMessages(thread.id)[0]).toMatchObject({
      bodyMarkdown: "Fix the failing release workflow",
      metadata: expect.objectContaining({
        inboundDeliveryId: result.delivery?.id,
        externalSender: { id: "U123", name: "Sam" },
      }),
    });
  });

  it("returns an existing inbound delivery for duplicate external messages without posting again", async () => {
    const context = await createContext();
    const project = context.projectRepository.createProject({
      name: "Duplicate Ingress Project",
      sourceType: "local",
      sourceRef: path.join(context.tempDir, "duplicate-project"),
    });
    const connection = context.providerRepository.createConnection({
      providerKind: "discord",
      displayName: "Discord ingress",
      bridgeMode: "webhook",
      status: "active",
      secrets: { botToken: "bot-token" },
    });
    context.providerRepository.createChannelBinding({
      providerConnectionId: connection.id,
      externalChannelId: "channel-1",
      externalChannelName: "triage",
      projectId: project.id,
    });
    const payload = {
      id: "discord-message-1",
      channel_id: "channel-1",
      content: "Investigate the preview crash",
      author: { id: "user-1", username: "alex" },
      timestamp: "2026-07-07T12:00:00.000Z",
    };

    const first = await context.service.processInbound({ providerConnectionId: connection.id, payload });
    const second = await context.service.processInbound({ providerConnectionId: connection.id, payload });

    expect(first.status).toBe("accepted");
    expect(second).toMatchObject({
      status: "duplicate",
      delivery: expect.objectContaining({ id: first.delivery?.id }),
    });
    expect(context.postMessage).toHaveBeenCalledTimes(1);
  });

  it("records disambiguation-needed state when a shared external channel lacks a selector", async () => {
    const context = await createContext();
    const projectA = context.projectRepository.createProject({
      name: "Ambiguous A",
      sourceType: "local",
      sourceRef: path.join(context.tempDir, "ambiguous-a"),
    });
    const projectB = context.projectRepository.createProject({
      name: "Ambiguous B",
      sourceType: "local",
      sourceRef: path.join(context.tempDir, "ambiguous-b"),
    });
    const connection = context.providerRepository.createConnection({
      providerKind: "telegram",
      displayName: "Telegram ingress",
      bridgeMode: "webhook",
      status: "active",
      secrets: { botToken: "telegram-token" },
    });
    for (const project of [projectA, projectB]) {
      context.providerRepository.createChannelBinding({
        providerConnectionId: connection.id,
        externalChannelId: "chat-1",
        externalChannelName: "shared",
        projectId: project.id,
      });
    }

    const result = await context.service.processInbound({
      providerConnectionId: connection.id,
      payload: {
        message: {
          message_id: 42,
          date: 1783430400,
          text: "No project selector here",
          chat: { id: "chat-1", title: "shared" },
          from: { id: "sender-1", first_name: "Taylor" },
        },
      },
    });

    expect(result.status).toBe("ambiguous");
    expect(result.candidateProjectIds?.sort()).toEqual([projectA.id, projectB.id].sort());
    expect(result.delivery).toMatchObject({
      status: "pending",
      conversationMessageId: null,
      payload: expect.objectContaining({ state: "disambiguation_needed" }),
    });
    expect(context.postMessage).not.toHaveBeenCalled();
  });

  it.each([
    ["whatsapp", {
      entry: [{
        changes: [{
          value: {
            metadata: { phone_number_id: "phone-1", display_phone_number: "+15551234567" },
            contacts: [{ wa_id: "wa-1", profile: { name: "Pat" } }],
            messages: [{ id: "wamid-1", from: "wa-1", timestamp: "1783430400", text: { body: "WhatsApp body" } }],
          },
        }],
      }],
    }, "phone-1", "wa-1", "WhatsApp body", "wamid-1"],
    ["imessage", { chatGuid: "chat-guid", chatName: "Family", sender: { handle: "+15550000", name: "Lee" }, guid: "imsg-1", text: "iMessage body" }, "chat-guid", "+15550000", "iMessage body", "imsg-1"],
    ["telegram", { message: { message_id: 7, date: 1783430400, text: "Telegram body", chat: { id: 88, title: "Ops" }, from: { id: 99, username: "ops-user" } } }, "88", "99", "Telegram body", "7"],
    ["slack", { event_id: "event-1", event: { channel: "C1", user: "U1", text: "Slack body", ts: "1783430400.000100" } }, "C1", "U1", "Slack body", "event-1"],
    ["microsoft-teams", { id: "activity-1", text: "Teams body", conversation: { id: "teams-conv", name: "Ops" }, from: { id: "aad-1", name: "Morgan" }, timestamp: "2026-07-07T12:00:00.000Z" }, "teams-conv", "aad-1", "Teams body", "activity-1"],
    ["discord", { id: "discord-1", content: "Discord body", channel_id: "discord-channel", author: { id: "discord-user", username: "Riley" }, timestamp: "2026-07-07T12:00:00.000Z" }, "discord-channel", "discord-user", "Discord body", "discord-1"],
  ] as Array<[ChatProviderKind, Record<string, unknown>, string, string, string, string]>)(
    "normalizes %s payloads into the internal inbound shape",
    (providerKind, payload, channelId, senderId, textBody, messageId) => {
      const normalized = normalizeInboundPayload(buildConnection(providerKind), payload);

      expect(normalized).toMatchObject({
        providerConnectionId: "connection-1",
        providerKind,
        externalChannelId: channelId,
        externalSenderId: senderId,
        textBody,
        externalMessageId: messageId,
      });
    },
  );
});

async function createContext(): Promise<{
  tempDir: string;
  providerRepository: ChatProviderRepository;
  conversationRepository: ConnectionChatRepository;
  projectRepository: ProjectManagementRepository;
  postMessage: ReturnType<typeof vi.fn>;
  service: ChatProviderIngressService;
}> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-chat-ingress-service-"));
  tempDirs.push(tempDir);
  const storage = new AppDbStorage(path.join(tempDir, "app.db"));
  openStorages.push(storage);
  const providerRepository = new ChatProviderRepository(storage);
  const conversationRepository = new ConnectionChatRepository(storage);
  const projectRepository = new ProjectManagementRepository(storage);
  const postMessage = vi.fn(async (projectId: string, input: Parameters<ChatThreadRuntimeService["postMessage"]>[1]) => (
    conversationRepository.postDashboardMessage(projectId, input)
  ));
  const service = new ChatProviderIngressService({
    chatProviderRepository: providerRepository,
    chatThreadRuntimeService: { postMessage } as unknown as ChatThreadRuntimeService,
  });
  return { tempDir, providerRepository, conversationRepository, projectRepository, postMessage, service };
}

function buildConnection(providerKind: ChatProviderKind): ChatProviderConnectionInternalRecord {
  return {
    id: "connection-1",
    providerKind,
    displayName: "Connection",
    bridgeMode: providerKind === "imessage" ? "native_bridge" : "webhook",
    status: "active",
    enabled: true,
    setup: {},
    secrets: {},
    createdAt: "2026-07-07T00:00:00.000Z",
    updatedAt: "2026-07-07T00:00:00.000Z",
  };
}
