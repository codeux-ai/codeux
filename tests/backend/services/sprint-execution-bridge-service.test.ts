import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { ProjectRuntimeRepository } from "../../../src/repositories/project-runtime-repository.js";
import { SprintExecutionBridgeService } from "../../../src/services/sprint-execution-bridge-service.js";

const tempDirs: string[] = [];

async function createBridge(): Promise<{
  projectRepository: ProjectManagementRepository;
  runtimeRepository: ProjectRuntimeRepository;
  bridge: SprintExecutionBridgeService;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-os-execution-bridge-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  const projectRepository = new ProjectManagementRepository(storage);
  const runtimeRepository = new ProjectRuntimeRepository(storage);
  const bridge = new SprintExecutionBridgeService(projectRepository, runtimeRepository);
  return { projectRepository, runtimeRepository, bridge };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("SprintExecutionBridgeService", () => {
  it("resolves project-scoped execution context and materializes subtasks from sqlite", async () => {
    const { projectRepository, bridge } = await createBridge();
    const repoPath = path.join(os.tmpdir(), `sprint-os-bridge-repo-${Date.now().toString(36)}`);
    await fs.mkdir(repoPath, { recursive: true });
    tempDirs.push(repoPath);

    const project = projectRepository.createProject({
      name: "Execution Project",
      sourceType: "local",
      sourceRef: repoPath,
      featureBranchPrefix: "release/",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Execution Sprint",
      number: 3,
      featureBranch: "release/sprint3-runtime",
    });
    projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      taskKey: "T01",
      title: "Wire execution context",
      promptMarkdown: "Materialize sqlite tasks for orchestration.",
      status: "pending",
    });

    const context = await bridge.resolveContext({
      project_id: project.id,
      sprint_number: 3,
      action: "orchestrate",
    });

    expect(context).toMatchObject({
      repoPath,
      featureBranch: "release/sprint3-runtime",
      taskCount: 1,
    });

    await bridge.materializeSubtasks(context!);

    const taskMarkdown = await fs.readFile(path.join(context!.subtasksDir, "T01.md"), "utf-8");
    expect(taskMarkdown).toContain("title: Wire execution context");
    expect(taskMarkdown).toContain("Materialize sqlite tasks for orchestration.");
  });

  it("syncs merged flags back into sqlite and rematerializes the compatibility file", async () => {
    const { projectRepository, bridge } = await createBridge();
    const repoPath = path.join(os.tmpdir(), `sprint-os-bridge-merge-${Date.now().toString(36)}`);
    await fs.mkdir(repoPath, { recursive: true });
    tempDirs.push(repoPath);

    const project = projectRepository.createProject({
      name: "Merge Project",
      sourceType: "local",
      sourceRef: repoPath,
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Merge Sprint",
      number: 5,
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      taskKey: "T02",
      title: "Merge task",
      promptMarkdown: "Update merged state in sqlite.",
      status: "completed",
    });

    const context = await bridge.resolveContext({
      project_id: project.id,
      sprint_number: 5,
      action: "status",
    });
    await bridge.materializeSubtasks(context!);

    const updated = await bridge.setTaskMergedFlag({
      repoPath,
      sprintNumber: 5,
      taskId: "T02",
      merged: true,
    });

    expect(updated).toBe(true);
    expect(projectRepository.getTask(task.id)).toMatchObject({
      isMerged: true,
      mergeIndicator: "MERGED",
    });

    const taskMarkdown = await fs.readFile(path.join(context!.subtasksDir, "T02.md"), "utf-8");
    expect(taskMarkdown).toContain("merged: true");
  });
});
