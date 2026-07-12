import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import express, { type Express } from "express";
import request, { type SuperTest, type Test } from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NodeFlowJsonObject } from "../../../src/contracts/node-flow-types.js";
import type { HeadlessSecurityConfiguration } from "../../../src/contracts/headless-security-types.js";
import { EncryptedSqliteSecretStore } from "../../../src/infrastructure/security/encrypted-sqlite-secret-store.js";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { AutomationApprovalRepository } from "../../../src/repositories/automation-approval-repository.js";
import { AutomationCredentialRepository } from "../../../src/repositories/automation-credential-repository.js";
import { AutomationOutboxRepository } from "../../../src/repositories/automation-outbox-repository.js";
import { CustomNodeRepository } from "../../../src/repositories/custom-node-repository.js";
import { NodeFlowRepository } from "../../../src/repositories/node-flow-repository.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { applyDashboardPreRouteMiddleware } from "../../../src/server/dashboard-middleware.js";
import type { DashboardDependencies, DashboardServerOptions } from "../../../src/server/dashboard-server.js";
import { registerHeadlessOperationsRoutes } from "../../../src/server/headless-operations-routes.js";
import { registerNodeFlowRoutes } from "../../../src/server/node-flow-routes.js";
import { AutomationAuditExportService } from "../../../src/services/automation-audit-export-service.js";
import type { CommandResult } from "../../../src/services/cli-process-runner.js";
import { CredentialBroker } from "../../../src/services/credentials/credential-broker.js";
import type { KeyProvider } from "../../../src/services/credentials/key-provider.js";
import { CustomNodeBuildService } from "../../../src/services/custom-nodes/custom-node-build-service.js";
import { CustomNodeProjectService } from "../../../src/services/custom-nodes/custom-node-project-service.js";
import { HeadlessAuthService } from "../../../src/services/headless-auth-service.js";
import { HeadlessOperationalReadinessService } from "../../../src/services/headless-operational-readiness-service.js";
import { NodeFlowService } from "../../../src/services/node-flow-service.js";
import { ApprovalRequiredError, ApprovalService } from "../../../src/services/node-flows/approval-service.js";
import { NodeFlowPublicationService } from "../../../src/services/node-flows/node-flow-publication-service.js";
import { NodeFlowQueueService } from "../../../src/services/node-flows/node-flow-queue-service.js";
import { NodeFlowRecoveryService } from "../../../src/services/node-flows/node-flow-recovery-service.js";
import { MockSideEffectProvider, OutboxService, type SideEffectProvider } from "../../../src/services/node-flows/outbox-service.js";
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
  return agent
    .set("Host", "localhost")
    .set("X-Forwarded-Proto", "https")
    .set("X-Code-UX-Service-Id", "automation-drill")
    .set("Authorization", `Bearer ${token}`);
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
  const authService = new HeadlessAuthService(input.security);
  applyDashboardPreRouteMiddleware(app, {
    headlessAuthService: authService,
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

describe("credentialed automation authoring-to-execution", () => {
  it("runs the complete mocked drill with authenticated authoring, restart recovery, rotation, and rollback", async () => {
    vi.stubEnv("VITEST_IN_MEMORY_DB", "false");
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-credentialed-e2e-"));
    temporaryDirectories.push(root);
    const databasePath = path.join(root, "app.db");
    let storage = new AppDbStorage(databasePath);
    const project = new ProjectManagementRepository(storage).createProject({
      name: "Approved local test project",
      sourceType: "local",
      sourceRef: root,
    });
    let keyAvailable = true;
    const key = Buffer.alloc(32, 7);
    const keyProvider: KeyProvider = {
      providerName: "mock-kms",
      health: async () => ({
        available: keyAvailable,
        secure: true,
        provider: "mock-kms",
        keyId: keyAvailable ? "fixture-key" : null,
        keyVersion: keyAvailable ? 1 : null,
        reason: keyAvailable ? undefined : "mock key provider unavailable",
      }),
      getActiveKey: async () => ({ key: Buffer.from(key), keyId: "fixture-key", version: 1 }),
      getKey: async () => ({ key: Buffer.from(key), keyId: "fixture-key", version: 1 }),
    };
    const security: HeadlessSecurityConfiguration = {
      mode: "service_token",
      serviceIdentities: [{
        id: "automation-drill",
        displayName: "Automation drill fixture",
        tokenSha256: createHash("sha256").update(SERVICE_TOKEN).digest("hex"),
        roles: ["credential_admin", "automation_author", "automation_publisher", "automation_runner", "viewer"],
        projectIds: [project.id],
        enabled: true,
      }],
      allowInsecureHttp: false,
      remoteCredentialManagement: true,
    };
    const capturedLogs: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array) => {
      capturedLogs.push(String(chunk));
      return true;
    }) as typeof process.stderr.write);
    const logger = createLogger({ consoleLogLevel: "warn", environment: "production", color: false });

    let audit = new AutomationAuditExportService(storage);
    let credentialRepository = new AutomationCredentialRepository(storage);
    let broker = new CredentialBroker(
      credentialRepository,
      new EncryptedSqliteSecretStore(credentialRepository, keyProvider),
      keyProvider,
      audit,
    );

    // Secrets are supplied outside the agent-authored graph and never enter route payloads.
    const credential = await broker.create(project.id, {
      name: "Mock jobs and email API",
      kind: "http",
      value: FIRST_SECRET_CANARY,
      capabilities: ["read", "write"],
    });
    broker.bind(project.id, credential.id, "jobs-api", ["read"]);

    const customNodeRepository = new CustomNodeRepository(storage);
    const customNodeProjectService = new CustomNodeProjectService();
    const commandRunner = vi.fn(async (_command: string, args: string[]): Promise<CommandResult> => {
      if (args[0] === "image") return commandResult(`sha256:${"d".repeat(64)}\n`);
      if (args[0] === "run") return commandResult(JSON.stringify({ value: 1, executedAt: "2026-01-01T00:00:00.000Z" }));
      return commandResult();
    });
    const customNodeBuildService = new CustomNodeBuildService({
      repository: customNodeRepository,
      projectService: customNodeProjectService,
      commandRunner,
      vulnerabilityAudit: async () => ({ passed: true, details: "mock audit passed" }),
    });
    let flowRepository = new NodeFlowRepository(storage);
    let flowService = new NodeFlowService(flowRepository, undefined, broker, {
      repository: customNodeRepository,
      projectService: customNodeProjectService,
      buildService: customNodeBuildService,
      resolveProjectRoot: () => root,
    });
    let approvalService = new ApprovalService(new AutomationApprovalRepository(storage), audit);
    let readinessService = new HeadlessOperationalReadinessService({ credentialRepository, keyProvider, auditService: audit, security });
    let app = createHeadlessApp({ nodeFlowService: flowService, approvalService, auditService: audit, readinessService, security, logger });

    expect((await request(app).get("/health").set("Host", "localhost")).body).toEqual({ status: "UP" });
    await request(app).get("/ready").set("Host", "localhost").expect(200);
    await request(app).get(`/api/projects/${project.id}/node-flows`)
      .set("Host", "localhost").set("X-Forwarded-Proto", "https").expect(401);
    await authenticated(request(app).get("/api/projects/unauthorized-project/node-flows")).expect(403, /not authorized/i);

    // This fixture is the authoring agent: it uses only authenticated governed routes.
    const customNodeResponse = await authenticated(request(app).post(`/api/projects/${project.id}/custom-nodes`))
      .send({ nodeId: "fixture-record-selector", name: "Fixture record selector", sourceRevision: "fixture-r1", createdBy: "author-agent" })
      .expect(201);
    expect(customNodeResponse.body).toMatchObject({ id: "fixture-record-selector", status: "draft" });
    const validationResponse = await authenticated(request(app).post(`/api/projects/${project.id}/custom-nodes/fixture-record-selector/validate`))
      .send({ actor: "author-agent", invocationId: "invocation-build", correlationId: "correlation-build" })
      .expect(200);
    expect(validationResponse.body).toMatchObject({ status: "passed" });
    const customNodeArtifact = customNodeBuildService.publish("fixture-record-selector", "publisher-service");
    expect(customNodeArtifact.manifest.nodeType).toBe("custom.fixture-record-selector");

    const graphV1 = {
      nodes: [
        { id: "select", type: "custom.fixture-record-selector", title: "Select fixtures", definition: { type: "custom.fixture-record-selector", version: 1 } },
        {
          id: "jobs", type: "http_request", title: "Read mocked jobs", definition: { type: "http_request", version: 1 },
          data: { url: "https://jobs.example.test/fixtures", method: "GET" },
          credentialBindings: [{ slot: "auth", credentialId: credential.id }],
        },
        { id: "output-v1", type: "output", title: "Output v1", data: { release: "v1" } },
      ],
      edges: [{ fromNodeId: "select", toNodeId: "jobs" }, { fromNodeId: "jobs", toNodeId: "output-v1" }],
    };
    const draftResponse = await authenticated(request(app).post(`/api/projects/${project.id}/node-flow-drafts`))
      .send({ title: "Mocked candidate outreach", graph: graphV1 })
      .expect(201);
    expect(draftResponse.body).toMatchObject({ valid: true, draftRevision: 1 });
    expect(draftResponse.body.requiredCredentials).toEqual([
      expect.objectContaining({ nodeId: "jobs", credentialId: credential.id, status: "bound" }),
    ]);
    await authenticated(request(app).post(`/api/node-flow-drafts/${draftResponse.body.flowId}/publish`))
      .send({ projectId: project.id, draftRevision: 1, publishedBy: "publisher-service" })
      .expect(200);

    const graphV2 = structuredClone(graphV1);
    graphV2.nodes[2] = { id: "output-v2", type: "output", title: "Output v2", data: { release: "v2" } };
    graphV2.edges[1] = { fromNodeId: "jobs", toNodeId: "output-v2" };
    const patchResponse = await authenticated(request(app).patch(`/api/node-flow-drafts/${draftResponse.body.flowId}`))
      .send({ projectId: project.id, draftRevision: 1, graph: graphV2 })
      .expect(200);
    await authenticated(request(app).post(`/api/node-flow-drafts/${draftResponse.body.flowId}/publish`))
      .send({ projectId: project.id, draftRevision: patchResponse.body.draft.draftRevision, publishedBy: "publisher-service" })
      .expect(200);
    const publicationV2 = flowRepository.getPublication(draftResponse.body.flowId);
    expect(publicationV2?.version).toBe(2);

    const initialCredential = await broker.resolve({ projectId: project.id, bindingKey: "jobs-api", capability: "read", workspaceId: "fixture-fetch" });
    const jobApi = {
      list: vi.fn(async (value: string): Promise<JobFixture[]> => {
        expect(value).toBe(FIRST_SECRET_CANARY);
        return JSON.parse(await fs.readFile(path.resolve("tests/e2e/fixtures/headless-automation-records.json"), "utf8")) as JobFixture[];
      }),
      authenticate: vi.fn(async (_value: string, _version: number): Promise<void> => undefined),
      unavailable: vi.fn(async (): Promise<JobFixture[]> => { throw new Error("mock jobs provider unavailable"); }),
    };
    const records = await jobApi.list(initialCredential.value);
    expect(records).toHaveLength(EXPECTED_RECORD_COUNT);
    const selected = records.filter((record) => record.selected);
    const drafts: NodeFlowJsonObject[] = selected.map((record) => ({
      to: `${record.id}@example.test`, subject: "Fixture follow-up", body: `Hello ${record.name}`,
    }));
    expect(drafts).toHaveLength(EXPECTED_SELECTED_MESSAGE_COUNT);

    const run = flowRepository.createRun({
      projectId: project.id,
      flowId: draftResponse.body.flowId,
      version: publicationV2!.version,
      publicationId: publicationV2!.id,
      policy: publicationV2!.policy,
      status: "queued",
      input: { recordCount: records.length },
    });
    const claimed = new NodeFlowQueueService(flowRepository).claim(run, "worker-before-restart");
    const nodeRun = flowRepository.createNodeRun({
      runId: run.id, flowId: run.flowId, projectId: project.id, nodeId: "send", status: "running",
    });
    const activeAttempt = flowRepository.createNodeAttempt({
      runId: run.id, nodeRunId: nodeRun.id, nodeId: "send", attemptNumber: 1, status: "running",
      executorId: claimed.leaseOwner!, invocationId: null, artifactDigest: null, input: { processed: 0 }, output: null,
      credentialIds: [credential.id], failureClassification: null, retryDecision: null, errorMessage: null,
      startedAt: new Date().toISOString(), finishedAt: null,
    });
    for (const [index, draft] of drafts.entries()) {
      const logicalItem = selected[index]!.id;
      try {
        approvalService.requireApproval({ projectId: project.id, flowId: run.flowId, runId: run.id, nodeId: "send", logicalItem, request: draft });
      } catch (error) {
        expect(error).toBeInstanceOf(ApprovalRequiredError);
        approvalService.approve((error as ApprovalRequiredError).approval.id, "approver-service");
      }
      approvalService.requireApproval({ projectId: project.id, flowId: run.flowId, runId: run.id, nodeId: "send", logicalItem, request: draft });
    }
    expect(approvalService.listForRun(run.id).filter((approval) => approval.status === "approved")).toHaveLength(EXPECTED_SELECTED_MESSAGE_COUNT);

    const providerBeforeRestart = new MockSideEffectProvider();
    const outboxBeforeRestart = new OutboxService(new AutomationOutboxRepository(storage), providerBeforeRestart, audit);
    for (let index = 0; index < 2; index += 1) {
      await outboxBeforeRestart.dispatch({
        projectId: project.id, flowId: run.flowId, publicationId: publicationV2!.id, runId: run.id,
        nodeId: "send", logicalItem: selected[index]!.id, effectType: "email", payload: drafts[index]!,
      });
    }
    expect(providerBeforeRestart.sends).toHaveLength(2);
    flowRepository.updateRun(run.id, { leaseExpiresAt: "2020-01-01T00:00:00.000Z" });

    // Reopen the same database to model a process restart while the run and attempt are active.
    storage.close();
    storage = new AppDbStorage(databasePath);
    audit = new AutomationAuditExportService(storage);
    credentialRepository = new AutomationCredentialRepository(storage);
    broker = new CredentialBroker(
      credentialRepository,
      new EncryptedSqliteSecretStore(credentialRepository, keyProvider),
      keyProvider,
      audit,
    );
    flowRepository = new NodeFlowRepository(storage);
    flowService = new NodeFlowService(flowRepository, undefined, broker);
    approvalService = new ApprovalService(new AutomationApprovalRepository(storage), audit);
    readinessService = new HeadlessOperationalReadinessService({ credentialRepository, keyProvider, auditService: audit, security });
    app = createHeadlessApp({ nodeFlowService: flowService, approvalService, auditService: audit, readinessService, security, logger });

    const [recovered] = new NodeFlowRecoveryService(flowRepository).recover();
    expect(recovered).toMatchObject({ id: run.id, status: "queued", leaseOwner: null, leaseExpiresAt: null });
    expect(flowRepository.listNodeAttempts(run.id)).toHaveLength(1);
    const reclaimed = new NodeFlowQueueService(flowRepository).claim(recovered!, "worker-after-restart");
    expect(reclaimed).toMatchObject({ status: "running", leaseOwner: "worker-after-restart" });

    const providerAfterRestart = new MockSideEffectProvider();
    const outboxAfterRestart = new OutboxService(new AutomationOutboxRepository(storage), providerAfterRestart, audit);
    for (const [index, draft] of drafts.entries()) {
      await outboxAfterRestart.dispatch({
        projectId: project.id, flowId: run.flowId, publicationId: publicationV2!.id, runId: run.id,
        nodeId: "send", logicalItem: selected[index]!.id, effectType: "email", payload: draft,
      });
    }
    const allProviderSends = [...providerBeforeRestart.sends, ...providerAfterRestart.sends];
    const idempotencyKeys = allProviderSends.map((send) => send.idempotencyKey);
    expect(allProviderSends).toHaveLength(EXPECTED_SELECTED_MESSAGE_COUNT);
    expect(new Set(idempotencyKeys)).toHaveLength(EXPECTED_SELECTED_MESSAGE_COUNT);
    expect(idempotencyKeys.every((key) => idempotencyKeys.filter((candidate) => candidate === key).length === 1)).toBe(true);
    const persistedOutbox = new AutomationOutboxRepository(storage).listForRun(run.id);
    expect(persistedOutbox).toHaveLength(EXPECTED_SELECTED_MESSAGE_COUNT);
    expect(persistedOutbox.every((item) => item.status === "sent" && idempotencyKeys.includes(item.idempotencyKey))).toBe(true);
    flowRepository.updateNodeAttempt(activeAttempt.id, { status: "succeeded", output: { delivered: drafts.length }, retryDecision: "stop", finishedAt: new Date().toISOString() });
    flowRepository.updateNodeRun(nodeRun.id, { status: "succeeded", output: { delivered: drafts.length }, finishedAt: new Date().toISOString() });
    const completedRun = flowRepository.updateRun(run.id, {
      status: "succeeded", output: { processed: records.length, delivered: drafts.length },
      leaseOwner: null, leaseExpiresAt: null, finishedAt: new Date().toISOString(),
    });
    expect(completedRun).toMatchObject({ status: "succeeded", output: { processed: EXPECTED_RECORD_COUNT, delivered: EXPECTED_SELECTED_MESSAGE_COUNT } });

    await broker.rotate(project.id, credential.id, ROTATED_SECRET_CANARY);
    const rotated = await broker.resolve({ projectId: project.id, bindingKey: "jobs-api", capability: "read", workspaceId: "run-after-rotation" });
    await jobApi.authenticate(rotated.value, rotated.version);
    expect(jobApi.authenticate).toHaveBeenCalledWith(ROTATED_SECRET_CANARY, 2);

    const publicationService = new NodeFlowPublicationService(flowRepository);
    expect(publicationService.resolve(run.flowId, { mode: "pinned", version: 2 }).id).toBe(run.publicationId);
    const rollbackResponse = await authenticated(request(app).post(`/api/node-flows/${run.flowId}/rollback`))
      .send({ projectId: project.id, version: 1, draftRevision: 2 })
      .expect(200);
    await authenticated(request(app).post(`/api/node-flow-drafts/${run.flowId}/publish`))
      .send({ projectId: project.id, draftRevision: rollbackResponse.body.draftRevision, publishedBy: "publisher-service" })
      .expect(200);
    const latestAfterRollback = publicationService.resolve(run.flowId, { mode: "latest_published" });
    expect(latestAfterRollback.version).toBe(3);
    expect(latestAfterRollback.graph.nodes.some((node) => node.id === "output-v1")).toBe(true);
    expect(publicationService.resolve(run.flowId, { mode: "pinned", version: 2 }).graph.nodes.some((node) => node.id === "output-v2")).toBe(true);
    expect(flowRepository.getRun(run.id)).toMatchObject({ version: 2, publicationId: publicationV2!.id });

    await expect(jobApi.unavailable()).rejects.toThrow(/jobs provider unavailable/i);
    const unavailableEmailProvider: SideEffectProvider = {
      send: vi.fn(async () => { throw new Error("mock email provider unavailable"); }),
    };
    const failedDelivery = await new OutboxService(new AutomationOutboxRepository(storage), unavailableEmailProvider, audit).dispatch({
      projectId: project.id, flowId: run.flowId, publicationId: latestAfterRollback.id, runId: run.id,
      nodeId: "send", logicalItem: "provider-unavailable", effectType: "email", payload: { to: "nobody@example.test" },
    });
    expect(failedDelivery).toMatchObject({ status: "failed", attemptCount: 1 });

    broker.revoke(project.id, credential.id);
    await expect(broker.resolve({ projectId: project.id, bindingKey: "jobs-api", capability: "read", workspaceId: "revoked" })).rejects.toThrow(/not active/i);
    keyAvailable = false;
    await request(app).get("/health").set("Host", "localhost").expect(200, { status: "UP" });
    await request(app).get("/ready").set("Host", "localhost").expect(503, /mock key provider unavailable/i);
    await expect(readinessService.assertStartupReady()).rejects.toThrow(/key recovery is unavailable/i);

    logger.error("credentialed automation diagnostic", { apiKey: FIRST_SECRET_CANARY, authorization: `Bearer ${ROTATED_SECRET_CANARY}` });
    const auditResponse = await authenticated(request(app).get(`/api/admin/audit/export?projectId=${project.id}`)).expect(200);
    const observable = JSON.stringify({
      routeBodies: [customNodeResponse.body, validationResponse.body, draftResponse.body, patchResponse.body, rollbackResponse.body],
      audit: auditResponse.text,
      logs: capturedLogs,
      diagnostics: { processed: records.length, selected: selected.length, outbox: persistedOutbox, readiness: readinessService.snapshot() },
    });
    expect(observable).not.toContain(FIRST_SECRET_CANARY);
    expect(observable).not.toContain(ROTATED_SECRET_CANARY);
    expect(observable).not.toContain(SERVICE_TOKEN);
    expect(observable).toContain("[REDACTED]");
    expect(jobApi.list).toHaveBeenCalledTimes(1);
    expect(commandRunner).toHaveBeenCalled();
    storage.close();
  });
});
