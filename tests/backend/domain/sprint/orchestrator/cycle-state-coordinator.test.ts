import { describe, expect, it, vi } from "vitest";
import { CycleStateCoordinator } from "../../../../../src/domain/sprint/orchestrator/cycle-state-coordinator.js";

describe("CycleStateCoordinator", () => {
  describe("syncProtocolAttentionItems", () => {
    it("batches attention items into a single openItems call", async () => {
      const deps = {
        projectAttentionService: {
          openItems: vi.fn(),
          resolveItems: vi.fn(),
        },
      } as any;

      const coordinator = new CycleStateCoordinator(deps);

      const subtasks = [
        { id: "task-1", record_id: "rec-1" },
        { id: "task-2", record_id: "rec-2" },
      ] as any[];

      const protocolResult = {
        awaitingMerge: [
          {
            id: "task-1",
            record_id: "rec-1",
            title: "Task 1",
            prompt: "Prompt 1",
          },
        ] as any[],
        actionRequiredTasks: [
          {
            id: "task-2",
            record_id: "rec-2",
            title: "Task 2",
            prompt: "Prompt 2",
            intervention_owner: "AGENT",
          },
        ] as any[],
      };

      const args = {
        executionContext: {
          project: { id: "proj-1" },
          sprint: { id: "sprint-1" },
        },
        sprintRunId: "run-1",
        defaultFeatureBranch: "main",
        defaultBranch: "main",
        repoPath: "/repo",
        ciIntelligence: {
          resolveMergeConflicts: false,
        },
      } as any;

      await coordinator.syncProtocolAttentionItems(
        subtasks,
        protocolResult,
        args,
        null,
        new Set()
      );

      expect(deps.projectAttentionService.openItems).toHaveBeenCalledTimes(1);

      const openedItems = deps.projectAttentionService.openItems.mock.calls[0][0];
      expect(openedItems).toHaveLength(2);
      expect(openedItems[0].attentionType).toBe("merge_required");
      expect(openedItems[0].taskId).toBe("rec-1");

      expect(openedItems[1].attentionType).toBe("action_required");
      expect(openedItems[1].taskId).toBe("rec-2");
    });
  });
});
