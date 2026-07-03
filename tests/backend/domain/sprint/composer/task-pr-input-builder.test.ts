import { describe, expect, it, vi } from "vitest";
import type { AiProviderSettings, Subtask } from "../../../../../src/contracts/app-types.js";
import type { ExecutionRepository } from "../../../../../src/repositories/execution-repository.js";
import { buildTaskPrComposerInput } from "../../../../../src/domain/sprint/composer/task-pr-input-builder.js";

const allSections = {
  summary: true,
  modelAndProvider: true,
  timing: true,
  fullPrompt: true,
  tokenUsage: true,
  qaFindings: true,
  branchInfo: true,
};

describe("buildTaskPrComposerInput", () => {
  it("uses the persisted task record id for telemetry while rendering the task key", () => {
    const getTaskUsageGroups = vi.fn(() => [
      {
        provider: "codex",
        model: "google/gemma-4-26b-a4b-qat",
        usage: {
          invocationCount: 1,
          activeTimeMs: 1000,
          wallTimeMs: 1000,
          inputTokens: 100,
          cachedInputTokens: 0,
          outputTokens: 20,
          reasoningOutputTokens: 0,
          totalTokens: 120,
          inputCostUsd: 0,
          outputCostUsd: 0,
          cachedInputCostUsd: 0,
          totalCostUsd: 0.01,
          toolCallCount: 2,
          reportedInvocationCount: 1,
          estimatedInvocationCount: 0,
          unsupportedInvocationCount: 0,
          unavailableInvocationCount: 0,
        },
      },
    ]);
    const listProviderInvocationsForTask = vi.fn(() => [
      {
        model: "google/gemma-4-26b-a4b-qat",
      },
    ]);

    const executionRepository = {
      getTaskUsageGroups,
      listProviderInvocationsForTask,
    } as unknown as ExecutionRepository;

    const task: Subtask = {
      id: "T01",
      record_id: "task-record-1",
      title: "Update smoke-test-task-1.md",
      prompt: "Append the current system time.",
      depends_on: [],
      is_independent: true,
      status: "COMPLETED",
    };

    const aiProviderSettings = {
      provider: "codex-local",
      strategy: "MANUAL",
      providers: {
        "codex-local": {
          provider: "codex",
          name: "Codex Local",
          enabled: true,
          model: "gpt-5.5",
          customModel: "google/gemma-4-26b-a4b-qat",
          weight: 50,
          thinkingMode: "HIGH",
          apiKey: "test",
          mountAuth: false,
          authPath: "",
          maxConcurrentTasks: 0,
        },
      },
      invocationRouting: {},
    } as unknown as AiProviderSettings;

    const input = buildTaskPrComposerInput({
      projectId: "project-1",
      task,
      sprint: null,
      provider: "codex",
      featureBranch: "feature/sprint",
      workerBranch: "feature/sprint/T01-codex",
      taskRun: null,
      aiProviderSettings,
      sections: allSections,
      executionRepository,
    });

    expect(getTaskUsageGroups).toHaveBeenCalledWith("project-1", "task-record-1");
    expect(listProviderInvocationsForTask).toHaveBeenCalledWith("project-1", "task-record-1");
    expect(input.taskId).toBe("T01");
    expect(input.model).toBe("google/gemma-4-26b-a4b-qat");
    expect(input.usage?.invocationCount).toBe(1);
  });

  it("uses an explicit completion timestamp for PR timing before the task run is persisted complete", () => {
    const task: Subtask = {
      id: "T01",
      title: "Implement rails",
      prompt: "Build the task.",
      depends_on: [],
      is_independent: true,
      status: "IN_PROGRESS",
    };

    const input = buildTaskPrComposerInput({
      projectId: "project-1",
      task,
      sprint: null,
      provider: "codex",
      featureBranch: "feature/sprint",
      workerBranch: "feature/sprint/T01-codex",
      taskRun: {
        id: "run-1",
        projectId: "project-1",
        sprintId: "sprint-1",
        sprintRunId: "sprint-run-1",
        taskId: "task-record-1",
        dispatchId: "dispatch-1",
        provider: "codex",
        mode: "docker_cli",
        connectionId: null,
        sessionId: "session-1",
        sessionName: null,
        state: "RUNNING",
        workerBranch: "feature/sprint/T01-codex",
        prUrl: null,
        startedAt: "2026-07-03T02:18:16.000Z",
        finishedAt: null,
        durationMs: null,
      },
      completionTimestamp: "2026-07-03T02:31:30.000Z",
      aiProviderSettings: {
        provider: "codex",
        strategy: "SINGLE",
        providers: {},
        invocationRouting: {},
      } as unknown as AiProviderSettings,
      sections: allSections,
    });

    expect(input.startedAt).toBe("2026-07-03T02:18:16.000Z");
    expect(input.finishedAt).toBe("2026-07-03T02:31:30.000Z");
    expect(input.durationMs).toBe(13 * 60 * 1000 + 14 * 1000);
  });
});
