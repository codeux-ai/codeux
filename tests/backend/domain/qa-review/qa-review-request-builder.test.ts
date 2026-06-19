import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildQaReviewRequest, resolveTaskTriggerType } from "../../../../src/domain/qa-review/qa-review-request-builder.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../../src/repositories/settings-defaults.js";
import type { DashboardSettings, Subtask } from "../../../../src/contracts/app-types.js";

vi.mock("../../../../src/services/agent-memory-instructions.js", () => ({
  resolveAgentMemoryInstructions: vi.fn((agent, memoryInstructions) => {
    return memoryInstructions ? `Mock memory: ${memoryInstructions}` : "";
  }),
}));

describe("qa-review-request-builder", () => {
  let mockSettings: DashboardSettings;

  beforeEach(() => {
    mockSettings = JSON.parse(JSON.stringify(DEFAULT_DASHBOARD_SETTINGS));
    mockSettings.agents.qualityAssurance.enabled = true;
    mockSettings.agents.qualityAssurance.maxTaskReviewRuns = 3;
    mockSettings.agents.qualityAssurance.taskCompletion.enabled = true;
    mockSettings.agents.qualityAssurance.completedTaskWithoutPr.enabled = true;
  });

  describe("resolveTaskTriggerType", () => {
    it("returns completed_task_without_pr when task has no PR/branch and feature is enabled", () => {
      const task = { pr_url: "", worker_branch: "", is_merged: false } as Subtask;
      expect(resolveTaskTriggerType(task, mockSettings.agents.qualityAssurance)).toBe("completed_task_without_pr");
    });

    it("returns task_completion when task has a PR url", () => {
      const task = { pr_url: "http://github.com/pr/1", worker_branch: "", is_merged: false } as Subtask;
      expect(resolveTaskTriggerType(task, mockSettings.agents.qualityAssurance)).toBe("task_completion");
    });

    it("returns null if task_completion is disabled and task has a PR", () => {
      mockSettings.agents.qualityAssurance.taskCompletion.enabled = false;
      const task = { pr_url: "http://github.com/pr/1", worker_branch: "", is_merged: false } as Subtask;
      expect(resolveTaskTriggerType(task, mockSettings.agents.qualityAssurance)).toBeNull();
    });
  });

  describe("buildQaReviewRequest", () => {
    const defaultProject = { id: "proj-1", name: "Project 1" };
    const defaultSprint = { id: "sprint-1", number: 1, featureBranch: "feature/sprint-1", goal: "Goal" };
    const defaultTask = { id: "task-1", record_id: "rec-1", session_id: null, provider: null, pr_url: "", worker_branch: "", is_merged: false };
    const defaultBudgetArgs = { existingRuns: 0, decisiveRuns: 0, latestRun: null };

    const resolveAgent = vi.fn().mockResolvedValue({
      id: "agent-1",
      name: "QA Agent",
      instructionMarkdown: "Agent instructions here.",
    });

    it("returns null when project or sprint is missing", async () => {
      expect(await buildQaReviewRequest({
        task: defaultTask, taskRun: null, project: null, sprint: defaultSprint, sprintRunId: null, settings: mockSettings, budgetArgs: defaultBudgetArgs, resolveAgent
      })).toBeNull();

      expect(await buildQaReviewRequest({
        task: defaultTask, taskRun: null, project: defaultProject, sprint: null, sprintRunId: null, settings: mockSettings, budgetArgs: defaultBudgetArgs, resolveAgent
      })).toBeNull();
    });

    it("returns null when QA is disabled", async () => {
      mockSettings.agents.qualityAssurance.enabled = false;
      expect(await buildQaReviewRequest({
        task: defaultTask, taskRun: null, project: defaultProject, sprint: defaultSprint, sprintRunId: null, settings: mockSettings, budgetArgs: defaultBudgetArgs, resolveAgent
      })).toBeNull();
    });

    it("returns null when trigger type cannot be resolved", async () => {
      mockSettings.agents.qualityAssurance.completedTaskWithoutPr.enabled = false;
      mockSettings.agents.qualityAssurance.taskCompletion.enabled = false;
      expect(await buildQaReviewRequest({
        task: defaultTask, taskRun: null, project: defaultProject, sprint: defaultSprint, sprintRunId: null, settings: mockSettings, budgetArgs: defaultBudgetArgs, resolveAgent
      })).toBeNull();
    });

    it("returns null when budget is exhausted", async () => {
      const result = await buildQaReviewRequest({
        task: defaultTask, taskRun: null, project: defaultProject, sprint: defaultSprint, sprintRunId: null, settings: mockSettings,
        budgetArgs: { existingRuns: 5, decisiveRuns: 5, latestRun: null }, resolveAgent
      });
      expect(result).toBeNull();
    });

    it("builds a QA review request for a completed task without PR", async () => {
      mockSettings.agents.qualityAssurance.completedTaskWithoutPr.agentPresetId = "no-pr-agent";
      const result = await buildQaReviewRequest({
        task: defaultTask, taskRun: null, project: defaultProject, sprint: defaultSprint, sprintRunId: null, settings: mockSettings, budgetArgs: defaultBudgetArgs, resolveAgent
      });

      expect(result).not.toBeNull();
      expect(result?.triggerType).toBe("completed_task_without_pr");
      expect(result?.agentPresetId).toBe("agent-1"); // mocked to return this
      expect(result?.sprintFeatureBranch).toBe("feature/sprint-1");
      expect(result?.agentInstructions).toContain("Agent instructions here.");
      expect(resolveAgent).toHaveBeenCalledWith("proj-1", "no-pr-agent");
    });

    it("builds a QA review request for a task completion with memory instructions", async () => {
      mockSettings.agents.qualityAssurance.taskCompletion.agentPresetId = "pr-agent";
      mockSettings.memory = { enabled: true, workerLearningsInstruction: "Capture learnings.", autoCaptureSprint: true, syncToQwen: false };

      const taskWithPr = { ...defaultTask, pr_url: "http://github.com/pr/1" };
      const result = await buildQaReviewRequest({
        task: taskWithPr, taskRun: { id: "run-1", taskId: "task-1", workerBranch: "b" }, project: defaultProject, sprint: defaultSprint, sprintRunId: null, settings: mockSettings, budgetArgs: defaultBudgetArgs, resolveAgent
      });

      expect(result).not.toBeNull();
      expect(result?.triggerType).toBe("task_completion");
      expect(result?.agentInstructions).toContain("Mock memory: Capture learnings.");
      expect(resolveAgent).toHaveBeenCalledWith("proj-1", "pr-agent");

      expect(result?.runPayload.taskId).toBe("rec-1");
      expect(result?.runPayload.taskRunId).toBe("run-1");
      expect(result?.runPayload.runIndex).toBe(1);
    });

    it("builds a request when agentPresetId is null, falling back to the default QA agent", async () => {
      // Regression guard: a null taskCompletion.agentPresetId is the default case.
      // The builder must NOT bail — resolveAgent supplies the project's default QA
      // agent. An early return here silently skips QA and blocks every merge.
      mockSettings.agents.qualityAssurance.taskCompletion.agentPresetId = null;
      const taskWithPr = { ...defaultTask, pr_url: "http://github.com/pr/1" };

      const result = await buildQaReviewRequest({
        task: taskWithPr, taskRun: null, project: defaultProject, sprint: defaultSprint, sprintRunId: null, settings: mockSettings, budgetArgs: defaultBudgetArgs, resolveAgent
      });

      expect(result).not.toBeNull();
      expect(result?.triggerType).toBe("task_completion");
      expect(resolveAgent).toHaveBeenCalledWith("proj-1", null);
      expect(result?.agentPresetId).toBe("agent-1"); // resolved default agent id
    });

    it("computes default feature branch if sprint featureBranch is missing", async () => {
      const sprintWithoutBranch = { ...defaultSprint, featureBranch: "" };
      mockSettings.git.featureBranchPrefix = "my-feat/";
      mockSettings.agents.qualityAssurance.taskCompletion.agentPresetId = "pr-agent";
      const taskWithPr = { ...defaultTask, pr_url: "http://github.com/pr/1" };

      const result = await buildQaReviewRequest({
        task: taskWithPr, taskRun: null, project: defaultProject, sprint: sprintWithoutBranch, sprintRunId: null, settings: mockSettings, budgetArgs: defaultBudgetArgs, resolveAgent
      });

      expect(result?.sprintFeatureBranch).toBe("my-feat/sprint-1");
    });
  });
});
