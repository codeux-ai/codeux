import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { NodeFlowRepository } from "../../../src/repositories/node-flow-repository.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { NodeFlowRecoveryService } from "../../../src/services/node-flows/node-flow-recovery-service.js";
import { NodeFlowQueueService, NodeFlowQuotaExceededError } from "../../../src/services/node-flows/node-flow-queue-service.js";
import { DEFAULT_NODE_FLOW_EXECUTION_POLICY } from "../../../src/contracts/node-flow-execution-policy-types.js";
import { AutomationApprovalRepository } from "../../../src/repositories/automation-approval-repository.js";
import { ApprovalService } from "../../../src/services/node-flows/approval-service.js";
import type { NodeFlowRuntimeService } from "../../../src/services/node-flow-runtime-service.js";

const dirs: string[] = [];
afterEach(async () => Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))));

describe("NodeFlowRecoveryService", () => {
  it("enforces the immutable project concurrency quota before claiming", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "flow-quota-")); dirs.push(dir);
    const storage = new AppDbStorage(path.join(dir, "app.db"));
    const projects = new ProjectManagementRepository(storage); const repository = new NodeFlowRepository(storage);
    const project = projects.createProject({ name: "Quota", sourceType: "local", sourceRef: dir });
    const flow = repository.createFlow(project.id, { title: "Quota", graph: { nodes: [{ id: "input", type: "input", title: "Input" }], edges: [] } });
    const run = repository.createRun({ flowId: flow.id, projectId: project.id, version: 1, status: "queued", policy: { ...DEFAULT_NODE_FLOW_EXECUTION_POLICY, maxConcurrentRunsPerProject: 0 } });

    expect(() => new NodeFlowQueueService(repository).claim(run, "executor")).toThrow(NodeFlowQuotaExceededError);
    expect(repository.getRun(run.id)?.status).toBe("queued");
  });

  it("requeues an expired pre-invocation attempt without creating a duplicate attempt", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "flow-recovery-")); dirs.push(dir);
    const storage = new AppDbStorage(path.join(dir, "app.db"));
    const projects = new ProjectManagementRepository(storage); const repository = new NodeFlowRepository(storage);
    const project = projects.createProject({ name: "Recovery", sourceType: "local", sourceRef: dir });
    const flow = repository.createFlow(project.id, { title: "Recover", graph: { nodes: [{ id: "input", type: "input", title: "Input" }], edges: [] } });
    const run = repository.createRun({ flowId: flow.id, projectId: project.id, version: 1, status: "running" });
    repository.updateRun(run.id, { leaseOwner: "dead", leaseExpiresAt: "2020-01-01T00:00:00.000Z" });
    const nodeRun = repository.createNodeRun({ runId: run.id, flowId: flow.id, projectId: project.id, nodeId: "input", status: "running" });
    repository.createNodeAttempt({ runId: run.id, nodeRunId: nodeRun.id, nodeId: "input", attemptNumber: 1, status: "running", executorId: "dead", invocationId: null, artifactDigest: null, input: {}, output: null, credentialIds: [], failureClassification: null, retryDecision: null, errorMessage: null, startedAt: "2020-01-01T00:00:00.000Z", finishedAt: null });

    const [recovered] = new NodeFlowRecoveryService(repository).recover();
    expect(recovered?.status).toBe("queued");
    expect(repository.listNodeAttempts(run.id)).toHaveLength(1);
  });

  it("requires attention when an expired attempt has an external invocation", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "flow-recovery-")); dirs.push(dir);
    const storage = new AppDbStorage(path.join(dir, "app.db"));
    const projects = new ProjectManagementRepository(storage); const repository = new NodeFlowRepository(storage);
    const project = projects.createProject({ name: "Recovery External", sourceType: "local", sourceRef: dir });
    const flow = repository.createFlow(project.id, { title: "Recover", graph: { nodes: [{ id: "http", type: "http_request", title: "HTTP" }], edges: [] } });
    const run = repository.createRun({ flowId: flow.id, projectId: project.id, version: 1, status: "running" });
    repository.updateRun(run.id, { leaseOwner: "dead", leaseExpiresAt: "2020-01-01T00:00:00.000Z" });
    const nodeRun = repository.createNodeRun({ runId: run.id, flowId: flow.id, projectId: project.id, nodeId: "http", status: "running" });
    repository.createNodeAttempt({ runId: run.id, nodeRunId: nodeRun.id, nodeId: "http", attemptNumber: 1, status: "running", executorId: "dead", invocationId: "external-1", artifactDigest: null, input: {}, output: null, credentialIds: [], failureClassification: null, retryDecision: null, errorMessage: null, startedAt: "2020-01-01T00:00:00.000Z", finishedAt: null });

    const [recovered] = new NodeFlowRecoveryService(repository).recover();
    expect(recovered?.status).toBe("attention_required");
    expect(recovered?.errorMessage).toMatch(/outcome is unknown/i);
  });

  it("resumes a decision persisted before process restart", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "flow-approval-recovery-")); dirs.push(dir);
    const storage = new AppDbStorage(path.join(dir, "app.db"));
    const projects = new ProjectManagementRepository(storage); const repository = new NodeFlowRepository(storage);
    const project = projects.createProject({ name: "Approval Recovery", sourceType: "local", sourceRef: dir });
    const flow = repository.createFlow(project.id, { title: "Recover approval", graph: { nodes: [{ id: "approval", type: "approval", title: "Approval" }], edges: [] } });
    const run = repository.createRun({ flowId: flow.id, projectId: project.id, version: 1, publicationId: repository.getPublication(flow.id)!.id, status: "approval_waiting" });
    repository.createNodeRun({ runId: run.id, flowId: flow.id, projectId: project.id, nodeId: "approval", status: "approval_waiting" });
    const approvals = new AutomationApprovalRepository(storage);
    const approval = approvals.request({ projectId: project.id, flowId: flow.id, runId: run.id, nodeId: "approval", logicalItem: "default", request: {} });
    approvals.decide(approval.id, { status: "approved", decidedBy: "operator" });
    const resumed = { ...run, status: "succeeded" as const };
    const runtime = { resumeApproval: async () => ({ run: resumed, nodeRuns: [], attempts: [], output: {} }) } as unknown as NodeFlowRuntimeService;

    const recovered = await new NodeFlowRecoveryService(repository, new ApprovalService(approvals), runtime).resumeDecidedApprovals();
    expect(recovered).toEqual([resumed]);
  });
});
