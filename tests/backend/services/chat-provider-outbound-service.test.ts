import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ChatProviderRepository } from "../../../src/repositories/chat-provider-repository.js";
import { ConnectionChatRepository } from "../../../src/repositories/connection-chat-repository.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { createChatProviderSecretFixture } from "../helpers/chat-provider-secret-fixture.js";
import type { ChatProviderSecretService } from "../../../src/services/chat-provider-secret-service.js";
import {
  ChatProviderOutboundAdapterError,
  type ChatProviderOutboundAdapter,
} from "../../../src/services/chat-provider-adapters.js";
import { ChatProviderOutboundService } from "../../../src/services/chat-provider-outbound-service.js";
import type { ConversationMessageRecord, ConversationThreadRecord } from "../../../src/contracts/connection-chat-types.js";

const tempDirs: string[] = [];
const openStorages: AppDbStorage[] = [];
const servers: Server[] = [];

afterEach(async () => {
  vi.useRealTimers();
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const storage of openStorages.splice(0).reverse()) {
    storage.close();
  }
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("ChatProviderOutboundService", () => {
  it("posts sanitized external replies to configured webhook bridges and records delivery", async () => {
    const context = await createContext();
    const requests: Array<{ body: any; authorization: string | undefined }> = [];
    const bridge = await startJsonBridge((req, res, body) => {
      requests.push({ body, authorization: req.headers.authorization });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ externalMessageId: "slack-out-1", providerSecret: "response-secret-token" }));
    });
    const project = context.projectRepository.createProject({
      name: "Outbound Service Project",
      sourceType: "local",
      sourceRef: path.join(context.tempDir, "repo"),
    });
    const connection = await context.secretService.createConnection({
      providerKind: "slack",
      displayName: "Slack webhook",
      bridgeMode: "webhook",
      status: "active",
      setup: { eventsUrl: bridge.url },
      secrets: { signingSecret: "super-secret" },
    });
    const binding = context.providerRepository.createChannelBinding({
      providerConnectionId: connection.id,
      externalChannelId: "C123",
      externalChannelName: "triage",
      projectId: project.id,
    });
    const inbound = context.providerRepository.recordInboundMessage({
      providerConnectionId: connection.id,
      channelBindingId: binding.id,
      externalChannelId: "C123",
      externalMessageId: "slack-in-1",
      payload: { raw: { botToken: "must-redact" } },
    }).delivery;
    const userMessage = context.conversationRepository.postDashboardMessage(project.id, {
      title: "External",
      bodyMarkdown: "status",
      metadata: {
        source: "chat_provider",
        inboundDeliveryId: inbound.id,
        token: "metadata-secret",
        suppressRichWidgets: true,
      },
    });
    const thread = context.conversationRepository.getThread(userMessage.threadId);
    const replyMessage = context.conversationRepository.postSystemMessage(project.id, {
      threadId: thread.id,
      bodyMarkdown: [
        "Build passed.",
        "",
        "```codeux:status",
        JSON.stringify({ title: "Build", items: [{ label: "Lint", state: "ok" }] }),
        "```",
        "```codeux:agent",
        JSON.stringify({ emotion: "excited", animation: "hyped", caption: "All green!", durationMs: 2500 }),
        "```",
      ].join("\n"),
      metadata: {
        agentEffect: { emotion: "excited", animation: "hyped", caption: "All green!", durationMs: 2500 },
      },
    });

    const service = new ChatProviderOutboundService({
      chatProviderRepository: context.providerRepository,
      chatProviderSecretService: context.secretService,
    });

    const delivery = await service.deliverReply({
      projectId: project.id,
      thread,
      triggeringMessage: userMessage,
      replyMessage,
    });

    expect(delivery).toMatchObject({
      status: "delivered",
      attemptCount: 1,
      externalMessageId: "slack-out-1",
      conversationThreadId: thread.id,
      conversationMessageId: replyMessage.id,
      lastError: null,
    });
    expect(requests).toHaveLength(1);
    expect(requests[0].authorization).toBe("Bearer super-secret");
    expect(requests[0].body).toMatchObject({
      providerKind: "slack",
      channelId: "C123",
      threadId: thread.id,
      conversationMessageId: replyMessage.id,
      replyToExternalMessageId: "slack-in-1",
    });
    expect(requests[0].body.replyText).toContain("Build passed.");
    expect(requests[0].body.replyText).toContain("Build\n- Lint: ok");
    expect(requests[0].body.replyText).not.toContain("codeux:status");
    expect(requests[0].body.replyText).not.toContain("codeux:agent");
    expect(JSON.stringify(requests[0].body)).not.toContain("agentEffect");
    expect(JSON.stringify(requests[0].body)).not.toContain("All green!");
    expect(JSON.stringify(delivery?.payload)).not.toContain("super-secret");
    expect(JSON.stringify(delivery?.payload)).not.toContain("metadata-secret");
    expect(JSON.stringify(delivery?.payload)).not.toContain("response-secret-token");
  });

  it("uses Managed bridge URLs without provider SDK dependencies", async () => {
    const context = await createContext();
    const bridge = await startJsonBridge((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ messageId: "telegram-managed_bridge-1" }));
    });
    const fixture = await createOutboundFixture(context, {
      bridgeMode: "managed_bridge",
      providerKind: "telegram",
      setup: { bridgeUrl: bridge.url },
      secrets: { bridgeApiKey: "managed_bridge-secret" },
    });
    const service = new ChatProviderOutboundService({
      chatProviderRepository: context.providerRepository,
      chatProviderSecretService: context.secretService,
    });

    const delivery = await service.deliverReply(fixture);

    expect(delivery).toMatchObject({
      status: "delivered",
      externalMessageId: "telegram-managed_bridge-1",
    });
  });

  it("executes configured native bridge commands for local chat bridges", async () => {
    const context = await createContext();
    const scriptPath = path.join(context.tempDir, "native-bridge.cjs");
    await fs.writeFile(scriptPath, [
      "let input = '';",
      "process.stdin.on('data', (chunk) => input += chunk);",
      "process.stdin.on('end', () => {",
      "  const payload = JSON.parse(input);",
      "  process.stdout.write(JSON.stringify({ externalMessageId: `native-${payload.channelId}` }));",
      "});",
    ].join("\n"));
    const fixture = await createOutboundFixture(context, {
      bridgeMode: "native_bridge",
      providerKind: "imessage",
      setup: { command: `node ${JSON.stringify(scriptPath)}` },
      secrets: { bridgeToken: "native-secret" },
    });
    const service = new ChatProviderOutboundService({
      chatProviderRepository: context.providerRepository,
      chatProviderSecretService: context.secretService,
    });

    const delivery = await service.deliverReply(fixture);

    expect(delivery).toMatchObject({
      status: "delivered",
      externalMessageId: "native-external-channel",
    });
  });

  it("records retryable failures with backoff and retries due deliveries", async () => {
    vi.useFakeTimers();
    let now = new Date("2026-07-07T00:00:00.000Z");
    const context = await createContext();
    const fixture = await createOutboundFixture(context, {
      bridgeMode: "webhook",
      providerKind: "discord",
      setup: { gatewayUrl: "https://bridge.example.test/send" },
      secrets: { botToken: "bot-secret" },
    });
    const adapter: ChatProviderOutboundAdapter = {
      send: vi.fn()
        .mockRejectedValueOnce(new ChatProviderOutboundAdapterError("HTTP 503 from bridge with token=secret", true, 503))
        .mockResolvedValueOnce({ externalMessageId: "discord-out-1" }),
    };
    const service = new ChatProviderOutboundService({
      chatProviderRepository: context.providerRepository,
      chatProviderSecretService: context.secretService,
      adapter,
      initialBackoffMs: 1_000,
      now: () => now,
      random: () => 0.5,
    });

    const retryable = await service.deliverReply(fixture);

    expect(retryable).toMatchObject({
      status: "retryable_failure",
      attemptCount: 1,
      lastError: expect.not.stringContaining("secret"),
    });
    expect(retryable?.payload?.delivery).toMatchObject({
      state: "retryable_failure",
      retryable: true,
      nextAttemptAt: "2026-07-07T00:00:01.000Z",
    });
    expect(await service.processDueRetries()).toEqual([]);

    now = new Date("2026-07-07T00:00:02.000Z");
    const retried = await service.processDueRetries();

    expect(retried).toHaveLength(1);
    expect(retried[0]).toMatchObject({
      status: "delivered",
      attemptCount: 2,
      externalMessageId: "discord-out-1",
    });
  });

  it("uses the provider Retry-After delay instead of exponential backoff", async () => {
    const now = new Date("2026-07-07T00:00:00.000Z");
    const context = await createContext();
    const fixture = await createOutboundFixture(context, {
      bridgeMode: "official_api",
      providerKind: "slack",
      setup: { appId: "A-test", workspaceId: "T-test" },
      secrets: { botToken: "xoxb-test-token-value", signingSecret: "signing-secret" },
    });
    const adapter: ChatProviderOutboundAdapter = {
      send: vi.fn().mockRejectedValue(new ChatProviderOutboundAdapterError(
        "Slack rate limited the request.",
        true,
        429,
        42_000,
      )),
    };
    const service = new ChatProviderOutboundService({
      chatProviderRepository: context.providerRepository,
      adapter,
      initialBackoffMs: 1_000,
      now: () => now,
    });

    const retryable = await service.deliverReply(fixture);

    expect(retryable).toMatchObject({ status: "retryable_failure" });
    expect(retryable?.payload?.delivery).toMatchObject({
      retryable: true,
      nextAttemptAt: "2026-07-07T00:00:42.000Z",
    });
  });

  it("processes due retries as a single flight when calls overlap", async () => {
    let now = new Date("2026-07-07T00:00:00.000Z");
    const context = await createContext();
    const fixture = await createOutboundFixture(context, {
      bridgeMode: "webhook",
      providerKind: "discord",
      setup: { gatewayUrl: "https://bridge.example.test/send" },
      secrets: { botToken: "bot-secret" },
    });
    let resolveRetry: ((value: { externalMessageId: string }) => void) | null = null;
    const retryPromise = new Promise<{ externalMessageId: string }>((resolve) => {
      resolveRetry = resolve;
    });
    const adapter: ChatProviderOutboundAdapter = {
      send: vi.fn()
        .mockRejectedValueOnce(new ChatProviderOutboundAdapterError("HTTP 503", true, 503))
        .mockImplementationOnce(() => retryPromise),
    };
    const service = new ChatProviderOutboundService({
      chatProviderRepository: context.providerRepository,
      chatProviderSecretService: context.secretService,
      adapter,
      initialBackoffMs: 1_000,
      now: () => now,
    });

    await service.deliverReply(fixture);
    now = new Date("2026-07-07T00:00:02.000Z");

    const first = service.processDueRetries();
    const second = service.processDueRetries();
    await vi.waitFor(() => expect(adapter.send).toHaveBeenCalledTimes(2));
    resolveRetry?.({ externalMessageId: "discord-single-flight" });
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(adapter.send).toHaveBeenCalledTimes(2);
    expect(firstResult).toHaveLength(1);
    expect(secondResult).toHaveLength(1);
    expect(firstResult[0]).toMatchObject({
      status: "delivered",
      attemptCount: 2,
      externalMessageId: "discord-single-flight",
    });
    expect(secondResult[0].id).toBe(firstResult[0].id);
  });

  it("allows only one service instance to hold the delivery lease", async () => {
    let now = new Date("2026-07-07T00:00:00.000Z");
    const context = await createContext();
    const fixture = await createOutboundFixture(context, {
      bridgeMode: "webhook",
      providerKind: "discord",
      setup: { gatewayUrl: "https://bridge.example.test/send" },
      secrets: { botToken: "bot-secret" },
    });
    const initial = new ChatProviderOutboundService({
      chatProviderRepository: context.providerRepository,
      chatProviderSecretService: context.secretService,
      adapter: { send: vi.fn().mockRejectedValue(new ChatProviderOutboundAdapterError("retry", true)) },
      initialBackoffMs: 1_000,
      random: () => 0.5,
      now: () => now,
    });
    await initial.deliverReply(fixture);
    now = new Date("2026-07-07T00:00:02.000Z");

    let resolveSend: ((value: { externalMessageId: string }) => void) | null = null;
    const send = new Promise<{ externalMessageId: string }>((resolve) => { resolveSend = resolve; });
    const firstAdapter: ChatProviderOutboundAdapter = { send: vi.fn().mockReturnValue(send) };
    const secondAdapter: ChatProviderOutboundAdapter = {
      send: vi.fn().mockResolvedValue({ externalMessageId: "should-not-send" }),
    };
    const first = new ChatProviderOutboundService({
      chatProviderRepository: context.providerRepository,
      chatProviderSecretService: context.secretService,
      adapter: firstAdapter,
      now: () => now,
    });
    const second = new ChatProviderOutboundService({
      chatProviderRepository: context.providerRepository,
      chatProviderSecretService: context.secretService,
      adapter: secondAdapter,
      now: () => now,
    });

    const firstPoll = first.processDueRetries();
    await vi.waitFor(() => expect(firstAdapter.send).toHaveBeenCalledTimes(1));
    expect(await second.processDueRetries()).toEqual([]);
    resolveSend?.({ externalMessageId: "leased-once" });

    await expect(firstPoll).resolves.toEqual([
      expect.objectContaining({ status: "delivered", externalMessageId: "leased-once" }),
    ]);
    expect(secondAdapter.send).not.toHaveBeenCalled();
  });

  it("makes manual cancellation terminal during an in-flight send", async () => {
    const context = await createContext();
    const fixture = await createOutboundFixture(context, {
      bridgeMode: "webhook",
      providerKind: "discord",
      setup: { gatewayUrl: "https://bridge.example.test/send" },
      secrets: { botToken: "bot-secret" },
    });
    let started: (() => void) | null = null;
    const sendStarted = new Promise<void>((resolve) => { started = resolve; });
    const adapter: ChatProviderOutboundAdapter = {
      send: vi.fn((sendContext) => new Promise((_resolve, reject) => {
        started?.();
        sendContext.signal?.addEventListener("abort", () => reject(
          new ChatProviderOutboundAdapterError("cancelled", false, undefined, undefined, "cancelled"),
        ), { once: true });
      })),
    };
    const service = new ChatProviderOutboundService({
      chatProviderRepository: context.providerRepository,
      chatProviderSecretService: context.secretService,
      adapter,
    });

    const deliveryPromise = service.deliverReply(fixture);
    await sendStarted;
    const sending = context.providerRepository.listOutboundDeliveries()[0];
    const cancelled = await service.cancelDelivery(sending.id);
    const settled = await deliveryPromise;

    expect(cancelled).toMatchObject({ status: "cancelled", leaseOwner: null, nextAttemptAt: null });
    expect(settled).toMatchObject({ id: sending.id, status: "cancelled" });
    expect(await service.processDueRetries()).toEqual([]);
  });

  it("recovers one stale sending lease on startup and starts only once", async () => {
    let now = new Date("2026-07-07T00:00:00.000Z");
    const context = await createContext();
    const fixture = await createOutboundFixture(context, {
      bridgeMode: "webhook",
      providerKind: "discord",
      setup: { gatewayUrl: "https://bridge.example.test/send" },
      secrets: { botToken: "bot-secret" },
    });
    const initial = new ChatProviderOutboundService({
      chatProviderRepository: context.providerRepository,
      chatProviderSecretService: context.secretService,
      adapter: { send: vi.fn().mockRejectedValue(new ChatProviderOutboundAdapterError("retry", true)) },
      initialBackoffMs: 1_000,
      random: () => 0.5,
      now: () => now,
    });
    const retryable = await initial.deliverReply(fixture);
    now = new Date("2026-07-07T00:00:02.000Z");
    expect(context.providerRepository.claimOutboundDelivery(retryable!.id, {
      leaseOwner: "stale-worker",
      leaseDurationMs: 1_000,
      now,
    })).toMatchObject({ status: "sending", leaseOwner: "stale-worker" });

    now = new Date("2026-07-07T00:00:04.000Z");
    const adapter: ChatProviderOutboundAdapter = {
      send: vi.fn().mockResolvedValue({ externalMessageId: "recovered-once" }),
    };
    const recovered = new ChatProviderOutboundService({
      chatProviderRepository: context.providerRepository,
      chatProviderSecretService: context.secretService,
      adapter,
      pollIntervalMs: 60_000,
      now: () => now,
    });

    await recovered.start();
    await recovered.start();

    expect(adapter.send).toHaveBeenCalledTimes(1);
    expect(context.providerRepository.getDelivery(retryable!.id)).toMatchObject({
      status: "delivered",
      leaseOwner: null,
      externalMessageId: "recovered-once",
    });
    await recovered.stop();
  });

  it("aborts in-flight work on shutdown and releases its lease", async () => {
    const context = await createContext();
    const fixture = await createOutboundFixture(context, {
      bridgeMode: "webhook",
      providerKind: "discord",
      setup: { gatewayUrl: "https://bridge.example.test/send" },
      secrets: { botToken: "bot-secret" },
    });
    let started: (() => void) | null = null;
    const sendStarted = new Promise<void>((resolve) => { started = resolve; });
    const adapter: ChatProviderOutboundAdapter = {
      send: vi.fn((sendContext) => new Promise((_resolve, reject) => {
        started?.();
        sendContext.signal?.addEventListener("abort", () => reject(
          new ChatProviderOutboundAdapterError("shutdown", false, undefined, undefined, "cancelled"),
        ), { once: true });
      })),
    };
    const service = new ChatProviderOutboundService({
      chatProviderRepository: context.providerRepository,
      chatProviderSecretService: context.secretService,
      adapter,
    });

    const deliveryPromise = service.deliverReply(fixture);
    await sendStarted;
    await service.stop();
    const delivery = await deliveryPromise;

    expect(delivery).toMatchObject({ status: "retryable_failure", leaseOwner: null });
  });
});

async function createContext(): Promise<{
  tempDir: string;
  storage: AppDbStorage;
  projectRepository: ProjectManagementRepository;
  providerRepository: ChatProviderRepository;
  conversationRepository: ConnectionChatRepository;
  secretService: ChatProviderSecretService;
}> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-chat-provider-outbound-"));
  tempDirs.push(tempDir);
  const storage = new AppDbStorage(path.join(tempDir, "app.db"));
  openStorages.push(storage);
  const providerRepository = new ChatProviderRepository(storage);
  return {
    tempDir,
    storage,
    projectRepository: new ProjectManagementRepository(storage),
    providerRepository,
    conversationRepository: new ConnectionChatRepository(storage),
    secretService: createChatProviderSecretFixture(providerRepository),
  };
}

async function createOutboundFixture(
  context: Awaited<ReturnType<typeof createContext>>,
  options: {
    bridgeMode: "managed_bridge" | "webhook" | "native_bridge" | "official_api";
    providerKind: "telegram" | "discord" | "imessage" | "slack";
    setup: Record<string, unknown>;
    secrets: Record<string, unknown>;
  },
): Promise<{
  projectId: string;
  thread: ConversationThreadRecord;
  triggeringMessage: ConversationMessageRecord;
  replyMessage: ConversationMessageRecord;
}> {
  const project = context.projectRepository.createProject({
    name: "Outbound Fixture Project",
    sourceType: "local",
    sourceRef: path.join(context.tempDir, "fixture-repo"),
  });
  const connection = await context.secretService.createConnection({
    providerKind: options.providerKind,
    displayName: "Fixture bridge",
    bridgeMode: options.bridgeMode,
    status: "active",
    setup: options.setup,
    secrets: options.secrets,
  });
  const binding = context.providerRepository.createChannelBinding({
    providerConnectionId: connection.id,
    externalChannelId: "external-channel",
    externalChannelName: "external",
    projectId: project.id,
  });
  const inbound = context.providerRepository.recordInboundMessage({
    providerConnectionId: connection.id,
    channelBindingId: binding.id,
    externalChannelId: binding.externalChannelId,
    externalMessageId: "external-in-1",
  }).delivery;
  const triggeringMessage = context.conversationRepository.postDashboardMessage(project.id, {
    title: "External fixture",
    bodyMarkdown: "hello",
    metadata: {
      source: "chat_provider",
      inboundDeliveryId: inbound.id,
      suppressRichWidgets: true,
    },
  });
  const thread = context.conversationRepository.getThread(triggeringMessage.threadId);
  const replyMessage = context.conversationRepository.postSystemMessage(project.id, {
    threadId: thread.id,
    bodyMarkdown: "Bridge reply",
  });
  return {
    projectId: project.id,
    thread,
    triggeringMessage,
    replyMessage,
  };
}

async function startJsonBridge(
  handler: (req: IncomingMessage, res: ServerResponse, body: unknown) => void,
): Promise<{ url: string }> {
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    const body = raw ? JSON.parse(raw) as unknown : null;
    handler(req, res, body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to start test bridge server.");
  }
  return { url: `http://127.0.0.1:${address.port}/send` };
}
