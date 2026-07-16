import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { QaReviewRepository } from "../../../src/repositories/qa-review-repository.js";
import { AgentPresetRepository } from "../../../src/repositories/agent-preset-repository.js";

const tempDirs: string[] = [];

const createRepository = async (): Promise<{
  dir: string;
  repository: QaReviewRepository;
  projectRepository: ProjectManagementRepository;
  agentPresetRepository: AgentPresetRepository;
}> => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "qa-review-repo-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  return {
    dir,
    repository: new QaReviewRepository(storage),
    projectRepository: new ProjectManagementRepository(storage),
    agentPresetRepository: new AgentPresetRepository(storage),
  };
};

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("QaReviewRepository", () => {
  it("records a manual sprint pass as the latest QA cycle and closes running review rows", async () => {
    const { repository, projectRepository } = await createRepository();
    const project = projectRepository.createProject({
      name: "QA Project",
      sourceType: "local",
      sourceRef: path.join(os.tmpdir(), "qa-manual-pass"),
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Sprint 1",
      goal: "Ship",
    });
    const running = repository.createRun({
      projectId: project.id,
      sprintId: sprint.id,
      triggerType: "sprint_completion",
      runIndex: 2,
    });

    const manualPass = repository.recordManualSprintPass({
      projectId: project.id,
      sprintId: sprint.id,
    });

    expect(repository.getRun(running.id)).toMatchObject({ status: "cancelled" });
    expect(manualPass).toMatchObject({
      status: "completed",
      outcome: "pass",
      runIndex: 3,
      agentName: "Manual QA",
      payload: expect.objectContaining({ manual: true, source: "dashboard" }),
    });
    expect(repository.listLatestSprintCycleRuns(sprint.id)).toEqual([
      expect.objectContaining({ id: manualPass.id }),
    ]);
  });

  it("tracks task review runs and sprint review presence", async () => {
    const { repository, projectRepository } = await createRepository();
    const project = projectRepository.createProject({
      name: "QA Project",
      sourceType: "local",
      sourceRef: path.join(os.tmpdir(), "qa-project"),
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Sprint 1",
      goal: "Ship the QA feature",
      status: "active",
      featureBranch: "feature/sprint-1",
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Implement QA card",
      promptMarkdown: "Build the QA settings card.",
      status: "coding_completed",
      isIndependent: true,
    });

    const taskRun = repository.createRun({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      triggerType: "task_completion",
      runIndex: 1,
      agentName: "Quality Assurance Agent",
      targetTaskKey: "T1",
      targetSessionId: "session-1",
      targetProvider: "codex",
      payload: { summary: "initial review" },
    });

    expect(repository.countTaskRuns(task.id)).toBe(0);

    const completedTaskRun = repository.updateRun(taskRun.id, {
      status: "completed",
      outcome: "changes_requested",
      summaryMarkdown: "Needs a follow-up fix",
      fixInstructions: "Address the missing validation path.",
      finishedAt: new Date().toISOString(),
    });

    expect(completedTaskRun.outcome).toBe("changes_requested");
    expect(repository.countTaskRuns(task.id)).toBe(1);
    expect(repository.listRunsForTask(task.id)).toHaveLength(1);
    expect(repository.getLatestTaskRun(task.id)?.id).toBe(completedTaskRun.id);

    const cancelledTaskRun = repository.createRun({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      triggerType: "task_completion",
      runIndex: 2,
    });
    repository.updateRun(cancelledTaskRun.id, {
      status: "cancelled",
      summaryMarkdown: "Recovered stale QA review run after its container disappeared.",
      finishedAt: new Date().toISOString(),
    });
    expect(repository.countTaskRuns(task.id)).toBe(2);
    expect(repository.countDecisiveTaskRuns(task.id)).toBe(1);
    const snapshots = repository.listTaskReviewSnapshots([task.id, "task-without-reviews", task.id]);
    expect(snapshots.get(task.id)).toMatchObject({
      latestRun: expect.objectContaining({ id: cancelledTaskRun.id }),
      latestCycleRuns: [expect.objectContaining({ id: cancelledTaskRun.id })],
      runsUsed: 2,
      decisiveRuns: 1,
    });
    expect(snapshots.get("task-without-reviews")).toEqual({
      latestRun: null,
      latestCycleRuns: [],
      runsUsed: 0,
      decisiveRuns: 0,
    });

    expect(repository.hasSprintReviewRun(sprint.id)).toBe(false);

    const sprintRun = repository.createRun({
      projectId: project.id,
      sprintId: sprint.id,
      triggerType: "sprint_completion",
      runIndex: 1,
      payload: { summary: "sprint review" },
    });

    expect(repository.hasSprintReviewRun(sprint.id)).toBe(true);

    const storedSprintRun = repository.getRun(sprintRun.id);
    expect(storedSprintRun?.triggerType).toBe("sprint_completion");
    expect(storedSprintRun?.payload).toEqual({ summary: "sprint review" });
    expect(repository.getLatestSprintRun(sprint.id)?.id).toBe(sprintRun.id);

    expect(repository.resetSprintReviewRuns(sprint.id)).toBe(1);
    expect(repository.getLatestSprintRun(sprint.id)).toBeNull();
    expect(repository.hasSprintReviewRun(sprint.id)).toBe(false);
    expect(repository.getLatestTaskRun(task.id)?.id).toBe(cancelledTaskRun.id);
  });

  it("counts only decisive (completed) runs toward the verdict budget", async () => {
    const { repository, projectRepository } = await createRepository();
    const project = projectRepository.createProject({
      name: "QA Project",
      sourceType: "local",
      sourceRef: path.join(os.tmpdir(), "qa-decisive"),
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Sprint 1",
      goal: "Ship",
      status: "active",
      featureBranch: "feature/sprint-1",
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Task",
      promptMarkdown: "Do the thing.",
      status: "coding_completed",
      isIndependent: true,
    });

    // One reviewer infra crash (failed, no verdict) ...
    const infraRun = repository.createRun({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      triggerType: "completed_task_without_pr",
      runIndex: 1,
    });
    repository.updateRun(infraRun.id, {
      status: "failed",
      summaryMarkdown: "Virtual QA worker failed: missing auth.",
      finishedAt: new Date().toISOString(),
    });

    // ... and one real verdict (completed).
    const verdictRun = repository.createRun({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      triggerType: "completed_task_without_pr",
      runIndex: 2,
    });
    repository.updateRun(verdictRun.id, {
      status: "completed",
      outcome: "changes_requested",
      summaryMarkdown: "Still missing the work.",
      finishedAt: new Date().toISOString(),
    });

    // Total attempts (for the infra ceiling) includes the crash; the verdict
    // budget only counts the decisive run.
    expect(repository.countTaskRuns(task.id)).toBe(2);
    expect(repository.countDecisiveTaskRuns(task.id)).toBe(1);

    // A rerun clears the per-task QA history so the fresh attempt is reviewed.
    const cleared = repository.resetTaskReviewRuns(task.id);
    expect(cleared).toBe(2);
    expect(repository.countTaskRuns(task.id)).toBe(0);
    expect(repository.countDecisiveTaskRuns(task.id)).toBe(0);
    expect(repository.getLatestTaskRun(task.id)).toBeNull();
  });

  it("counts multi-reviewer task rows as one review cycle", async () => {
    const { repository, projectRepository, agentPresetRepository } = await createRepository();
    const project = projectRepository.createProject({
      name: "QA Project",
      sourceType: "local",
      sourceRef: path.join(os.tmpdir(), "qa-multi-cycle"),
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Sprint 1",
      goal: "Ship",
      status: "active",
      featureBranch: "feature/sprint-1",
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Task",
      promptMarkdown: "Do the thing.",
      status: "coding_completed",
      isIndependent: true,
    });
    const qaA = agentPresetRepository.createAgentPreset(project.id, {
      name: "QA A",
      presetId: "qa-a",
      instructionMarkdown: "Review as A.",
    });
    const qaB = agentPresetRepository.createAgentPreset(project.id, {
      name: "QA B",
      presetId: "qa-b",
      instructionMarkdown: "Review as B.",
    });

    const passRun = repository.createRun({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      triggerType: "task_completion",
      runIndex: 1,
      agentPresetId: qaA.id,
      agentName: "QA A",
    });
    repository.updateRun(passRun.id, {
      status: "completed",
      outcome: "pass",
      summaryMarkdown: "A passed.",
      finishedAt: new Date().toISOString(),
    });
    const changesRun = repository.createRun({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      triggerType: "task_completion",
      runIndex: 1,
      agentPresetId: qaB.id,
      agentName: "QA B",
    });
    repository.updateRun(changesRun.id, {
      status: "completed",
      outcome: "changes_requested",
      summaryMarkdown: "B requested changes.",
      finishedAt: new Date().toISOString(),
    });

    expect(repository.countTaskRuns(task.id)).toBe(1);
    expect(repository.countDecisiveTaskRuns(task.id)).toBe(1);
    expect(repository.listLatestTaskCycleRuns(task.id).map((run) => run.agentPresetId).sort()).toEqual([qaA.id, qaB.id].sort());
    expect(repository.getLatestTaskRun(task.id)?.id).toBe(changesRun.id);
  });
});
