import { createHmac } from "node:crypto";
import type { Server } from "node:http";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardDependencies } from "../../../src/server/dashboard-server.js";
import type { ChatProviderConnectionInternalRecord } from "../../../src/contracts/chat-provider-types.js";
import type { ChatThreadRuntimeService } from "../../../src/services/chat-thread-runtime-service.js";
import { CHAT_CONNECTOR_REGISTRY } from "../../../src/domain/chat-connectors/registry.js";
import { getSlackChallengeResponse } from "../../../src/domain/chat-connectors/providers/slack.js";
import { verifyWhatsAppWebhookChallenge } from "../../../src/domain/chat-connectors/providers/whatsapp.js";
import { ChatProviderActions } from "../../../src/mcp/management/chat-provider-actions.js";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ChatProviderRepository } from "../../../src/repositories/chat-provider-repository.js";
import { ConnectionChatRepository } from "../../../src/repositories/connection-chat-repository.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { registerChatProviderRoutes } from "../../../src/server/chat-provider-routes.js";
import {
  ChatProviderOutboundAdapterError,
  type ChatProviderOutboundAdapter,
} from "../../../src/services/chat-provider-adapters.js";
import { ChatProviderIngressService } from "../../../src/services/chat-provider-ingress-service.js";
import { ChatProviderOutboundService } from "../../../src/services/chat-provider-outbound-service.js";
import { ChatProviderIngressSecurity, ChatProviderIngressSecurityError } from "../../../src/services/chat-provider-security.js";
import { ChatProviderSessionRuntimeService } from "../../../src/services/chat-provider-session-runtime-service.js";
import { ChatProviderVerificationService } from "../../../src/services/chat-provider-verification-service.js";
import { createChatProviderSecretFixture } from "../helpers/chat-provider-secret-fixture.js";
import {
  assertSyntheticConnectorFixture,
  chatConnectorProviderFixtures,
  discordInteractionFixture,
  imessageBridgeProtocolFixture,
  slackChallengeFixture,
  teamsJwtMetadataFixture,
  whatsappChallengeFixture,
} from "../../fixtures/chat-connectors/provider-fixtures.js";

const storages: AppDbStorage[] = [];
const servers: Server[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const storage of storages.splice(0).reverse()) storage.close();
  await Promise.all(tempDirs.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("chat connector fan-in acceptance", () => {
  it("uses deterministic provider-shaped fixtures, handshakes, and normalization contracts", () => {
    assertSyntheticConnectorFixture({
      fixtures: chatConnectorProviderFixtures,
      whatsappChallengeFixture,
      slackChallengeFixture,
      teamsJwtMetadataFixture,
      discordInteractionFixture,
      imessageBridgeProtocolFixture,
    });
    expect(verifyWhatsAppWebhookChallenge(whatsappChallengeFixture, whatsappChallengeFixture["hub.verify_token"])).toEqual({
      verified: true,
      statusCode: 200,
      body: whatsappChallengeFixture["hub.challenge"],
    });
    expect(getSlackChallengeResponse(slackChallengeFixture)).toEqual({ challenge: slackChallengeFixture.challenge });
    expect(teamsJwtMetadataFixture.openIdMetadataUrl).toMatch(/^https:\/\/login\.botframework\.com\//);
    expect(discordInteractionFixture.type).toBe(2);
    expect(imessageBridgeProtocolFixture.protocolVersion).toBe("1.0");

    for (const fixture of chatConnectorProviderFixtures) {
      const profile = CHAT_CONNECTOR_REGISTRY.getForMode(fixture.kind, fixture.bridgeMode);
      const normalized = profile.ingress.normalize(fixture.inbound, fixture.bridgeMode);
      expect(normalized).toMatchObject({
        externalChannelId: fixture.channelId,
        externalMessageId: fixture.messageId,
        textBody: expect.stringContaining("acceptance path"),
      });
      expect(profile.verification.verifyConfiguration(fixture.bridgeMode, fixture.setup, fixture.secrets)).toEqual({
        valid: true,
        issues: [],
      });
    }
  });

  it("routes, replies, and exposes the same redacted six-provider state through REST and MCP", async () => {
    const context = await createHarness();
    const project = context.projectRepository.createProject({
      name: "Approved local connector test project",
      sourceType: "local",
      sourceRef: path.join(context.tempDir, "approved-local-test-project"),
    });
    const sent: Array<{ kind: string; deliveryId: string }> = [];
    const adapter: ChatProviderOutboundAdapter = {
      send: vi.fn(async ({ connection, delivery }) => {
        sent.push({ kind: connection.providerKind, deliveryId: delivery.id });
        return { externalMessageId: `${connection.providerKind}-fixture-outbound` };
      }),
    };
    const outbound = new ChatProviderOutboundService({
      chatProviderRepository: context.providerRepository,
      chatProviderSecretService: context.secretService,
      adapter,
      jitterRatio: 0,
    });
    const postMessage = vi.fn(async (projectId: string, input: Parameters<ChatThreadRuntimeService["postMessage"]>[1]) => (
      context.conversationRepository.postDashboardMessage(projectId, input)
    ));
    const ingress = new ChatProviderIngressService({
      chatProviderRepository: context.providerRepository,
      chatProviderSecretService: context.secretService,
      chatThreadRuntimeService: { postMessage } as unknown as ChatThreadRuntimeService,
    });
    const verification = new ChatProviderVerificationService({
      chatProviderRepository: context.providerRepository,
      chatProviderSecretService: context.secretService,
    });
    const security = new ChatProviderIngressSecurity(5 * 60_000, context.providerRepository);
    const acceptance: Array<{ provider: string; source: string; connectionId: string }> = [];

    for (const fixture of chatConnectorProviderFixtures) {
      const connection = await context.secretService.createConnection({
        providerKind: fixture.kind,
        displayName: `${fixture.label} fixture connection`,
        bridgeMode: fixture.bridgeMode,
        status: "active",
        enabled: true,
        setup: fixture.setup,
        secrets: fixture.secrets,
      });
      context.providerRepository.createChannelBinding({
        providerConnectionId: connection.id,
        externalChannelId: fixture.channelId,
        externalChannelName: `${fixture.label} fixture channel`,
        projectId: project.id,
      });
      expect(await verification.verifyConnection(connection.id)).toMatchObject({ status: "verified" });
      const resolved = await context.secretService.resolveConnection(connection.id);
      authenticateFixture(security, resolved, fixture.secrets, `${fixture.kind}-nonce`);

      const [first, duplicate] = await Promise.all([
        ingress.processInbound({ providerConnectionId: connection.id, payload: fixture.inbound }),
        ingress.processInbound({ providerConnectionId: connection.id, payload: fixture.inbound }),
      ]);
      const accepted = first.status === "accepted" ? first : duplicate;
      expect([first.status, duplicate.status].sort()).toEqual(["accepted", "duplicate"]);
      expect(accepted.conversationMessage).toBeTruthy();
      const triggeringMessage = accepted.conversationMessage!;
      const thread = context.conversationRepository.getThread(triggeringMessage.threadId);
      const reply = context.conversationRepository.postSystemMessage(project.id, {
        threadId: thread.id,
        bodyMarkdown: `Assistant reply for ${fixture.label}`,
      });
      expect(await outbound.deliverReply({
        projectId: project.id,
        thread,
        triggeringMessage,
        replyMessage: reply,
      })).toMatchObject({ status: "delivered", externalMessageId: `${fixture.kind}-fixture-outbound` });
      acceptance.push({ provider: fixture.kind, source: fixture.acceptanceSource, connectionId: connection.id });
    }

    expect(postMessage).toHaveBeenCalledTimes(6);
    expect(sent.map((entry) => entry.kind).sort()).toEqual(chatConnectorProviderFixtures.map((fixture) => fixture.kind).sort());
    expect(acceptance).toEqual(expect.arrayContaining(chatConnectorProviderFixtures.map((fixture) => expect.objectContaining({
      provider: fixture.kind,
      source: fixture.acceptanceSource,
    }))));

    const rest = await startRestBoundary(context, verification, outbound);
    const restResponse = await fetch(`${rest}/api/chat-providers/connections`);
    expect(restResponse.status).toBe(200);
    const restBody = await restResponse.json() as { connections: Array<Record<string, unknown>> };
    const mcp = new ChatProviderActions(context.providerRepository, context.secretService, {
      chatProviderVerificationService: verification,
      chatProviderOutboundService: outbound,
      authorizeProject: (projectId) => projectId === project.id,
    });
    const mcpEnvelope = await mcp.handleChatProviderAction({
      domain: "chat_providers",
      action: "list_connections",
      payload: {},
    });
    const mcpConnections = (mcpEnvelope.result as { connections: Array<Record<string, unknown>> }).connections;
    expect(restBody.connections.map(({ id }) => id).sort()).toEqual(mcpConnections.map(({ id }) => id).sort());
    const publicState = JSON.stringify({ rest: restBody, mcp: mcpEnvelope });
    for (const fixture of chatConnectorProviderFixtures) {
      for (const secret of Object.values(fixture.secrets)) {
        if (typeof secret === "string") expect(publicState).not.toContain(secret);
      }
    }
    expect(publicState).not.toContain("authorization");
  });

  it("fails closed across configuration, authentication, routing, retry, cancellation, and disabled-state edges", async () => {
    const context = await createHarness();
    const projectA = context.projectRepository.createProject({ name: "Approved fixture A", sourceType: "local", sourceRef: path.join(context.tempDir, "a") });
    const projectB = context.projectRepository.createProject({ name: "Approved fixture B", sourceType: "local", sourceRef: path.join(context.tempDir, "b") });
    const fixture = chatConnectorProviderFixtures.find((candidate) => candidate.kind === "discord")!;
    expect(CHAT_CONNECTOR_REGISTRY.get("discord").verification.verifyConfiguration("webhook", {}, {})).toMatchObject({ valid: false });
    const connection = await context.secretService.createConnection({
      providerKind: fixture.kind,
      displayName: "Failure fixture Discord",
      bridgeMode: fixture.bridgeMode,
      status: "active",
      enabled: true,
      setup: fixture.setup,
      secrets: fixture.secrets,
    });
    const resolved = await context.secretService.resolveConnection(connection.id);
    const security = new ChatProviderIngressSecurity(1_000, context.providerRepository);
    expect(() => security.verify(resolved, { headers: {}, rawBody: JSON.stringify(fixture.inbound) })).toThrow(ChatProviderIngressSecurityError);
    expect(() => authenticateHmac(security, resolved, "wrong-secret", new Date())).toThrow("Invalid chat provider ingress signature");
    expect(() => authenticateHmac(security, resolved, fixture.secrets.webhookSecret as string, new Date(0))).toThrow("outside the allowed window");
    const replayTimestamp = new Date();
    authenticateHmac(security, resolved, fixture.secrets.webhookSecret as string, replayTimestamp, "replay-fixture");
    expect(() => authenticateHmac(security, resolved, fixture.secrets.webhookSecret as string, replayTimestamp, "replay-fixture")).toThrow("Duplicate chat provider ingress request");

    const postMessage = vi.fn(async (projectId: string, input: Parameters<ChatThreadRuntimeService["postMessage"]>[1]) => context.conversationRepository.postDashboardMessage(projectId, input));
    const ingress = new ChatProviderIngressService({
      chatProviderRepository: context.providerRepository,
      chatProviderSecretService: context.secretService,
      chatThreadRuntimeService: { postMessage } as unknown as ChatThreadRuntimeService,
    });
    expect(await ingress.processInbound({ providerConnectionId: connection.id, payload: fixture.inbound })).toMatchObject({ status: "unbound" });
    for (const project of [projectA, projectB]) {
      context.providerRepository.createChannelBinding({ providerConnectionId: connection.id, externalChannelId: fixture.channelId, externalChannelName: "ambiguous", projectId: project.id });
    }
    const ambiguousPayload = { ...fixture.inbound, id: "discord-message-fixture-ambiguous" };
    expect(await ingress.processInbound({ providerConnectionId: connection.id, payload: ambiguousPayload })).toMatchObject({ status: "ambiguous" });
    expect(postMessage).not.toHaveBeenCalled();

    const binding = context.providerRepository.listChannelBindings({ providerConnectionId: connection.id })[0]!;
    const inbound = context.providerRepository.recordInboundMessage({ providerConnectionId: connection.id, channelBindingId: binding.id, externalChannelId: fixture.channelId, externalMessageId: "failure-trigger" }).delivery;
    const trigger = context.conversationRepository.postDashboardMessage(projectA.id, { title: "Failure trigger", bodyMarkdown: "fixture", metadata: { source: "chat_provider", inboundDeliveryId: inbound.id } });
    const thread = context.conversationRepository.getThread(trigger.threadId);
    const reply = context.conversationRepository.postSystemMessage(projectA.id, { threadId: thread.id, bodyMarkdown: "fixture reply" });
    const adapter: ChatProviderOutboundAdapter = {
      send: vi.fn()
        .mockRejectedValueOnce(new ChatProviderOutboundAdapterError("request timed out token=fixture-discord-bot-token", true))
        .mockRejectedValueOnce(new ChatProviderOutboundAdapterError("HTTP 429 rate limited secret=fixture-discord-signing-secret", true, 429, 2_000))
        .mockRejectedValueOnce(new ChatProviderOutboundAdapterError("HTTP 400 terminal", false, 400)),
    };
    const outbound = new ChatProviderOutboundService({ chatProviderRepository: context.providerRepository, chatProviderSecretService: context.secretService, adapter, initialBackoffMs: 1_000, jitterRatio: 0, maxAttempts: 3 });
    const retryable = await outbound.deliverReply({ projectId: projectA.id, thread, triggeringMessage: trigger, replyMessage: reply });
    expect(retryable).toMatchObject({ status: "retryable_failure", nextAttemptAt: expect.any(String) });
    expect(retryable?.lastError).not.toContain("fixture-discord-bot-token");
    const rateLimited = await outbound.retryDelivery(retryable!.id);
    expect(rateLimited).toMatchObject({ status: "retryable_failure", nextAttemptAt: expect.any(String) });
    const terminal = await outbound.retryDelivery(retryable!.id);
    expect(terminal).toMatchObject({ status: "failed", nextAttemptAt: null });

    const cancellableReply = context.conversationRepository.postSystemMessage(projectA.id, { threadId: thread.id, bodyMarkdown: "private cancellation body" });
    const cancellable = context.providerRepository.upsertOutboundDelivery({ providerConnectionId: connection.id, channelBindingId: binding.id, externalChannelId: binding.externalChannelId, conversationThreadId: thread.id, conversationMessageId: cancellableReply.id, payload: { replyText: "private cancellation body" } });
    expect(await outbound.cancelDelivery(cancellable.id)).toMatchObject({ status: "cancelled" });
    context.providerRepository.updateConnection(connection.id, { enabled: false, status: "disabled" });
    const disabledReply = context.conversationRepository.postSystemMessage(projectA.id, { threadId: thread.id, bodyMarkdown: "disabled" });
    const disabled = context.providerRepository.upsertOutboundDelivery({ providerConnectionId: connection.id, channelBindingId: binding.id, externalChannelId: binding.externalChannelId, conversationThreadId: thread.id, conversationMessageId: disabledReply.id, payload: { replyText: "disabled" } });
    expect(await outbound.attemptDelivery(disabled.id)).toMatchObject({ status: "failed", lastError: expect.stringContaining("disabled") });
  });

  it("reopens durable state, recovers one stale lease, and resumes Discord once without duplicate messages", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T12:00:00.000Z"));
    const previousInMemory = process.env.VITEST_IN_MEMORY_DB;
    process.env.VITEST_IN_MEMORY_DB = "false";
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-chat-connectors-restart-"));
    tempDirs.push(tempDir);
    const dbPath = path.join(tempDir, "app.db");
    const firstStorage = new AppDbStorage(dbPath);
    const firstRepository = new ChatProviderRepository(firstStorage);
    const firstSecrets = createChatProviderSecretFixture(firstRepository);
    const conversations = new ConnectionChatRepository(firstStorage);
    const projects = new ProjectManagementRepository(firstStorage);
    const fixture = chatConnectorProviderFixtures.find((candidate) => candidate.kind === "discord")!;
    const project = projects.createProject({ name: "Approved restart fixture", sourceType: "local", sourceRef: path.join(tempDir, "project") });
    const connection = await firstSecrets.createConnection({ providerKind: "discord", displayName: "Restart Discord", bridgeMode: "webhook", status: "active", enabled: true, setup: fixture.setup, secrets: fixture.secrets });
    const binding = firstRepository.createChannelBinding({ providerConnectionId: connection.id, externalChannelId: fixture.channelId, externalChannelName: "restart", projectId: project.id });
    const inbound = firstRepository.recordInboundMessage({ providerConnectionId: connection.id, channelBindingId: binding.id, externalChannelId: binding.externalChannelId, externalMessageId: "restart-inbound" }).delivery;
    const message = conversations.postDashboardMessage(project.id, { title: "Restart", bodyMarkdown: "survives", metadata: { source: "chat_provider", inboundDeliveryId: inbound.id } });
    const reply = conversations.postSystemMessage(project.id, { threadId: message.threadId, bodyMarkdown: "reply survives" });
    const outbound = firstRepository.upsertOutboundDelivery({ providerConnectionId: connection.id, channelBindingId: binding.id, externalChannelId: binding.externalChannelId, conversationThreadId: message.threadId, conversationMessageId: reply.id, status: "retryable_failure", nextAttemptAt: "2026-07-14T11:59:00.000Z", payload: { replyText: "reply survives" } });
    expect(firstRepository.claimOutboundDelivery(outbound.id, { leaseOwner: "dead-worker", leaseDurationMs: 1, now: new Date("2026-07-14T11:59:00.000Z") })).toBeTruthy();
    firstRepository.createProviderSession({ providerConnectionId: connection.id, externalChannelId: connection.id, sessionKey: `connection:${connection.id}`, state: { status: "resumable", resumable: true, reconnectAttempt: 1, providerState: { sequence: 42, resumeGatewayUrl: "wss://gateway.discord.test" } } });
    firstStorage.close();

    const reopenedStorage = new AppDbStorage(dbPath);
    storages.push(reopenedStorage);
    const reopenedRepository = new ChatProviderRepository(reopenedStorage);
    const reopenedSecrets = createChatProviderSecretFixture(reopenedRepository);
    expect((await reopenedSecrets.resolveConnection(connection.id)).secrets).toEqual(fixture.secrets);
    const reopenedConversations = new ConnectionChatRepository(reopenedStorage);
    const persistedMessages = reopenedConversations.listMessages(message.threadId).map((entry) => entry.bodyMarkdown);
    expect(persistedMessages).toHaveLength(2);
    expect(persistedMessages).toEqual(expect.arrayContaining(["survives", "reply survives"]));
    expect(reopenedRepository.getDelivery(outbound.id)).toMatchObject({ status: "sending", nextAttemptAt: "2026-07-14T11:59:00.000Z" });
    const recovered = reopenedRepository.claimOutboundDeliveries({ leaseOwner: "restart-worker", leaseDurationMs: 30_000, limit: 2, now: new Date() });
    expect(recovered.map((entry) => entry.id)).toEqual([outbound.id]);
    expect(reopenedRepository.claimOutboundDeliveries({ leaseOwner: "competing-worker", leaseDurationMs: 30_000, limit: 2, now: new Date() })).toEqual([]);

    const run = vi.fn().mockResolvedValue({ outcome: "completed" });
    const sessions = new ChatProviderSessionRuntimeService({
      chatProviderRepository: reopenedRepository,
      chatProviderSecretService: reopenedSecrets,
      driver: { supports: () => true, run },
      jitterRatio: 0,
    });
    await sessions.start();
    await sessions.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    expect(reopenedRepository.listDeliveries({ direction: "inbound" })).toHaveLength(1);
    expect(reopenedRepository.listDeliveries({ direction: "outbound" })).toHaveLength(1);
    await sessions.stop();
    process.env.VITEST_IN_MEMORY_DB = previousInMemory;
  });
});

async function createHarness(): Promise<{
  tempDir: string;
  storage: AppDbStorage;
  providerRepository: ChatProviderRepository;
  conversationRepository: ConnectionChatRepository;
  projectRepository: ProjectManagementRepository;
  secretService: ReturnType<typeof createChatProviderSecretFixture>;
}> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-chat-connectors-e2e-"));
  tempDirs.push(tempDir);
  const storage = new AppDbStorage(path.join(tempDir, "app.db"));
  storages.push(storage);
  const providerRepository = new ChatProviderRepository(storage);
  return {
    tempDir,
    storage,
    providerRepository,
    conversationRepository: new ConnectionChatRepository(storage),
    projectRepository: new ProjectManagementRepository(storage),
    secretService: createChatProviderSecretFixture(providerRepository),
  };
}

function authenticateFixture(
  security: ChatProviderIngressSecurity,
  connection: ChatProviderConnectionInternalRecord,
  secrets: Record<string, unknown>,
  nonce: string,
): void {
  if (connection.bridgeMode === "webhook") {
    authenticateHmac(security, connection, secrets.webhookSecret as string, new Date(), nonce);
    return;
  }
  expect(security.verify(connection, {
    headers: { authorization: `Bearer ${String(secrets.bridgeApiKey)}`, "x-code-ux-timestamp": String(Date.now()), "x-code-ux-nonce": nonce },
    rawBody: "{}",
  })).toEqual({ authenticated: true, method: "bearer" });
}

function authenticateHmac(
  security: ChatProviderIngressSecurity,
  connection: ChatProviderConnectionInternalRecord,
  secret: string,
  now: Date,
  body = JSON.stringify({ fixture: true }),
): void {
  const timestamp = String(now.getTime());
  const signature = `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
  expect(security.verify(connection, {
    headers: { "x-code-ux-timestamp": timestamp, "x-code-ux-signature": signature },
    rawBody: body,
    now: new Date(),
  })).toEqual({ authenticated: true, method: "hmac" });
}

async function startRestBoundary(
  context: Awaited<ReturnType<typeof createHarness>>,
  verification: ChatProviderVerificationService,
  outbound: ChatProviderOutboundService,
): Promise<string> {
  const app = express();
  app.use(express.json());
  registerChatProviderRoutes(app, {
    chatProviderRepository: context.providerRepository,
    chatProviderSecretService: context.secretService,
    chatProviderVerificationService: verification,
    chatProviderOutboundService: outbound,
  } as DashboardDependencies);
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("REST acceptance boundary failed to listen.");
  return `http://127.0.0.1:${address.port}`;
}
