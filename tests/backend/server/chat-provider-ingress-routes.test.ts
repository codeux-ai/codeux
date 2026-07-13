import { createHmac } from "crypto";
import express from "express";
import type { Server } from "http";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerChatProviderIngressRoutes } from "../../../src/server/chat-provider-ingress-routes.js";
import type { DashboardDependencies } from "../../../src/server/dashboard-server.js";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ChatProviderRepository } from "../../../src/repositories/chat-provider-repository.js";
import { ConnectionChatRepository } from "../../../src/repositories/connection-chat-repository.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { createChatProviderSecretFixture } from "../helpers/chat-provider-secret-fixture.js";
import type { ChatProviderSecretService } from "../../../src/services/chat-provider-secret-service.js";
import { ChatProviderIngressService } from "../../../src/services/chat-provider-ingress-service.js";
import type { ChatThreadRuntimeService } from "../../../src/services/chat-thread-runtime-service.js";

interface TestServerContext {
  baseUrl: string;
  server: Server;
  tempDir: string;
  storage: AppDbStorage;
  chatProviderRepository: ChatProviderRepository;
  chatProviderSecretService: ChatProviderSecretService;
  connectionChatRepository: ConnectionChatRepository;
  projectManagementRepository: ProjectManagementRepository;
  postMessage: ReturnType<typeof vi.fn>;
}

const serversToClose: Server[] = [];
const tempDirs: string[] = [];
const openStorages: AppDbStorage[] = [];

afterEach(async () => {
  for (const server of serversToClose.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const storage of openStorages.splice(0).reverse()) {
    storage.close();
  }
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("chat provider ingress routes", () => {
  it("accepts an authenticated bearer bridge request and deduplicates repeated external messages", async () => {
    const context = await startTestServer();
    const project = createProject(context, "bearer-ingress");
    const connection = await context.chatProviderSecretService.createConnection({
      providerKind: "slack",
      displayName: "Slack bridge",
      bridgeMode: "managed_bridge",
      status: "active",
      secrets: { bridgeApiKey: "bridge-token" },
    });
    context.chatProviderRepository.createChannelBinding({
      providerConnectionId: connection.id,
      externalChannelId: "C-route",
      externalChannelName: "route",
      projectId: project.id,
    });
    const payload = {
      event_id: "event-route-1",
      event: {
        channel: "C-route",
        user: "U-route",
        username: "Jordan",
        text: "Handle this route payload",
        ts: "1783430400.000100",
      },
    };

    const first = await postIngress(context, connection.id, payload, {
      Authorization: "Bearer bridge-token",
      "x-code-ux-timestamp": String(Date.now()),
    });
    const firstBody = await first.json() as any;

    expect(first.status).toBe(202);
    expect(firstBody).toMatchObject({
      status: "accepted",
      delivery: expect.objectContaining({
        externalMessageId: "event-route-1",
        status: "processed",
      }),
    });

    const duplicate = await postIngress(context, connection.id, payload, {
      Authorization: "Bearer bridge-token",
      "x-code-ux-timestamp": String(Date.now()),
    });
    const duplicateBody = await duplicate.json() as any;

    expect(duplicate.status).toBe(200);
    expect(duplicateBody).toMatchObject({
      status: "duplicate",
      delivery: expect.objectContaining({ id: firstBody.delivery.id }),
    });
    expect(context.postMessage).toHaveBeenCalledTimes(1);
  });

  it("verifies webhook HMAC signatures before processing inbound payloads", async () => {
    const context = await startTestServer();
    const project = createProject(context, "hmac-ingress");
    const connection = await context.chatProviderSecretService.createConnection({
      providerKind: "discord",
      displayName: "Discord gateway",
      bridgeMode: "webhook",
      status: "active",
      secrets: { botToken: "bot-token", webhookSecret: "signing-secret" },
    });
    context.chatProviderRepository.createChannelBinding({
      providerConnectionId: connection.id,
      externalChannelId: "discord-channel",
      externalChannelName: "discord",
      projectId: project.id,
    });
    const payload = {
      id: "discord-route-1",
      channel_id: "discord-channel",
      content: "Ship the route",
      author: { id: "discord-user", username: "Avery" },
      timestamp: "2026-07-07T12:00:00.000Z",
    };
    const timestamp = String(Date.now());
    const body = JSON.stringify(payload);
    const signature = `sha256=${createHmac("sha256", "signing-secret").update(`${timestamp}.${body}`).digest("hex")}`;

    const bearerOnly = await postIngress(context, connection.id, payload, {
      Authorization: "Bearer bot-token",
      "x-code-ux-timestamp": timestamp,
    });
    expect(bearerOnly.status).toBe(401);
    expect(context.postMessage).not.toHaveBeenCalled();

    const response = await postIngress(context, connection.id, payload, {
      "x-code-ux-timestamp": timestamp,
      "x-code-ux-signature": signature,
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      status: "accepted",
      providerKind: "discord",
    });
  });

  it("rejects unauthenticated and stale bridge requests without creating messages", async () => {
    const context = await startTestServer();
    const project = createProject(context, "rejected-ingress");
    const connection = await context.chatProviderSecretService.createConnection({
      providerKind: "slack",
      displayName: "Slack bridge",
      bridgeMode: "managed_bridge",
      status: "active",
      secrets: { bridgeApiKey: "bridge-token" },
    });
    context.chatProviderRepository.createChannelBinding({
      providerConnectionId: connection.id,
      externalChannelId: "C-reject",
      externalChannelName: "reject",
      projectId: project.id,
    });
    const payload = {
      event_id: "event-reject-1",
      event: { channel: "C-reject", user: "U1", text: "Should not post", ts: "1783430400.000100" },
    };

    const missingAuth = await postIngress(context, connection.id, payload, {
      "x-code-ux-timestamp": String(Date.now()),
    });
    expect(missingAuth.status).toBe(401);

    const stale = await postIngress(context, connection.id, payload, {
      Authorization: "Bearer bridge-token",
      "x-code-ux-timestamp": "2020-01-01T00:00:00.000Z",
    });
    expect(stale.status).toBe(401);
    expect(context.postMessage).not.toHaveBeenCalled();
  });

  it("returns a clear conflict response for ambiguous shared-channel ingress", async () => {
    const context = await startTestServer();
    const projectA = createProject(context, "ambiguous-route-a");
    const projectB = createProject(context, "ambiguous-route-b");
    const connection = await context.chatProviderSecretService.createConnection({
      providerKind: "telegram",
      displayName: "Telegram gateway",
      bridgeMode: "managed_bridge",
      status: "active",
      secrets: { bridgeApiKey: "telegram-token" },
    });
    for (const project of [projectA, projectB]) {
      context.chatProviderRepository.createChannelBinding({
        providerConnectionId: connection.id,
        externalChannelId: "telegram-chat",
        externalChannelName: "shared",
        projectId: project.id,
      });
    }

    const response = await postIngress(context, connection.id, {
      message: {
        message_id: 100,
        date: 1783430400,
        text: "Needs a selector",
        chat: { id: "telegram-chat", title: "shared" },
        from: { id: "sender-1", username: "sender" },
      },
    }, {
      Authorization: "Bearer telegram-token",
      "x-code-ux-timestamp": String(Date.now()),
    });
    const body = await response.json() as any;

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      status: "ambiguous",
      message: expect.stringContaining("Multiple project bindings"),
      delivery: expect.objectContaining({
        status: "pending",
        conversationMessageId: null,
      }),
    });
    expect(body.candidateProjectIds.sort()).toEqual([projectA.id, projectB.id].sort());
    expect(context.postMessage).not.toHaveBeenCalled();
  });
});

async function startTestServer(): Promise<TestServerContext> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-chat-ingress-routes-"));
  tempDirs.push(tempDir);
  const storage = new AppDbStorage(path.join(tempDir, "app.db"));
  openStorages.push(storage);
  const chatProviderRepository = new ChatProviderRepository(storage);
  const chatProviderSecretService = createChatProviderSecretFixture(chatProviderRepository);
  const connectionChatRepository = new ConnectionChatRepository(storage);
  const projectManagementRepository = new ProjectManagementRepository(storage);
  const postMessage = vi.fn(async (projectId: string, input: Parameters<ChatThreadRuntimeService["postMessage"]>[1]) => (
    connectionChatRepository.postDashboardMessage(projectId, input)
  ));
  const chatProviderIngressService = new ChatProviderIngressService({
    chatProviderRepository,
    chatProviderSecretService,
    chatThreadRuntimeService: { postMessage } as unknown as ChatThreadRuntimeService,
  });
  const app = express();
  app.use(express.json({
    verify: (req, _res, buf) => {
      (req as typeof req & { rawBody?: string }).rawBody = buf.toString("utf8");
    },
  }));
  registerChatProviderIngressRoutes(app, {
    chatProviderRepository,
    chatProviderSecretService,
    chatProviderIngressService,
  } as DashboardDependencies);
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  serversToClose.push(server);
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not bind to a TCP port.");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    server,
    tempDir,
    storage,
    chatProviderRepository,
    chatProviderSecretService,
    connectionChatRepository,
    projectManagementRepository,
    postMessage,
  };
}

function createProject(context: TestServerContext, name: string) {
  return context.projectManagementRepository.createProject({
    name,
    sourceType: "local",
    sourceRef: path.join(context.tempDir, name),
  });
}

function postIngress(
  context: TestServerContext,
  providerConnectionId: string,
  body: Record<string, unknown>,
  headers: Record<string, string>,
): Promise<Response> {
  return fetch(`${context.baseUrl}/api/chat-providers/ingress/${providerConnectionId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}
