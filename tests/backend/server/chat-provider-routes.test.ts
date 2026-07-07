import express from "express";
import type { Server } from "http";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerChatProviderRoutes } from "../../../src/server/chat-provider-routes.js";
import type { DashboardDependencies } from "../../../src/server/dashboard-server.js";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ConnectionChatRepository } from "../../../src/repositories/connection-chat-repository.js";
import { ChatProviderRepository } from "../../../src/repositories/chat-provider-repository.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";

interface TestServerContext {
  baseUrl: string;
  server: Server;
  tempDir: string;
  storage: AppDbStorage;
  chatProviderRepository: ChatProviderRepository;
  connectionChatRepository: ConnectionChatRepository;
  projectManagementRepository: ProjectManagementRepository;
}

const serversToClose: Server[] = [];
const tempDirs: string[] = [];

beforeEach(() => {
  process.env.NODE_ENV = "test";
});

afterEach(async () => {
  for (const server of serversToClose.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const dir of tempDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe("chat provider dashboard routes", () => {
  it("returns setup definitions with ingress templates and setup hints", async () => {
    const context = await startTestServer();

    const response = await fetch(`${context.baseUrl}/api/chat-providers/setup-definitions`);

    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.providers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "slack",
        ingressUrlTemplate: `${context.baseUrl}/api/chat-providers/ingress/{connectionId}`,
      }),
      expect.objectContaining({ kind: "discord" }),
    ]));
    const slack = body.providers.find((provider: any) => provider.kind === "slack");
    expect(slack.bridgeModes[0].setupHints).toMatchObject({
      integration: "openclaw_plugin",
      requiredSetupFields: ["pluginName"],
      requiredSecretFields: ["openclawApiKey"],
    });
  });

  it("creates, lists, gets, updates, and deletes redacted provider connections", async () => {
    const context = await startTestServer();

    const createResponse = await fetch(`${context.baseUrl}/api/chat-providers/connections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        providerKind: "slack",
        displayName: "Operations Slack",
        bridgeMode: "openclaw",
        setup: { pluginName: "slack" },
        secrets: { openclawApiKey: "raw-secret-token" },
      }),
    });

    expect(createResponse.status).toBe(201);
    const created = await createResponse.json() as any;
    expect(JSON.stringify(created)).not.toContain("raw-secret-token");
    expect(created).toMatchObject({
      providerKind: "slack",
      displayName: "Operations Slack",
      bridgeMode: "openclaw",
      ingressUrl: `${context.baseUrl}/api/chat-providers/ingress/${created.id}`,
      credentials: [
        expect.objectContaining({
          key: "openclawApiKey",
          configured: true,
          redactedValue: "********",
        }),
      ],
      setupHints: expect.objectContaining({
        requiredSecretFields: ["openclawApiKey"],
      }),
    });

    const listResponse = await fetch(`${context.baseUrl}/api/chat-providers/connections?providerKind=slack`);
    expect(listResponse.status).toBe(200);
    const listed = await listResponse.json() as any;
    expect(listed.connections).toHaveLength(1);
    expect(listed.connections[0].id).toBe(created.id);

    const getResponse = await fetch(`${context.baseUrl}/api/chat-providers/connections/${created.id}`);
    expect(getResponse.status).toBe(200);
    expect(await getResponse.json()).toMatchObject({ id: created.id, displayName: "Operations Slack" });

    const updateResponse = await fetch(`${context.baseUrl}/api/chat-providers/connections/${created.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        displayName: "Support Slack",
        enabled: false,
        secrets: { openclawApiKey: "new-raw-secret" },
      }),
    });
    expect(updateResponse.status).toBe(200);
    const updated = await updateResponse.json() as any;
    expect(JSON.stringify(updated)).not.toContain("new-raw-secret");
    expect(updated).toMatchObject({
      displayName: "Support Slack",
      enabled: false,
      credentials: [expect.objectContaining({ configured: true, redactedValue: "********" })],
    });

    const deleteResponse = await fetch(`${context.baseUrl}/api/chat-providers/connections/${created.id}`, {
      method: "DELETE",
    });
    expect(deleteResponse.status).toBe(200);
    expect(await deleteResponse.json()).toEqual({ ok: true });
  });

  it("validates provider connection requests before repository writes", async () => {
    const context = await startTestServer();

    await expectValidationFailure(context, {
      providerKind: "sms",
      displayName: "Bad provider",
    }, "unsupported_provider_kind");

    await expectValidationFailure(context, {
      providerKind: "discord",
      displayName: "Bad bridge",
      bridgeMode: "openclaw",
    }, "unsupported_bridge_mode");

    await expectValidationFailure(context, {
      providerKind: "slack",
      displayName: "Bad setup",
      bridgeMode: "openclaw",
      setup: { unsupported: "value" },
    }, "unsupported_setup_field");

    await expectValidationFailure(context, {
      providerKind: "slack",
      displayName: "Bad secret",
      bridgeMode: "openclaw",
      secrets: { openclawApiKey: 123 },
    }, "invalid_secret");
  });

  it("creates, lists, updates, and deletes channel bindings including same-channel multi-project mappings", async () => {
    const context = await startTestServer();
    const connection = context.chatProviderRepository.createConnection({
      providerKind: "slack",
      displayName: "Team Slack",
      bridgeMode: "openclaw",
      setup: { pluginName: "slack" },
    });
    const projectA = createProject(context, "project-a");
    const projectB = createProject(context, "project-b");

    const firstResponse = await createBinding(context, {
      providerConnectionId: connection.id,
      externalChannelId: "C-shared",
      externalChannelName: "shared-channel",
      projectId: projectA.id,
      inboundEnabled: true,
      outboundEnabled: true,
    });
    expect(firstResponse.status).toBe(201);
    const first = await firstResponse.json() as any;

    const secondResponse = await createBinding(context, {
      providerConnectionId: connection.id,
      externalChannelId: "C-shared",
      externalChannelName: "shared-channel",
      projectId: projectB.id,
      routingHints: { projectAlias: "secondary" },
      suppressRichWidgets: false,
    });
    expect(secondResponse.status).toBe(201);
    const second = await secondResponse.json() as any;
    expect(second).toMatchObject({
      providerConnectionId: connection.id,
      externalChannelId: "C-shared",
      projectId: projectB.id,
      suppressRichWidgets: false,
    });

    const listResponse = await fetch(`${context.baseUrl}/api/chat-providers/channel-bindings?providerConnectionId=${connection.id}&externalChannelId=C-shared`);
    expect(listResponse.status).toBe(200);
    const listed = await listResponse.json() as any;
    expect(listed.bindings.map((binding: any) => binding.projectId).sort()).toEqual([projectA.id, projectB.id].sort());

    const updateResponse = await fetch(`${context.baseUrl}/api/chat-providers/channel-bindings/${first.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        externalChannelName: "renamed-channel",
        enabled: false,
        agentPresetId: null,
      }),
    });
    expect(updateResponse.status).toBe(200);
    expect(await updateResponse.json()).toMatchObject({
      id: first.id,
      externalChannelName: "renamed-channel",
      enabled: false,
    });

    const deleteResponse = await fetch(`${context.baseUrl}/api/chat-providers/channel-bindings/${second.id}`, {
      method: "DELETE",
    });
    expect(deleteResponse.status).toBe(200);
    expect(await deleteResponse.json()).toEqual({ ok: true });
  });

  it("validates channel binding project, channel, boolean, and object fields", async () => {
    const context = await startTestServer();
    const connection = context.chatProviderRepository.createConnection({
      providerKind: "slack",
      displayName: "Team Slack",
      bridgeMode: "openclaw",
    });

    const missingProject = await createBinding(context, {
      providerConnectionId: connection.id,
      externalChannelId: "C-validation",
      externalChannelName: "validation",
    });
    expect(missingProject.status).toBe(400);
    expect(await missingProject.json()).toMatchObject({
      details: [expect.objectContaining({ code: "required", field: "projectId" })],
    });

    const project = createProject(context, "binding-validation");
    const badBoolean = await createBinding(context, {
      providerConnectionId: connection.id,
      externalChannelId: "C-validation",
      externalChannelName: "validation",
      projectId: project.id,
      inboundEnabled: "yes",
    });
    expect(badBoolean.status).toBe(400);
    expect(await badBoolean.json()).toMatchObject({
      details: [expect.objectContaining({ code: "invalid_boolean", field: "inboundEnabled" })],
    });

    const badRoutingHints = await createBinding(context, {
      providerConnectionId: connection.id,
      externalChannelId: "C-validation",
      externalChannelName: "validation",
      projectId: project.id,
      routingHints: ["not", "an", "object"],
    });
    expect(badRoutingHints.status).toBe(400);
    expect(await badRoutingHints.json()).toMatchObject({
      details: [expect.objectContaining({ code: "invalid_object", field: "routingHints" })],
    });
  });

  it("lists delivery status records for a provider connection or a channel binding", async () => {
    const context = await startTestServer();
    const project = createProject(context, "delivery-status");
    const connection = context.chatProviderRepository.createConnection({
      providerKind: "slack",
      displayName: "Delivery Slack",
      bridgeMode: "openclaw",
    });
    const binding = context.chatProviderRepository.createChannelBinding({
      providerConnectionId: connection.id,
      externalChannelId: "C-delivery",
      externalChannelName: "delivery",
      projectId: project.id,
    });
    const thread = context.connectionChatRepository.createThread(project.id, { title: "Delivery thread" });
    const message = context.connectionChatRepository.postDashboardMessage(project.id, {
      threadId: thread.id,
      bodyMarkdown: "queued reply",
    });
    const outbound = context.chatProviderRepository.upsertOutboundDelivery({
      providerConnectionId: connection.id,
      channelBindingId: binding.id,
      externalChannelId: "C-delivery",
      conversationThreadId: thread.id,
      conversationMessageId: message.id,
      status: "pending",
      payload: { text: "queued reply" },
    });
    const inbound = context.chatProviderRepository.recordInboundMessage({
      providerConnectionId: connection.id,
      channelBindingId: binding.id,
      externalChannelId: "C-delivery",
      externalMessageId: "external-message-1",
      status: "processed",
    });

    const connectionResponse = await fetch(`${context.baseUrl}/api/chat-providers/connections/${connection.id}/delivery-status`);
    expect(connectionResponse.status).toBe(200);
    const connectionBody = await connectionResponse.json() as any;
    expect(connectionBody.deliveries.map((delivery: any) => delivery.id)).toEqual([outbound.id]);
    expect(connectionBody.deliveries.map((delivery: any) => delivery.id)).not.toContain(inbound.delivery.id);

    const bindingResponse = await fetch(`${context.baseUrl}/api/chat-providers/channel-bindings/${binding.id}/delivery-status`);
    expect(bindingResponse.status).toBe(200);
    const bindingBody = await bindingResponse.json() as any;
    expect(bindingBody.deliveries).toEqual([
      expect.objectContaining({
        id: outbound.id,
        direction: "outbound",
        status: "pending",
        channelBindingId: binding.id,
      }),
    ]);
  });
});

async function expectValidationFailure(
  context: TestServerContext,
  body: Record<string, unknown>,
  code: string,
): Promise<void> {
  const response = await fetch(`${context.baseUrl}/api/chat-providers/connections`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({
    details: [expect.objectContaining({ code })],
  });
}

async function startTestServer(): Promise<TestServerContext> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-chat-provider-routes-"));
  tempDirs.push(tempDir);
  const storage = new AppDbStorage(path.join(tempDir, "app.db"));
  const chatProviderRepository = new ChatProviderRepository(storage);
  const connectionChatRepository = new ConnectionChatRepository(storage);
  const projectManagementRepository = new ProjectManagementRepository(storage);
  const app = express();
  app.use(express.json());
  registerChatProviderRoutes(app, {
    chatProviderRepository,
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
    connectionChatRepository,
    projectManagementRepository,
  };
}

function createProject(context: TestServerContext, name: string) {
  return context.projectManagementRepository.createProject({
    name,
    sourceType: "local",
    sourceRef: path.join(context.tempDir, name),
  });
}

function createBinding(context: TestServerContext, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${context.baseUrl}/api/chat-providers/channel-bindings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
