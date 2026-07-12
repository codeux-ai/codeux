import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { AutomationCredentialRepository } from "../../../src/repositories/automation-credential-repository.js";
import { AutomationApprovalRepository } from "../../../src/repositories/automation-approval-repository.js";
import { AutomationOutboxRepository } from "../../../src/repositories/automation-outbox-repository.js";
import { CustomNodeRepository } from "../../../src/repositories/custom-node-repository.js";
import { NodeFlowRepository } from "../../../src/repositories/node-flow-repository.js";
import { EncryptedSqliteSecretStore } from "../../../src/infrastructure/security/encrypted-sqlite-secret-store.js";
import { CredentialBroker } from "../../../src/services/credentials/credential-broker.js";
import type { KeyProvider } from "../../../src/services/credentials/key-provider.js";
import { AutomationAuditExportService } from "../../../src/services/automation-audit-export-service.js";
import { CustomNodeProjectService } from "../../../src/services/custom-nodes/custom-node-project-service.js";
import { CustomNodeBuildService } from "../../../src/services/custom-nodes/custom-node-build-service.js";
import { NodeFlowService } from "../../../src/services/node-flow-service.js";
import { ApprovalRequiredError, ApprovalService } from "../../../src/services/node-flows/approval-service.js";
import { MockSideEffectProvider, OutboxService, type SideEffectProvider } from "../../../src/services/node-flows/outbox-service.js";
import type { CommandResult } from "../../../src/services/cli-process-runner.js";

interface JobFixture { id: string; name: string; selected: boolean }
const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

const commandResult = (stdout = "", stderr = ""): CommandResult => ({ ok: true, code: 0, stdout, stderr });

describe("credentialed automation authoring-to-execution", () => {
  it("processes exactly 20 mocked records with restart-safe delivery, rotation, and rollback", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-credentialed-e2e-"));
    temporaryDirectories.push(root);
    const storage = new AppDbStorage(path.join(root, "app.db"));
    const project = new ProjectManagementRepository(storage).createProject({
      name: "Approved local test project",
      sourceType: "local",
      sourceRef: root,
    });
    const audit = new AutomationAuditExportService(storage);
    const key = Buffer.alloc(32, 7);
    const keyProvider: KeyProvider = {
      providerName: "mock-kms",
      health: async () => ({ available: true, secure: true, provider: "mock-kms", keyId: "fixture-key", keyVersion: 1 }),
      getActiveKey: async () => ({ key: Buffer.from(key), keyId: "fixture-key", version: 1 }),
      getKey: async () => ({ key: Buffer.from(key), keyId: "fixture-key", version: 1 }),
    };
    const credentialRepository = new AutomationCredentialRepository(storage);
    const broker = new CredentialBroker(
      credentialRepository,
      new EncryptedSqliteSecretStore(credentialRepository, keyProvider),
      keyProvider,
      audit,
    );

    // Credential values are configured outside the graph/agent authoring path.
    const credential = await broker.create(project.id, {
      name: "Mock jobs and email API",
      kind: "http",
      value: "E2E_SECRET_CANARY",
      capabilities: ["read", "write"],
    });
    broker.bind(project.id, credential.id, "jobs-api", ["read"]);

    // The mocked command boundary proves generation + isolated validation/build without Docker/network access.
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
    const flowRepository = new NodeFlowRepository(storage);
    const flowService = new NodeFlowService(flowRepository, undefined, broker, {
      repository: customNodeRepository,
      projectService: customNodeProjectService,
      buildService: customNodeBuildService,
      resolveProjectRoot: () => root,
    });
    await flowService.createCustomNode(project.id, {
      nodeId: "fixture-record-selector",
      name: "Fixture record selector",
      sourceRevision: "fixture-r1",
      createdBy: "author-agent",
    });
    const validation = await flowService.validateCustomNode(project.id, "fixture-record-selector", "author-agent", "invocation-build", "correlation-build");
    expect(validation).toMatchObject({ status: "passed" });

    const firstDraft = flowService.createDraft(project.id, {
      title: "Mocked candidate outreach",
      graph: { nodes: [{ id: "output-v1", type: "output", title: "Output v1", data: { release: "v1" } }], edges: [] },
    });
    flowService.publishDraft(project.id, firstDraft.flowId, firstDraft.draftRevision, "publisher-service");
    const patched = flowService.patchDraft(firstDraft.flowId, {
      projectId: project.id,
      draftRevision: firstDraft.draftRevision,
      graph: { nodes: [{ id: "output-v2", type: "output", title: "Output v2", data: { release: "v2" } }], edges: [] },
    }).draft!;
    flowService.publishDraft(project.id, firstDraft.flowId, patched.draftRevision, "publisher-service");
    const publicationV2 = flowRepository.getPublication(firstDraft.flowId)!;

    const fixturePath = path.resolve("tests/e2e/fixtures/headless-automation-records.json");
    const jobApi = { list: vi.fn(async (): Promise<JobFixture[]> => JSON.parse(await fs.readFile(fixturePath, "utf8")) as JobFixture[]) };
    const records = await jobApi.list();
    expect(records).toHaveLength(20);
    const selected = records.filter((record) => record.selected);
    const drafts = selected.map((record) => ({ to: `${record.id}@example.test`, subject: "Fixture follow-up", body: `Hello ${record.name}` }));
    expect(drafts).toHaveLength(5);

    const run = flowRepository.createRun({
      projectId: project.id,
      flowId: firstDraft.flowId,
      version: publicationV2.version,
      publicationId: publicationV2.id,
      policy: publicationV2.policy,
      status: "queued",
      input: { recordCount: records.length },
    });
    const approvalService = new ApprovalService(new AutomationApprovalRepository(storage), audit);
    const provider = new MockSideEffectProvider();
    const firstOutbox = new OutboxService(new AutomationOutboxRepository(storage), provider, audit);
    for (const [index, draft] of drafts.entries()) {
      const logicalItem = selected[index]!.id;
      try {
        approvalService.requireApproval({ projectId: project.id, flowId: firstDraft.flowId, runId: run.id, nodeId: "send", logicalItem, request: draft });
      } catch (error) {
        expect(error).toBeInstanceOf(ApprovalRequiredError);
        approvalService.approve((error as ApprovalRequiredError).approval.id, "approver-service");
      }
      approvalService.requireApproval({ projectId: project.id, flowId: firstDraft.flowId, runId: run.id, nodeId: "send", logicalItem, request: draft });
      await firstOutbox.dispatch({ projectId: project.id, flowId: firstDraft.flowId, publicationId: publicationV2.id, runId: run.id, nodeId: "send", logicalItem, effectType: "email", payload: draft });
    }
    expect(provider.sends).toHaveLength(5);

    // A new service instance models process restart. Re-dispatch uses the durable idempotency key and sends nothing twice.
    const restartedProvider = new MockSideEffectProvider();
    const restartedOutbox = new OutboxService(new AutomationOutboxRepository(storage), restartedProvider, audit);
    for (const [index, draft] of drafts.entries()) {
      await restartedOutbox.dispatch({ projectId: project.id, flowId: firstDraft.flowId, publicationId: publicationV2.id, runId: run.id, nodeId: "send", logicalItem: selected[index]!.id, effectType: "email", payload: draft });
    }
    expect(restartedProvider.sends).toHaveLength(0);
    expect(new AutomationOutboxRepository(storage).listForRun(run.id).filter((item) => item.status === "sent")).toHaveLength(5);

    await broker.rotate(project.id, credential.id, "ROTATED_SECRET_CANARY");
    const rotated = await broker.resolve({ projectId: project.id, bindingKey: "jobs-api", capability: "read", workspaceId: "run-after-rotation" });
    expect(rotated).toMatchObject({ credentialId: credential.id, version: 2 });
    expect(rotated.value).toBe("ROTATED_SECRET_CANARY");
    broker.revoke(project.id, credential.id);
    await expect(broker.resolve({ projectId: project.id, bindingKey: "jobs-api", capability: "read", workspaceId: "revoked" })).rejects.toThrow(/not active/i);

    const unavailableProvider: SideEffectProvider = { send: vi.fn(async () => { throw new Error("mock email provider unavailable"); }) };
    const failed = await new OutboxService(new AutomationOutboxRepository(storage), unavailableProvider, audit).dispatch({
      projectId: project.id, flowId: firstDraft.flowId, publicationId: publicationV2.id, runId: run.id,
      nodeId: "send", logicalItem: "provider-unavailable", effectType: "email", payload: { to: "nobody@example.test" },
    });
    expect(failed).toMatchObject({ status: "failed" });

    const rolledBack = flowService.rollback(project.id, firstDraft.flowId, 1, patched.draftRevision);
    flowService.publishDraft(project.id, firstDraft.flowId, rolledBack.draftRevision, "publisher-service");
    expect(flowRepository.getPublication(firstDraft.flowId)?.graph.nodes[0]?.id).toBe("output-v1");

    const exportedState = JSON.stringify({
      credential: broker.list(project.id),
      validation,
      graph: flowRepository.getFlow(firstDraft.flowId)?.graph,
      audit: audit.list({ projectId: project.id }),
      drafts,
      diagnostics: { processed: records.length, delivered: provider.sends.length },
    });
    expect(exportedState).not.toContain("E2E_SECRET_CANARY");
    expect(exportedState).not.toContain("ROTATED_SECRET_CANARY");
    expect(exportedState).not.toMatch(/Bearer\s+/i);
    expect(jobApi.list).toHaveBeenCalledTimes(1);
    expect(commandRunner).toHaveBeenCalled();
    storage.close();
  });
});
