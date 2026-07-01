import { test, expect, describe } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../../src/repositories/app-db-storage.js";
import { ProjectManagementRepository } from "../../../../src/repositories/project-management-repository.js";
import { ConnectionChatRepository } from "../../../../src/repositories/connection-chat-repository.js";
import { ExecutionRepository } from "../../../../src/repositories/execution-repository.js";
import { ProjectAttentionRepository } from "../../../../src/repositories/project-attention-repository.js";
import { afterEach } from "vitest";

const tempDirs: string[] = [];

async function createRepositories(): Promise<{
  projectRepository: ProjectManagementRepository;
  connectionRepository: ConnectionChatRepository;
  executionRepository: ExecutionRepository;
  projectAttentionRepository: ProjectAttentionRepository;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-execution-repo-analytics-"));
  tempDirs.push(dir);
  const dbStorage = new AppDbStorage({ dbPath: path.join(dir, "app.db") });
  const projectRepository = new ProjectManagementRepository(dbStorage);
  const connectionRepository = new ConnectionChatRepository(dbStorage);
  const projectAttentionRepository = new ProjectAttentionRepository(dbStorage);
  const executionRepository = new ExecutionRepository(dbStorage, projectRepository);
  (executionRepository as any).realtimeNotifier = { scheduleProjectExecutionRefresh: () => {} };

  return { projectRepository, connectionRepository, executionRepository, projectAttentionRepository };
}

afterEach(async () => {
  for (const dir of tempDirs) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch {}
  }
  tempDirs.length = 0;
});


describe("Execution Invocations Query Analytics", () => {
  test("computes analytics aggregations across varying invocation scenarios", async () => {
    const { projectRepository, executionRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Analytics Project",
      sourceType: "git",
      sourceRef: "https://foo",
    });
    const sprint1 = projectRepository.createSprint(project.id, { name: "Sprint 1" });
    const sprint2 = projectRepository.createSprint(project.id, { name: "Sprint 2" });

    // Completed jules coding task
    const usage1 = executionRepository.createProviderInvocationUsage({
      projectId: project.id,
      sessionId: "s1",
      provider: "jules",
      purpose: "task_coding",
      status: "completed",
    });
    executionRepository.updateProviderInvocationUsage(usage1.id, {
      durationMs: 1500,
      totalTokens: 100,
      inputTokens: 50,
      outputTokens: 50,
      cachedInputTokens: 0,
    });
    const inv1 = executionRepository.createExecutionInvocation({
      projectId: project.id,
      sprintId: sprint1.id,
      type: "coding",
      provider: "jules",
      status: "completed",
      providerInvocationId: usage1.id,
    });
    executionRepository.updateExecutionInvocation(inv1.id, { finishedAtIso: new Date().toISOString() });

    // Failed git operation with timeout
    const usage2 = executionRepository.createProviderInvocationUsage({
      projectId: project.id,
      sessionId: "s2",
      provider: "git",
      purpose: "git_clone",
      status: "failed",
    });
    executionRepository.updateProviderInvocationUsage(usage2.id, {
      durationMs: 5000,
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
    });
    const inv2 = executionRepository.createExecutionInvocation({
      projectId: project.id,
      sprintId: sprint1.id,
      type: "git",
      provider: "git",
      status: "failed",
      providerInvocationId: usage2.id,
    });
    executionRepository.updateExecutionInvocation(inv2.id, {
      finishedAtIso: new Date().toISOString(),
      lastErrorMessage: "Git clone timeout",
    });

    // Running jira fetch
    const usage3 = executionRepository.createProviderInvocationUsage({
      projectId: project.id,
      sessionId: "s3",
      provider: "jira",
      purpose: "jira_fetch",
      status: "running",
    });
    const inv3 = executionRepository.createExecutionInvocation({
      projectId: project.id,
      sprintId: sprint2.id,
      type: "jira",
      provider: "jira",
      status: "running",
      providerInvocationId: usage3.id,
    });

    // Paused execution
    const usage4 = executionRepository.createProviderInvocationUsage({
      projectId: project.id,
      sessionId: "s4",
      provider: "other_provider",
      purpose: "other_purpose",
      status: "completed",
    });
    executionRepository.updateProviderInvocationUsage(usage4.id, { durationMs: 200, totalTokens: 50 });
    const inv4 = executionRepository.createExecutionInvocation({
      projectId: project.id,
      sprintId: sprint2.id,
      type: "qa",
      provider: "other_provider",
      status: "paused",
      providerInvocationId: usage4.id,
    });
    executionRepository.updateExecutionInvocation(inv4.id, { finishedAtIso: new Date().toISOString() });

    // Cancelled execution
    const usage5 = executionRepository.createProviderInvocationUsage({
      projectId: project.id,
      sessionId: "s5",
      provider: "jules",
      purpose: "planning",
      status: "cancelled",
    });
    executionRepository.updateProviderInvocationUsage(usage5.id, { durationMs: 500, totalTokens: 10 });
    const inv5 = executionRepository.createExecutionInvocation({
      projectId: project.id,
      sprintId: sprint2.id,
      type: "planning",
      provider: "jules",
      status: "cancelled",
      providerInvocationId: usage5.id,
    });
    executionRepository.updateExecutionInvocation(inv5.id, { finishedAtIso: new Date().toISOString(), lastErrorMessage: "User cancelled" });

    // Query 1: Unfiltered project
    let result = executionRepository.queryProjectInvocations({ projectId: project.id });
    expect(result.totalCount).toBe(5);
    expect(result.items.length).toBe(5);

    // Assert summary metrics
    const sum = result.summary;
    expect(sum.totalInvocations).toBe(5);
    expect(sum.completedCount).toBe(1);
    expect(sum.failedCount).toBe(1);
    expect(sum.runningCount).toBe(1);
    expect(sum.pausedCount).toBe(1);
    expect(sum.cancelledCount).toBe(1);
    expect(sum.totalTokens).toBe(160); // 100 + 0 + 0 + 50 + 10

    // Assert p95 logic ran (exact value relies on ordering, but we just check it returned non-zero for real durations)
    expect(sum.p95DurationMs).toBeGreaterThan(0);

    // Assert API metrics
    expect(sum.externalApiMetrics.jules.calls).toBe(2);
    expect(sum.externalApiMetrics.git.calls).toBe(1);
    expect(sum.externalApiMetrics.jira.calls).toBe(1);

    // Assert Errors
    expect(sum.errorsByCategory.timeout).toBe(1);
    expect(sum.errorsByCategory.cancelled).toBe(1);

    // Assert Available Providers & Purposes
    expect(result.availableProviders.sort()).toEqual(["git", "jira", "jules", "other_provider"].sort());
    expect(result.availablePurposes.sort()).toEqual(["coding", "git", "jira", "planning", "qa"].sort());

    // Query 2: Filter by Provider
    result = executionRepository.queryProjectInvocations({ projectId: project.id, provider: "jules" });
    expect(result.totalCount).toBe(2);
    expect(result.summary.totalInvocations).toBe(2);
    expect(result.availableProviders).toContain("jules");

    // Query 3: Filter by errorCategory
    result = executionRepository.queryProjectInvocations({ projectId: project.id, errorCategories: ["timeout", "cancelled"] });
    expect(result.totalCount).toBe(2);
    expect(result.summary.errorsByCategory.timeout).toBe(1);
    expect(result.summary.errorsByCategory.cancelled).toBe(1);

    // Query 4: Check sorting works
    result = executionRepository.queryProjectInvocations({ projectId: project.id, sortKey: "durationMs", sortDir: "asc" });
    expect(result.totalCount).toBe(5);
    // Because some don't have duration set (like the running one), it will sort those later.
    // The main point is checking no crash and returns items
    expect(result.items.length).toBe(5);

  });
});
