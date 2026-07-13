import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import express, { type Express } from "express";
import request, { type SuperTest, type Test } from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CustomNodeExecutionResult, CustomNodeManifest } from "../../../src/contracts/custom-node-types.js";
import type { HeadlessSecurityConfiguration } from "../../../src/contracts/headless-security-types.js";
import type { ManageNodeFlowsArgs } from "../../../src/contracts/internal-management-types.js";
import type { NodeFlowGraph, NodeFlowJsonObject, NodeFlowRunSummaryResponse } from "../../../src/contracts/node-flow-types.js";
import { EncryptedSqliteSecretStore } from "../../../src/infrastructure/security/encrypted-sqlite-secret-store.js";
import { ManagementToolHandler } from "../../../src/mcp/management-tool-handler.js";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { AutomationApprovalRepository } from "../../../src/repositories/automation-approval-repository.js";
import { AutomationCredentialRepository } from "../../../src/repositories/automation-credential-repository.js";
import { AutomationOutboxRepository } from "../../../src/repositories/automation-outbox-repository.js";
import { CustomNodeRepository } from "../../../src/repositories/custom-node-repository.js";
import { ExecutionRepository } from "../../../src/repositories/execution-repository.js";
import { NodeFlowRepository } from "../../../src/repositories/node-flow-repository.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { SettingsRepository } from "../../../src/repositories/settings-repository.js";
import { applyDashboardPreRouteMiddleware } from "../../../src/server/dashboard-middleware.js";
import type { DashboardDependencies, DashboardServerOptions } from "../../../src/server/dashboard-server.js";
import { registerHeadlessOperationsRoutes } from "../../../src/server/headless-operations-routes.js";
import { runWithMcpAgentContext } from "../../../src/server/mcp-agent-context.js";
import { registerNodeFlowRoutes } from "../../../src/server/node-flow-routes.js";
import { AutomationAuditExportService } from "../../../src/services/automation-audit-export-service.js";
import type { CommandResult } from "../../../src/services/cli-process-runner.js";
import { CredentialBroker } from "../../../src/services/credentials/credential-broker.js";
import type { KeyProvider } from "../../../src/services/credentials/key-provider.js";
import { CustomNodeBuildService } from "../../../src/services/custom-nodes/custom-node-build-service.js";
import { CustomNodeProjectService } from "../../../src/services/custom-nodes/custom-node-project-service.js";
import { CustomNodeRuntimeService } from "../../../src/services/custom-nodes/custom-node-runtime-service.js";
import { HeadlessAuthService } from "../../../src/services/headless-auth-service.js";
import { HeadlessOperationalReadinessService } from "../../../src/services/headless-operational-readiness-service.js";
import { NodeFlowRuntimeService } from "../../../src/services/node-flow-runtime-service.js";
import { NodeFlowService } from "../../../src/services/node-flow-service.js";
import { ApprovalService } from "../../../src/services/node-flows/approval-service.js";
import { EgressPolicyService } from "../../../src/services/node-flows/egress-policy-service.js";
import { NodeFlowPublicationService } from "../../../src/services/node-flows/node-flow-publication-service.js";
import { NodeFlowRecoveryService } from "../../../src/services/node-flows/node-flow-recovery-service.js";
import { OutboxService, type SideEffectProvider } from "../../../src/services/node-flows/outbox-service.js";
import { createLogger, type Logger } from "../../../src/shared/logging/logger.js";

interface JobFixture { id: string; name: string; selected: boolean }

const EXPECTED_RECORD_COUNT = 20;
const EXPECTED_SELECTED_MESSAGE_COUNT = 5;
const FIRST_SECRET_CANARY = "E2E_SECRET_CANARY";
const ROTATED_SECRET_CANARY = "ROTATED_SECRET_CANARY";
const SERVICE_TOKEN = "headless-automation-drill-token";
const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

const commandResult = (stdout = "", stderr = ""): CommandResult => ({ ok: true, code: 0, stdout, stderr });

function authenticated(agent: SuperTest<Test>, token = SERVICE_TOKEN): Test {
  return agent.set("Host", "localhost").set("X-Forwarded-Proto", "https")
    .set("X-Code-UX-Service-Id", "automation-drill").set("Authorization", `Bearer ${token}`);
}

function createHeadlessApp(input: {
  nodeFlowService: NodeFlowService;
  approvalService: ApprovalService;
  auditService: AutomationAuditExportService;
  readinessService: HeadlessOperationalReadinessService;
  security: HeadlessSecurityConfiguration;
  logger: Logger;
}): Express {
  const app = express();
  applyDashboardPreRouteMiddleware(app, {
    headlessAuthService: new HeadlessAuthService(input.security),
    automationAuditService: input.auditService,
  } as DashboardServerOptions, input.logger);
  app.get("/health", (_req, res) => res.json({ status: "UP" }));
  app.get("/ready", async (_req, res) => {
    const readiness = await input.readinessService.refresh();
    res.status(readiness.status === "READY" ? 200 : 503).json(readiness);
  });
  const dependencies = {
    nodeFlowService: input.nodeFlowService,
    approvalService: input.approvalService,
    automationAuditService: input.auditService,
    headlessReadinessService: input.readinessService,
  } as DashboardDependencies;
  registerNodeFlowRoutes(app, dependencies);
  registerHeadlessOperationsRoutes(app, dependencies);
  return app;
}

function createManagementHandler(nodeFlowService: NodeFlowService): ManagementToolHandler {
  return new ManagementToolHandler({
    projectManagementRepository: {}, sprintPreviewService: {}, executionRepository: {}, getDashboardSettings: () => ({}),
    executionControlService: {}, taskRerunService: {}, settingsRepository: {}, chatProviderRepository: {},
    agentPresetSyncService: {}, memoryService: {}, memoryPromotionService: {}, embeddingModelManager: {}, skillService: {},
    nodeFlowService, knowledgeService: {}, planningAgentService: {}, sprintIssueService: {},
  } as never);
}

async function manage(handler: ManagementToolHandler, args: ManageNodeFlowsArgs): Promise<Record<string, unknown>> {
  const response = await runWithMcpAgentContext("author-agent", "authoring-conversation", () => handler.handleManageNodeFlows(args));
  return JSON.parse(response.content[0]!.text) as Record<string, unknown>;
}

function resultOf<T>(envelope: Record<string, unknown>): T {
  return envelope.result as T;
}

async function waitForActiveRun(repository: NodeFlowRepository, flowId: string): Promise<string> {
  for (let count = 0; count < 100; count += 1) {
    const run = repository.listRuns(flowId).find((candidate) => candidate.status === "running");
    if (run && repository.listNodeAttempts(run.id).some((attempt) => attempt.status === "running")) return run.id;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("The fixture run did not become active.");
}

describe("credentialed automation authoring-to-execution", () => {
  it("runs the authenticated governed drill through the executable runtime and durable recovery boundaries", async () => {
    vi.stubEnv("VITEST_IN_MEMORY_DB", "false");
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-credentialed-e2e-"));
    temporaryDirectories.push(root);
    const databasePath = path.join(root, "app.db");
    let storage = new AppDbStorage(databasePath);
    const projectRepository = new ProjectManagementRepository(storage);
    const project = projectRepository.createProject({ name: "Approved local test project", sourceType: "local", sourceRef: root });
    let keyAvailable = true;
    const encryptionKey = Buffer.alloc(32, 7);
    const keyProvider: KeyProvider = {
      providerName: "mock-kms",
      health: async () => ({ available: keyAvailable, secure: true, provider: "mock-kms", keyId: keyAvailable ? "fixture-key" : null,
        keyVersion: keyAvailable ? 1 : null, reason: keyAvailable ? undefined : "mock key provider unavailable" }),
      getActiveKey: async () => ({ key: Buffer.from(encryptionKey), keyId: "fixture-key", version: 1 }),
      getKey: async () => ({ key: Buffer.from(encryptionKey), keyId: "fixture-key", version: 1 }),
    };
    const security: HeadlessSecurityConfiguration = {
      mode: "service_token", allowInsecureHttp: false, remoteCredentialManagement: true,
      serviceIdentities: [{ id: "automation-drill", displayName: "Automation drill fixture",
        tokenSha256: createHash("sha256").update(SERVICE_TOKEN).digest("hex"),
        roles: ["credential_admin", "automation_author", "automation_publisher", "automation_runner", "viewer"],
        projectIds: [project.id], enabled: true }],
    };
    const capturedLogs: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array) => {
      capturedLogs.push(String(chunk)); return true;
    }) as typeof process.stderr.write);
    const logger = createLogger({ consoleLogLevel: "warn", environment: "production", color: false });

    let audit = new AutomationAuditExportService(storage);
    let credentialRepository = new AutomationCredentialRepository(storage);
    let broker = new CredentialBroker(credentialRepository, new EncryptedSqliteSecretStore(credentialRepository, keyProvider), keyProvider, audit);
    const credential = await broker.create(project.id, {
      name: "Mock jobs API", kind: "http", value: FIRST_SECRET_CANARY, scope: "project", allowedProjectIds: [], capabilities: ["read"],
    });
    broker.bind(project.id, credential.id, { bindingKey: "jobs-api", requiredCapabilities: ["read"] });

    const fixtures = JSON.parse(await fs.readFile(path.resolve("tests/e2e/fixtures/headless-automation-records.json"), "utf8")) as JobFixture[];
    expect(fixtures).toHaveLength(EXPECTED_RECORD_COUNT);
    const selectedFixtures = fixtures.filter((record) => record.selected);
    expect(selectedFixtures).toHaveLength(EXPECTED_SELECTED_MESSAGE_COUNT);
    const jobApi = {
      list: vi.fn(async (secret: string): Promise<JobFixture[]> => {
        expect(secret).toBe(FIRST_SECRET_CANARY);
        return fixtures;
      }),
      authenticate: vi.fn(async (_secret: string, _version: number): Promise<void> => undefined),
      unavailable: vi.fn(async (): Promise<JobFixture[]> => { throw new Error("mock jobs provider unavailable"); }),
    };
    let emailUnavailable = false;
    const emailSends: Array<{ payload: NodeFlowJsonObject; idempotencyKey: string }> = [];
    const emailProvider: SideEffectProvider = {
      send: vi.fn(async (_effectType, payload, idempotencyKey) => {
        if (emailUnavailable) throw new Error("mock email provider unavailable");
        emailSends.push({ payload, idempotencyKey });
        return { providerMessageId: `mock-${idempotencyKey.slice(0, 16)}` };
      }),
    };

    const customNodeRepository = new CustomNodeRepository(storage);
    const customNodeProjectService = new CustomNodeProjectService();
    const buildCommandRunner = vi.fn(async (_command: string, args: string[]): Promise<CommandResult> => {
      if (args[0] === "image") return commandResult(`sha256:${"d".repeat(64)}\n`);
      if (args[0] === "run") return commandResult(JSON.stringify({ value: 1, executedAt: "2026-01-01T00:00:00.000Z" }));
      return commandResult();
    });
    const buildService = new CustomNodeBuildService({ repository: customNodeRepository, projectService: customNodeProjectService,
      commandRunner: buildCommandRunner, vulnerabilityAudit: async () => ({ passed: true, details: "mock audit passed" }) });

    let diagnosticMode = false;
    const runtimeCommandRunner = vi.fn(async (_command: string, _args: string[], _cwd: string, options: { stdinFile?: string }): Promise<CommandResult> => {
      const envelope = JSON.parse(await fs.readFile(options.stdinFile!, "utf8")) as { credentials: { jobs: string } };
      if (diagnosticMode) return commandResult(JSON.stringify({ leak: envelope.credentials.jobs }), `diagnostic=${envelope.credentials.jobs}`);
      const records = await jobApi.list(envelope.credentials.jobs);
      return commandResult(JSON.stringify({ records, recordCount: records.length, selected: records.filter((record) => record.selected) }), `jobs credential ${envelope.credentials.jobs}`);
    });
    let customRuntime = new CustomNodeRuntimeService({ repository: customNodeRepository, credentialBroker: broker,
      egressPolicyService: new EgressPolicyService(), featureEnabled: true, commandRunner: runtimeCommandRunner });
    let flowRepository = new NodeFlowRepository(storage);
    let executionRepository = new ExecutionRepository(storage);
    let approvalService = new ApprovalService(new AutomationApprovalRepository(storage), audit);
    let outboxService = new OutboxService(new AutomationOutboxRepository(storage), emailProvider, audit);
    let runtime = new NodeFlowRuntimeService({ nodeFlowRepository: flowRepository, executionRepository,
      projectManagementRepository: projectRepository, settingsRepository: new SettingsRepository(path.join(root, "settings.db")),
      credentialBroker: broker, approvalService, outboxService, customNodeRuntimeService: customRuntime, auditService: audit });
    let flowService = new NodeFlowService(flowRepository, runtime, broker, { repository: customNodeRepository,
      projectService: customNodeProjectService, buildService, resolveProjectRoot: () => root });
    let handler = createManagementHandler(flowService);

    const createdCustom = resultOf<{ node: { manifest: CustomNodeManifest } }>(await manage(handler, {
      action: "create_custom_node", projectId: project.id, nodeId: "fixture-record-selector", name: "Fixture record selector",
      sourceRevision: "fixture-r1", actor: "author-agent",
    } as ManageNodeFlowsArgs));
    const manifest: CustomNodeManifest = {
      ...createdCustom.node.manifest,
      capabilities: ["credentials.read", "clock.read"],
      credentials: [{ slot: "jobs", label: "Jobs API", required: true, allowedKinds: ["http"], requiredCapability: "read" }],
    };
    await manage(handler, { action: "update_custom_node", projectId: project.id, nodeId: "fixture-record-selector",
      manifest, sourceRevision: "fixture-r1" } as ManageNodeFlowsArgs);
    const customValidation = resultOf<{ status: string }>(await manage(handler, { action: "validate_custom_node",
      projectId: project.id, nodeId: "fixture-record-selector", actor: "author-agent",
      invocationId: "custom-build", correlationId: "authoring-conversation" } as ManageNodeFlowsArgs));
    expect(customValidation.status).toBe("passed");
    const customArtifact = buildService.publish("fixture-record-selector", "publisher-service");
    expect(customArtifact.manifest.nodeType).toBe("custom.fixture-record-selector");

    const sendNodes = selectedFixtures.map((record, index) => ({
      id: `send-${index}`, type: "email_send", title: `Send ${index + 1}`,
      data: { to: `{{nodes.select.selected.${index}.id}}@example.test`, subject: "Fixture follow-up",
        body: `Hello {{nodes.select.selected.${index}.name}}`, logicalItem: record.id },
    }));
    const graphV1: NodeFlowGraph = {
      nodes: [
        { id: "interrupt", type: "delay", title: "Interruptible boundary", data: { delayMs: 20 } },
        { id: "select", type: "custom.fixture-record-selector", title: "Read and select 20 fixtures",
          definition: { type: "custom.fixture-record-selector", version: 1 },
          credentialBindings: [{ slot: "jobs", credentialId: credential.id }] },
        ...sendNodes,
        { id: "output-v1", type: "output", title: "Output v1", data: { fields: { processed: "{{nodes.select.recordCount}}", delivered: 5, release: "v1" } } },
      ],
      edges: [
        { fromNodeId: "interrupt", toNodeId: "select" },
        { fromNodeId: "select", toNodeId: "send-0" },
        ...sendNodes.slice(0, -1).map((_node, index) => ({ fromNodeId: `send-${index}`, toNodeId: `send-${index + 1}` })),
        { fromNodeId: `send-${sendNodes.length - 1}`, toNodeId: "output-v1" },
      ],
    };
    const draftEnvelope = await manage(handler, { action: "create_draft", projectId: project.id,
      name: "Mocked candidate outreach", graph: graphV1 });
    const draft = resultOf<{ draft: { flowId: string; draftRevision: number; valid: boolean } }>(draftEnvelope).draft;
    expect(draft).toMatchObject({ valid: true, draftRevision: 1 });
    const graphV2 = structuredClone(graphV1);
    graphV2.nodes[graphV2.nodes.length - 1] = { id: "output-v2", type: "output", title: "Output v2",
      data: { fields: { processed: "{{nodes.select.recordCount}}", delivered: 5, release: "v2" } } };
    graphV2.edges[graphV2.edges.length - 1] = { fromNodeId: `send-${sendNodes.length - 1}`, toNodeId: "output-v2" };
    const patched = resultOf<{ draft: { draftRevision: number; valid: boolean } }>(await manage(handler, {
      action: "patch_draft", projectId: project.id, flowId: draft.flowId, draftRevision: 1, patch: { graph: graphV2 },
    })).draft;
    expect(patched).toMatchObject({ valid: true, draftRevision: 2 });
    expect(resultOf<{ draft: { valid: boolean } }>(await manage(handler, { action: "validate_draft", projectId: project.id, flowId: draft.flowId })).draft.valid).toBe(true);
    const publishArgs = { action: "publish" as const, projectId: project.id, flowId: draft.flowId,
      draftRevision: patched.draftRevision, publishedBy: "publisher-service", approval: { confirmed: true } };
    expect((await manage(handler, publishArgs)).approvalRequired).toBe(true);
    await manage(handler, publishArgs);
    const publicationV2 = flowRepository.getPublication(draft.flowId)!;
    expect(publicationV2.version).toBe(2);

    let readinessService = new HeadlessOperationalReadinessService({ credentialRepository, keyProvider, auditService: audit, security });
    let app = createHeadlessApp({ nodeFlowService: flowService, approvalService, auditService: audit, readinessService, security, logger });
    await request(app).get("/health").set("Host", "localhost").expect(200, { status: "UP" });
    await request(app).get("/ready").set("Host", "localhost").expect(200);
    await request(app).get(`/api/projects/${project.id}/node-flows`).set("Host", "localhost").set("X-Forwarded-Proto", "https").expect(401);
    await authenticated(request(app).get("/api/projects/unauthorized-project/node-flows")).expect(403, /not authorized/i);

    const interruptedController = new AbortController();
    const interruptedPromise = runtime.runFlow(project.id, draft.flowId, { fixtureCount: EXPECTED_RECORD_COUNT }, {
      signal: interruptedController.signal, executorId: "worker-before-restart", versionSelection: { mode: "pinned", version: 2 },
      triggerType: "mcp_management", triggerPayload: { initiatingAgentId: "author-agent", conversationId: "authoring-conversation" },
    }).catch(() => undefined);
    const runId = await waitForActiveRun(flowRepository, draft.flowId);
    flowRepository.updateRun(runId, { leaseExpiresAt: "2020-01-01T00:00:00.000Z" });
    expect(flowRepository.listNodeAttempts(runId)).toHaveLength(1);
    storage.close();
    interruptedController.abort(new Error("simulated process interruption"));
    void interruptedPromise;

    storage = new AppDbStorage(databasePath);
    audit = new AutomationAuditExportService(storage);
    credentialRepository = new AutomationCredentialRepository(storage);
    broker = new CredentialBroker(credentialRepository, new EncryptedSqliteSecretStore(credentialRepository, keyProvider), keyProvider, audit);
    flowRepository = new NodeFlowRepository(storage);
    executionRepository = new ExecutionRepository(storage);
    approvalService = new ApprovalService(new AutomationApprovalRepository(storage), audit);
    outboxService = new OutboxService(new AutomationOutboxRepository(storage), emailProvider, audit);
    customRuntime = new CustomNodeRuntimeService({ repository: new CustomNodeRepository(storage), credentialBroker: broker,
      egressPolicyService: new EgressPolicyService(), featureEnabled: true, commandRunner: runtimeCommandRunner });
    runtime = new NodeFlowRuntimeService({ nodeFlowRepository: flowRepository, executionRepository,
      projectManagementRepository: new ProjectManagementRepository(storage), settingsRepository: new SettingsRepository(path.join(root, "settings-restarted.db")),
      credentialBroker: broker, approvalService, outboxService, customNodeRuntimeService: customRuntime, auditService: audit });
    flowService = new NodeFlowService(flowRepository, runtime, broker);
    handler = createManagementHandler(flowService);
    readinessService = new HeadlessOperationalReadinessService({ credentialRepository, keyProvider, auditService: audit, security });
    app = createHeadlessApp({ nodeFlowService: flowService, approvalService, auditService: audit, readinessService, security, logger });

    const [recovered] = new NodeFlowRecoveryService(flowRepository).recover();
    expect(recovered).toMatchObject({ id: runId, version: 2, publicationId: publicationV2.id, status: "queued", leaseOwner: null });
    let summary = await runtime.resumeRun(project.id, runId, { executorId: "worker-after-restart" });
    expect(summary.run).toMatchObject({ id: runId, status: "approval_waiting", version: 2, publicationId: publicationV2.id });
    expect(flowRepository.listNodeAttempts(runId).filter((attempt) => attempt.nodeId === "interrupt")).toHaveLength(1);
    for (let index = 0; index < EXPECTED_SELECTED_MESSAGE_COUNT; index += 1) {
      const approvals = approvalService.listForRun(runId);
      const pending = approvals.find((approval) => approval.status === "pending");
      expect(pending).toMatchObject({ nodeId: `send-${index}`, logicalItem: selectedFixtures[index]!.id });
      await expect(runtime.resumeApproval(project.id, pending!.id, runId)).rejects.toThrow(/still pending/i);
      approvalService.approve(pending!.id, "approver-service");
      summary = await runtime.resumeApproval(project.id, pending!.id, runId);
    }
    expect(summary.run).toMatchObject({ id: runId, status: "succeeded", version: 2, publicationId: publicationV2.id });
    expect(summary.output).toMatchObject({ processed: "20", delivered: 5, release: "v2" });
    expect(jobApi.list).toHaveBeenCalledTimes(1);
    expect(emailSends).toHaveLength(EXPECTED_SELECTED_MESSAGE_COUNT);
    const idempotencyKeys = emailSends.map((send) => send.idempotencyKey);
    expect(new Set(idempotencyKeys)).toHaveLength(EXPECTED_SELECTED_MESSAGE_COUNT);
    const mainOutbox = new AutomationOutboxRepository(storage).listForRun(runId);
    expect(mainOutbox).toHaveLength(EXPECTED_SELECTED_MESSAGE_COUNT);
    expect(mainOutbox.every((item) => item.status === "sent" && idempotencyKeys.includes(item.idempotencyKey))).toBe(true);
    expect(flowRepository.listNodeAttempts(runId).every((attempt) => attempt.attemptNumber === 1)).toBe(true);

    const publicationService = new NodeFlowPublicationService(flowRepository);
    expect(publicationService.resolve(draft.flowId, { mode: "pinned", version: 2 }).id).toBe(publicationV2.id);
    const rollbackArgs = { action: "rollback" as const, projectId: project.id, flowId: draft.flowId,
      version: 1, draftRevision: 2, approval: { confirmed: true } };
    expect((await manage(handler, rollbackArgs)).approvalRequired).toBe(true);
    const rollbackDraft = resultOf<{ draft: { draftRevision: number } }>(await manage(handler, rollbackArgs)).draft;
    const rollbackPublish = { action: "publish" as const, projectId: project.id, flowId: draft.flowId,
      draftRevision: rollbackDraft.draftRevision, publishedBy: "publisher-service", approval: { confirmed: true } };
    await manage(handler, rollbackPublish); await manage(handler, rollbackPublish);
    const latestAfterRollback = publicationService.resolve(draft.flowId, { mode: "latest_published" });
    expect(latestAfterRollback.version).toBe(3);
    expect(latestAfterRollback.graph.nodes.some((node) => node.id === "output-v1")).toBe(true);
    expect(flowRepository.getRun(runId)).toMatchObject({ version: 2, publicationId: publicationV2.id });

    await expect(customRuntime.execute({ projectId: project.id, nodeType: "custom.fixture-record-selector", version: 1,
      input: {}, config: {}, credentialBindings: { jobs: "missing-credential" }, workspaceId: "missing", invocationId: "missing", correlationId: "missing" }))
      .rejects.toThrow(/credential is missing/i);
    await broker.rotate(project.id, credential.id, { value: ROTATED_SECRET_CANARY, expectedVersion: credential.version });
    const rotated = await broker.resolve({ projectId: project.id, bindingKey: "jobs-api", requiredCapabilities: ["read"], allowedKinds: ["http"], workspaceId: "rotation" });
    await jobApi.authenticate(rotated.value, rotated.version);
    expect(jobApi.authenticate).toHaveBeenCalledWith(ROTATED_SECRET_CANARY, 2);
    diagnosticMode = true;
    const diagnostics: CustomNodeExecutionResult = await customRuntime.execute({ projectId: project.id,
      nodeType: "custom.fixture-record-selector", version: 1, input: {}, config: {}, credentialBindings: { jobs: credential.id },
      workspaceId: "diagnostics", invocationId: "diagnostics", correlationId: "diagnostics" });
    expect(JSON.stringify(diagnostics)).not.toContain(ROTATED_SECRET_CANARY);
    expect(JSON.stringify(diagnostics)).toContain("[REDACTED]");
    diagnosticMode = false;
    await expect(jobApi.unavailable()).rejects.toThrow(/jobs provider unavailable/i);
    emailUnavailable = true;
    const failedDelivery = await outboxService.dispatch({ projectId: project.id, flowId: draft.flowId,
      publicationId: latestAfterRollback.id, runId, nodeId: "send-unavailable", logicalItem: "provider-unavailable",
      effectType: "email", payload: { to: "nobody@example.test" } });
    expect(failedDelivery).toMatchObject({ status: "failed", attemptCount: 1 });
    broker.revoke(project.id, credential.id, { expectedVersion: rotated.version });
    await expect(customRuntime.execute({ projectId: project.id, nodeType: "custom.fixture-record-selector", version: 1,
      input: {}, config: {}, credentialBindings: { jobs: credential.id }, workspaceId: "revoked", invocationId: "revoked", correlationId: "revoked" }))
      .rejects.toThrow(/not active/i);

    keyAvailable = false;
    await request(app).get("/health").set("Host", "localhost").expect(200, { status: "UP" });
    await request(app).get("/ready").set("Host", "localhost").expect(503, /mock key provider unavailable/i);
    await expect(readinessService.assertStartupReady()).rejects.toThrow(/key recovery is unavailable/i);
    logger.error("credentialed automation diagnostic", { apiKey: FIRST_SECRET_CANARY, authorization: `Bearer ${ROTATED_SECRET_CANARY}` });
    const auditResponse = await authenticated(request(app).get(`/api/admin/audit/export?projectId=${project.id}`)).expect(200);
    const invocations = executionRepository.listExecutionInvocations({ projectId: project.id, limit: 100 });
    const invocationMessages = invocations.flatMap((invocation) => executionRepository.listExecutionInvocationMessages(invocation.id));
    const observable = JSON.stringify({
      mcpResponses: [draftEnvelope, customValidation, patched, rollbackDraft],
      graphs: [flowRepository.getFlow(draft.flowId)?.graph, latestAfterRollback.graph],
      attempts: flowRepository.listNodeAttempts(runId), invocationMessages, audit: auditResponse.text,
      logs: capturedLogs, diagnostics, runSummaries: [summary, flowRepository.getRun(runId)],
    });
    expect(observable).not.toContain(FIRST_SECRET_CANARY);
    expect(observable).not.toContain(ROTATED_SECRET_CANARY);
    expect(observable).not.toContain(SERVICE_TOKEN);
    expect(observable).toContain("[REDACTED]");
    storage.close();
  });
});
