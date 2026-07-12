import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { NodeFlowRepository } from "../../../src/repositories/node-flow-repository.js";
import { AutomationApprovalRepository } from "../../../src/repositories/automation-approval-repository.js";
import { AutomationOutboxRepository } from "../../../src/repositories/automation-outbox-repository.js";
import { MockSideEffectProvider, OutboxService } from "../../../src/services/node-flows/outbox-service.js";

const dirs: string[] = [];
afterEach(async () => Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))));

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "automation-governance-")); dirs.push(dir);
  const dbPath = join(dir, "app.db"); const storage = new AppDbStorage(dbPath);
  const project = new ProjectManagementRepository(storage).createProject({ name: "Governance", sourceType: "local", sourceRef: dir });
  const flows = new NodeFlowRepository(storage);
  const flow = flows.createFlow(project.id, { title: "Flow", graph: { nodes: [{ id: "draft", type: "email_draft", title: "Draft" }], edges: [] } });
  const publication = flows.getPublication(flow.id)!;
  const run = flows.createRun({ flowId: flow.id, projectId: project.id, version: flow.version, publicationId: publication.id, status: "running" });
  return { dir, dbPath, storage, project, flow, publication, run };
}

describe("automation governance repositories", () => {
  it("persists approval decisions across repository restarts", async () => {
    const { storage, project, flow, run } = await fixture();
    const first = new AutomationApprovalRepository(storage);
    const requested = first.request({ projectId: project.id, flowId: flow.id, runId: run.id, nodeId: "approve", logicalItem: "one", request: { summary: "Send" } });
    first.decide(requested.id, { status: "approved", decidedBy: "operator" });
    expect(new AutomationApprovalRepository(storage).get(requested.id)).toMatchObject({ status: "approved", decidedBy: "operator" });
    storage.close();
  });

  it("deduplicates outbox sends and marks restart-unknown outcomes for attention", async () => {
    const { storage, project, flow, publication, run } = await fixture();
    const repository = new AutomationOutboxRepository(storage); const provider = new MockSideEffectProvider();
    const service = new OutboxService(repository, provider);
    const input = { projectId: project.id, flowId: flow.id, publicationId: publication.id, runId: run.id, nodeId: "send", logicalItem: "one", effectType: "email", payload: { to: "a@example.test" } };
    const first = await service.dispatch(input); const second = await service.dispatch(input);
    expect(second.id).toBe(first.id); expect(provider.sends).toHaveLength(1); expect(first.providerMessageId).toMatch(/^mock-/);

    const pending = repository.enqueue({ ...input, logicalItem: "two" });
    repository.claim(pending.id);
    new OutboxService(repository, provider);
    expect(repository.get(pending.id)).toMatchObject({ status: "attention_required" });
    storage.close();
  });
});
