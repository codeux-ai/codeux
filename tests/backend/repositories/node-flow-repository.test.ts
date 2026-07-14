import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { AgentPresetRepository } from "../../../src/repositories/agent-preset-repository.js";
import { NodeFlowRepository } from "../../../src/repositories/node-flow-repository.js";
import type { NodeFlowGraph } from "../../../src/contracts/node-flow-types.js";

const tempDirs: string[] = [];

async function createRepositories(): Promise<{
  dir: string;
  storage: AppDbStorage;
  projectRepository: ProjectManagementRepository;
  agentRepository: AgentPresetRepository;
  nodeFlowRepository: NodeFlowRepository;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "node-flow-repo-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  return {
    dir,
    storage,
    projectRepository: new ProjectManagementRepository(storage),
    agentRepository: new AgentPresetRepository(storage),
    nodeFlowRepository: new NodeFlowRepository(storage),
  };
}

const graph = (): NodeFlowGraph => ({
  nodes: [
    { id: "one", type: "manual", title: "One" },
    { id: "two", type: "agent", title: "Two" },
  ],
  edges: [{ fromNodeId: "one", toNodeId: "two" }],
});

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("NodeFlowRepository", () => {
  it("normalizes legacy reads immediately and persists the v2 migration in a bounded idle pass", async () => {
    const { dir, storage, projectRepository, nodeFlowRepository } = await createRepositories();
    const project = projectRepository.createProject({ name: "Migration fixture", sourceType: "local", sourceRef: dir });
    const flow = nodeFlowRepository.createFlow(project.id, { title: "Legacy flow", graph: graph() });
    const original = JSON.stringify(graph());
    storage.getDatabase().prepare("UPDATE node_flows SET graph_json = ?, version = 1 WHERE id = ?").run(original, flow.id);
    storage.getDatabase().prepare("UPDATE node_flow_versions SET graph_json = ? WHERE flow_id = ? AND version = 1").run(original, flow.id);

    const legacyRepository = new NodeFlowRepository(storage);
    const normalized = legacyRepository.getFlow(flow.id);

    expect(normalized).toMatchObject({ version: 1, graph: { schemaVersion: 2 } });
    expect(legacyRepository.listVersions(flow.id).map((version) => version.version)).toEqual([1]);

    const migration = storage.runBoundedDataMigrationsIfIdle();
    expect(migration).toMatchObject({ skipped: false, migratedNodeFlowGraphs: 1 });

    const migratedRepository = new NodeFlowRepository(storage);
    const migrated = migratedRepository.getFlow(flow.id);
    const versions = migratedRepository.listVersions(flow.id);
    const originalVersion = storage
      .getDatabase()
      .prepare("SELECT graph_json FROM node_flow_versions WHERE flow_id = ? AND version = 1")
      .get(flow.id) as { graph_json: string } | undefined;

    expect(migrated).toMatchObject({ version: 2, graph: { schemaVersion: 2 } });
    expect(versions.map((version) => version.version)).toEqual([2, 1]);
    expect(versions[1]?.graph).toMatchObject({ schemaVersion: 2 });
    expect(originalVersion?.graph_json).toBe(original);
    expect(new NodeFlowRepository(storage).getFlow(flow.id)).toEqual(migrated);
  });

  it("creates, updates, versions, lists, and deletes node flows", async () => {
    const { dir, projectRepository, nodeFlowRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Node Flow Project",
      sourceType: "local",
      sourceRef: dir,
    });

    const created = nodeFlowRepository.createFlow(project.id, {
      title: "  Release checklist  ",
      description: "  Repeatable launch flow  ",
      graph: graph(),
    });

    expect(created.title).toBe("Release checklist");
    expect(created.description).toBe("Repeatable launch flow");
    expect(created.version).toBe(1);
    expect(nodeFlowRepository.listFlows(project.id).map((flow) => flow.id)).toEqual([created.id]);

    const updatedGraph = graph();
    updatedGraph.nodes.push({ id: "three", type: "notify", title: "Three" });
    updatedGraph.edges.push({ fromNodeId: "two", toNodeId: "three" });
    const updated = nodeFlowRepository.updateFlow(created.id, {
      title: "Release checklist v2",
      graph: updatedGraph,
    });

    expect(updated.version).toBe(2);
    expect(updated.graph.nodes.map((node) => node.id)).toEqual(["one", "two", "three"]);
    expect(nodeFlowRepository.listVersions(created.id).map((version) => version.version)).toEqual([2, 1]);

    nodeFlowRepository.deleteFlow(created.id);
    expect(nodeFlowRepository.getFlow(created.id)).toBeNull();
  });

  it("attaches and detaches node flows as agent skills", async () => {
    const { dir, projectRepository, agentRepository, nodeFlowRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Node Flow Project",
      sourceType: "local",
      sourceRef: dir,
    });
    const agent = agentRepository.createAgentPreset(project.id, {
      name: "Release agent",
      instructionMarkdown: "Ship safely.",
    });
    const flow = nodeFlowRepository.createFlow(project.id, {
      title: "Release checklist",
      graph: graph(),
    });

    const attachment = nodeFlowRepository.attachToAgent(flow.id, {
      agentPresetId: agent.id,
      skillName: "Run release checklist",
    });

    expect(attachment).toMatchObject({
      flowId: flow.id,
      projectId: project.id,
      agentPresetId: agent.id,
      skillName: "Run release checklist",
    });
    expect(nodeFlowRepository.listAgentSkills(flow.id)).toHaveLength(1);
    expect(nodeFlowRepository.listAgentSkillsForAgent(project.id, agent.id).map((item) => item.flowId)).toEqual([flow.id]);

    nodeFlowRepository.detachFromAgent(flow.id, agent.id);
    expect(nodeFlowRepository.listAgentSkills(flow.id)).toEqual([]);
  });

  it("hydrates persisted flow runs and node runs", async () => {
    const { dir, storage, projectRepository, nodeFlowRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Node Flow Project",
      sourceType: "local",
      sourceRef: dir,
    });
    const flow = nodeFlowRepository.createFlow(project.id, {
      title: "Release checklist",
      graph: graph(),
    });
    const now = "2026-07-07T00:00:00.000Z";
    const db = storage.getDatabase();
    db.prepare(`
      INSERT INTO node_flow_runs (
        id, flow_id, project_id, version, status, trigger_type, trigger_payload_json,
        input_json, output_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "run-1",
      flow.id,
      project.id,
      flow.version,
      "succeeded",
      "manual",
      JSON.stringify({ source: "test" }),
      JSON.stringify({ prompt: "Ship" }),
      JSON.stringify({ ok: true }),
      now,
      now,
    );
    db.prepare(`
      INSERT INTO node_flow_node_runs (
        id, run_id, flow_id, project_id, node_id, status, input_json, output_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "node-run-1",
      "run-1",
      flow.id,
      project.id,
      "one",
      "succeeded",
      JSON.stringify({ prompt: "Ship" }),
      JSON.stringify({ response: "Done" }),
      now,
      now,
    );

    expect(nodeFlowRepository.listRuns(flow.id)[0]).toMatchObject({
      id: "run-1",
      triggerPayload: { source: "test" },
      input: { prompt: "Ship" },
      output: { ok: true },
    });
    expect(nodeFlowRepository.listNodeRuns("run-1")[0]).toMatchObject({
      id: "node-run-1",
      nodeId: "one",
      output: { response: "Done" },
    });
  });

  it("creates and updates flow runs and node runs with linked invocation ids", async () => {
    const { dir, storage, projectRepository, nodeFlowRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Node Flow Project",
      sourceType: "local",
      sourceRef: dir,
    });
    const flow = nodeFlowRepository.createFlow(project.id, {
      title: "Release checklist",
      graph: graph(),
    });
    const now = "2026-07-07T00:00:00.000Z";
    storage.getDatabase().prepare(`
      INSERT INTO execution_invocations (
        id, project_id, type, status, started_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run("xi-node-flow-test", project.id, "node_flow", "running", now, now, now);
    storage.getDatabase().prepare(`
      INSERT INTO execution_invocations (
        id, project_id, type, status, started_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run("xi-node-test", project.id, "node_flow_node", "running", now, now, now);

    const run = nodeFlowRepository.createRun({
      flowId: flow.id,
      projectId: project.id,
      version: flow.version,
      executionInvocationId: "xi-node-flow-test",
      input: { prompt: "Ship" },
      startedAt: now,
    });
    const nodeRun = nodeFlowRepository.createNodeRun({
      runId: run.id,
      flowId: flow.id,
      projectId: project.id,
      nodeId: "one",
      status: "running",
      executionInvocationId: "xi-node-test",
      input: { prompt: "Ship" },
      startedAt: now,
    });

    const updatedNodeRun = nodeFlowRepository.updateNodeRun(nodeRun.id, {
      status: "succeeded",
      output: { response: "Done" },
      finishedAt: now,
    });
    const updatedRun = nodeFlowRepository.updateRun(run.id, {
      status: "succeeded",
      output: { ok: true },
      finishedAt: now,
    });

    expect(updatedRun).toMatchObject({
      status: "succeeded",
      executionInvocationId: "xi-node-flow-test",
      output: { ok: true },
    });
    expect(updatedNodeRun).toMatchObject({
      status: "succeeded",
      executionInvocationId: "xi-node-test",
      output: { response: "Done" },
    });
    expect(nodeFlowRepository.listNodeRuns(run.id)[0]?.executionInvocationId).toBe("xi-node-test");
  });
});
