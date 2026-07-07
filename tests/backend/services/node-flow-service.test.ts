import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { NodeFlowRepository } from "../../../src/repositories/node-flow-repository.js";
import { NodeFlowService } from "../../../src/services/node-flow-service.js";
import type { NodeFlowGraph } from "../../../src/contracts/node-flow-types.js";

const tempDirs: string[] = [];

async function createService(): Promise<{
  dir: string;
  projectRepository: ProjectManagementRepository;
  service: NodeFlowService;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "node-flow-service-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  return {
    dir,
    projectRepository: new ProjectManagementRepository(storage),
    service: new NodeFlowService(new NodeFlowRepository(storage)),
  };
}

const validGraph = (): NodeFlowGraph => ({
  nodes: [
    { id: "input", type: "input", title: "Input" },
    { id: "agent", type: "agent", title: "Agent" },
  ],
  edges: [{ fromNodeId: "input", toNodeId: "agent" }],
});

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("NodeFlowService", () => {
  it("normalizes create/update input before persistence", async () => {
    const { dir, projectRepository, service } = await createService();
    const project = projectRepository.createProject({
      name: "Node Flow Project",
      sourceType: "local",
      sourceRef: dir,
    });

    const created = service.create(project.id, {
      title: "  Intake flow  ",
      description: "  Collects details  ",
      graph: validGraph(),
    });
    const updated = service.update(created.id, {
      title: "  Intake flow updated  ",
      description: "  Updated description  ",
    });

    expect(created.title).toBe("Intake flow");
    expect(updated.title).toBe("Intake flow updated");
    expect(updated.description).toBe("Updated description");
  });

  it("rejects cyclic graphs before persistence", async () => {
    const { dir, projectRepository, service } = await createService();
    const project = projectRepository.createProject({
      name: "Node Flow Project",
      sourceType: "local",
      sourceRef: dir,
    });
    const graph = validGraph();
    graph.edges.push({ fromNodeId: "agent", toNodeId: "input" });

    expect(() => service.create(project.id, {
      title: "Bad flow",
      graph,
    })).toThrow(/acyclic|validation failed/i);
    expect(service.list(project.id).flows).toEqual([]);
  });

  it("returns structured validation failures without throwing", async () => {
    const { service } = await createService();
    const graph = validGraph();
    graph.edges.push({ fromNodeId: "missing", toNodeId: "agent" });

    const result = service.validate(graph);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "invalid_edge_endpoint" }),
    ]));
  });
});
