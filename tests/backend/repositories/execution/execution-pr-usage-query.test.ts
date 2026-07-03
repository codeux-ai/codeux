import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../../src/repositories/app-db-storage.js";
import { ProjectManagementRepository } from "../../../../src/repositories/project-management-repository.js";
import { ExecutionRepository } from "../../../../src/repositories/execution-repository.js";
import { SettingsRepository } from "../../../../src/repositories/settings-repository.js";

const tempDirs: string[] = [];

async function createRepositories() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-pr-usage-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  const settingsRepository = new SettingsRepository(path.join(dir, "settings.db"));
  return {
    projectRepository: new ProjectManagementRepository(storage),
    executionRepository: new ExecutionRepository(storage, undefined, undefined, settingsRepository),
    settingsRepository,
  };
}

function completeInvocation(
  executionRepository: ExecutionRepository,
  invocationId: string,
  tokens: { input: number; output: number },
) {
  executionRepository.updateProviderInvocationUsage(invocationId, {
    status: "completed",
    finishedAt: new Date().toISOString(),
    inputTokens: tokens.input,
    cachedInputTokens: 0,
    outputTokens: tokens.output,
    reasoningOutputTokens: 0,
    totalTokens: tokens.input + tokens.output,
    usageSource: "reported",
  });
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("ExecutionRepository PR usage queries", () => {
  it("getTaskUsageGroups groups a task's invocations by (provider, model) and prices each group", async () => {
    const { projectRepository, executionRepository } = await createRepositories();
    const project = projectRepository.createProject({ name: "PR Usage Task Project", sourceType: "local", sourceRef: "/workspace/pr-usage-task" });
    const sprint = projectRepository.createSprint(project.id, { name: "Sprint A", goal: "Goal A" });
    const task = projectRepository.createTask(project.id, { sprintId: sprint.id, title: "Task A" });

    const inv1 = executionRepository.createProviderInvocationUsage({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sessionId: "s1",
      provider: "codex",
      purpose: "task_coding",
      model: "gpt-5.5",
    });
    completeInvocation(executionRepository, inv1.id, { input: 1_000_000, output: 1_000_000 });

    const inv2 = executionRepository.createProviderInvocationUsage({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sessionId: "s2",
      provider: "codex",
      purpose: "task_coding",
      model: "gpt-5.5",
    });
    completeInvocation(executionRepository, inv2.id, { input: 500_000, output: 500_000 });

    const groups = executionRepository.getTaskUsageGroups(project.id, task.id);
    expect(groups).toHaveLength(1);
    expect(groups[0].provider).toBe("codex");
    expect(groups[0].model).toBe("gpt-5.5");
    expect(groups[0].usage.invocationCount).toBe(2);
    expect(groups[0].usage.totalTokens).toBe(3_000_000);
    // openai/gpt-5.5 catalogue price: $5/M input, $30/M output -> (1.5M * 5) + (1.5M * 30) = 52.5
    expect(groups[0].usage.totalCostUsd).toBeCloseTo(52.5, 5);
  });

  it("getSprintUsageGroups returns a separate group per (provider, model) across a multi-provider sprint", async () => {
    const { projectRepository, executionRepository } = await createRepositories();
    const project = projectRepository.createProject({ name: "PR Usage Sprint Project", sourceType: "local", sourceRef: "/workspace/pr-usage-sprint" });
    const sprint = projectRepository.createSprint(project.id, { name: "Sprint B", goal: "Goal B" });
    const taskOne = projectRepository.createTask(project.id, { sprintId: sprint.id, title: "Task One" });
    const taskTwo = projectRepository.createTask(project.id, { sprintId: sprint.id, title: "Task Two" });

    const codexInv = executionRepository.createProviderInvocationUsage({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: taskOne.id,
      sessionId: "s1",
      provider: "codex",
      purpose: "task_coding",
      model: "gpt-5.5",
    });
    completeInvocation(executionRepository, codexInv.id, { input: 1_000_000, output: 1_000_000 });

    const claudeInv = executionRepository.createProviderInvocationUsage({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: taskTwo.id,
      sessionId: "s2",
      provider: "claude-code",
      purpose: "task_coding",
      model: "claude-opus-4-6",
    });
    completeInvocation(executionRepository, claudeInv.id, { input: 200_000, output: 100_000 });

    const groups = executionRepository.getSprintUsageGroups(project.id, sprint.id);
    expect(groups).toHaveLength(2);
    const providers = groups.map((g) => g.provider).sort();
    expect(providers).toEqual(["claude-code", "codex"]);

    const totalTokens = groups.reduce((sum, g) => sum + g.usage.totalTokens, 0);
    expect(totalTokens).toBe(2_000_000 + 300_000);
  });

  it("getSprintUsageGroups filters by purpose to isolate planning invocations", async () => {
    const { projectRepository, executionRepository } = await createRepositories();
    const project = projectRepository.createProject({ name: "PR Usage Planning Project", sourceType: "local", sourceRef: "/workspace/pr-usage-planning" });
    const sprint = projectRepository.createSprint(project.id, { name: "Sprint C", goal: "Goal C" });
    const task = projectRepository.createTask(project.id, { sprintId: sprint.id, title: "Task C" });

    const planningInv = executionRepository.createProviderInvocationUsage({
      projectId: project.id,
      sprintId: sprint.id,
      sessionId: "s1",
      provider: "claude-code",
      purpose: "planning",
      model: "claude-opus-4-6",
    });
    completeInvocation(executionRepository, planningInv.id, { input: 10_000, output: 5_000 });

    const codingInv = executionRepository.createProviderInvocationUsage({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sessionId: "s2",
      provider: "codex",
      purpose: "task_coding",
      model: "gpt-5.5",
    });
    completeInvocation(executionRepository, codingInv.id, { input: 100_000, output: 50_000 });

    const planningGroups = executionRepository.getSprintUsageGroups(project.id, sprint.id, "planning");
    expect(planningGroups).toHaveLength(1);
    expect(planningGroups[0].provider).toBe("claude-code");
    expect(planningGroups[0].usage.totalTokens).toBe(15_000);
  });

  it("listProviderInvocationsForTask returns rows oldest-first with the actual model used", async () => {
    const { projectRepository, executionRepository } = await createRepositories();
    const project = projectRepository.createProject({ name: "PR Usage Invocations Project", sourceType: "local", sourceRef: "/workspace/pr-usage-invocations" });
    const sprint = projectRepository.createSprint(project.id, { name: "Sprint D", goal: "Goal D" });
    const task = projectRepository.createTask(project.id, { sprintId: sprint.id, title: "Task D" });

    const first = executionRepository.createProviderInvocationUsage({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sessionId: "s1",
      provider: "claude-code",
      purpose: "task_coding",
      model: "claude-sonnet-5",
    });
    completeInvocation(executionRepository, first.id, { input: 1000, output: 500 });

    const second = executionRepository.createProviderInvocationUsage({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sessionId: "s2",
      provider: "claude-code",
      purpose: "task_coding",
      model: "claude-opus-4-6",
    });
    completeInvocation(executionRepository, second.id, { input: 2000, output: 800 });

    const invocations = executionRepository.listProviderInvocationsForTask(project.id, task.id);
    expect(invocations).toHaveLength(2);
    expect(invocations[invocations.length - 1].model).toBe("claude-opus-4-6");
  });

  it("returns empty arrays for a task/sprint with no invocations", async () => {
    const { projectRepository, executionRepository } = await createRepositories();
    const project = projectRepository.createProject({ name: "PR Usage Empty Project", sourceType: "local", sourceRef: "/workspace/pr-usage-empty" });

    expect(executionRepository.getTaskUsageGroups(project.id, "no-such-task")).toEqual([]);
    expect(executionRepository.getSprintUsageGroups(project.id, "no-such-sprint")).toEqual([]);
    expect(executionRepository.listProviderInvocationsForTask(project.id, "no-such-task")).toEqual([]);
    expect(executionRepository.listProviderInvocationsForSprint(project.id, "no-such-sprint")).toEqual([]);
  });
});
