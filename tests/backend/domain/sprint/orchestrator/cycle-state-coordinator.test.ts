import { describe, expect, it, vi } from "vitest";
import {
  CycleStateCoordinator,
  hasMergeStateChanges,
} from "../../../../../src/domain/sprint/orchestrator/cycle-state-coordinator.js";

describe("CycleStateCoordinator", () => {
  describe("hasMergeStateChanges", () => {
    it("detects merge indicator changes even when merged state is unchanged", () => {
      const previous = new Map([
        ["T01", { id: "T01", status: "CODING_COMPLETED", isMerged: false, mergeIndicator: "CI" }],
      ]);

      expect(hasMergeStateChanges(previous as any, [
        { id: "T01", status: "CODING_COMPLETED", is_merged: false, merge_indicator: "MERGE_CONFLICT" },
      ] as any)).toBe(true);
    });

    it("does not report a change when merge state and indicator are unchanged", () => {
      const previous = new Map([
        ["T01", { id: "T01", status: "CODING_COMPLETED", isMerged: false, mergeIndicator: "MERGE_CONFLICT" }],
      ]);

      expect(hasMergeStateChanges(previous as any, [
        { id: "T01", status: "CODING_COMPLETED", is_merged: false, merge_indicator: "MERGE_CONFLICT" },
      ] as any)).toBe(false);
    });
  });

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

    it("does not convert CI merge waits into human-owned CI-fix attention", async () => {
      const deps = {
        projectAttentionService: {
          openItems: vi.fn(),
          resolveItems: vi.fn(),
        },
      } as any;

      const coordinator = new CycleStateCoordinator(deps);
      const subtasks = [
        {
          id: "task-1",
          record_id: "rec-1",
          title: "Task 1",
          prompt: "Prompt 1",
          status: "CODING_COMPLETED",
          merge_indicator: "CI",
          pr_url: "https://example.com/pr/1",
        },
      ] as any[];
      const protocolResult = {
        awaitingMerge: subtasks,
        actionRequiredTasks: [] as any[],
      };
      const args = {
        executionContext: {
          project: { id: "proj-1" },
          sprint: { id: "sprint-1" },
        },
        sprintRunId: "run-1",
        defaultFeatureBranch: "feature/sprint-1",
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
        {
          available: true,
          openPullRequests: [
            {
              number: 1,
              url: "https://example.com/pr/1",
              headRefName: "worker/task-1",
              mergeStateStatus: "CLEAN",
            },
          ],
        } as any,
        new Set(),
      );

      expect(deps.projectAttentionService.openItems).toHaveBeenCalledWith([
        expect.objectContaining({
          attentionType: "merge_required",
          ownerType: "worker",
          severity: "medium",
          title: "Merge required for task-1",
          taskId: "rec-1",
          payload: expect.objectContaining({
            mergeIndicator: "CI",
            prNumber: 1,
          }),
        }),
      ]);
      expect(deps.projectAttentionService.resolveItems).toHaveBeenCalledWith(expect.arrayContaining([
        {
          filter: { projectId: "proj-1", taskId: "rec-1", attentionTypes: ["merge_conflict"] },
          resolution: { status: "resolved", reason: "merge_required_attention_replaced" },
        },
      ]));
    });

    it("includes the resolved session id on action_required payloads so the virtual worker can intervene", async () => {
      const deps = {
        projectAttentionService: {
          openItems: vi.fn(),
          resolveItems: vi.fn(),
        },
      } as any;

      const coordinator = new CycleStateCoordinator(deps);

      const subtasks = [{ id: "task-1", record_id: "rec-1" }] as any[];

      const protocolResult = {
        awaitingMerge: [] as any[],
        actionRequiredTasks: [
          {
            id: "task-1",
            record_id: "rec-1",
            title: "Task 1",
            prompt: "Prompt 1",
            intervention_owner: "AGENT",
            session_state: "AWAITING_USER_FEEDBACK",
            session_id: "sessions/3478292433877515748",
            session_name: "sessions/3478292433877515748",
          },
        ] as any[],
      };

      const args = {
        executionContext: { project: { id: "proj-1" }, sprint: { id: "sprint-1" } },
        sprintRunId: "run-1",
        defaultFeatureBranch: "main",
        defaultBranch: "main",
        repoPath: "/repo",
        ciIntelligence: { resolveMergeConflicts: false },
      } as any;

      await coordinator.syncProtocolAttentionItems(subtasks, protocolResult, args, null, new Set());

      const openedItems = deps.projectAttentionService.openItems.mock.calls[0][0];
      const actionItem = openedItems.find((item: any) => item.attentionType === "action_required");
      expect(actionItem).toBeDefined();
      // Bare id (sessions/ prefix stripped) is what julesApi.sendSessionMessage expects.
      expect(actionItem.payload.sessionId).toBe("3478292433877515748");
    });

    it("keeps active worker CI-fix attention while checks are being re-evaluated", async () => {
      const deps = {
        projectAttentionService: {
          openItems: vi.fn(),
          resolveItems: vi.fn(),
        },
      } as any;

      const coordinator = new CycleStateCoordinator(deps);
      const subtasks = [
        {
          id: "task-1",
          record_id: "rec-1",
          title: "Task 1",
          status: "CODING_COMPLETED",
          merge_indicator: null,
        },
      ] as any[];
      const protocolResult = {
        awaitingMerge: [],
        actionRequiredTasks: [] as any[],
      };
      const args = {
        executionContext: { project: { id: "proj-1" }, sprint: { id: "sprint-1" } },
        sprintRunId: "run-1",
        defaultFeatureBranch: "feature/sprint-1",
        defaultBranch: "main",
        repoPath: "/repo",
        ciIntelligence: { resolveMergeConflicts: false },
      } as any;

      await coordinator.syncProtocolAttentionItems(
        subtasks,
        protocolResult,
        args,
        null,
        new Set(),
        new Set(),
        undefined,
        new Set(["rec-1"]),
      );

      const resolvePayload = deps.projectAttentionService.resolveItems.mock.calls[0]?.[0] || [];
      expect(resolvePayload).toEqual(expect.arrayContaining([
        expect.objectContaining({
          filter: { projectId: "proj-1", taskId: "rec-1", attentionTypes: ["merge_required", "merge_conflict"] },
        }),
        expect.objectContaining({
          filter: { projectId: "proj-1", taskId: "rec-1", attentionTypes: ["action_required"] },
        }),
      ]));
      expect(resolvePayload).not.toEqual(expect.arrayContaining([
        expect.objectContaining({
          filter: { projectId: "proj-1", taskId: "rec-1", attentionTypes: ["ci_fix_required"] },
        }),
      ]));
    });

    it("does not clear merge attention for tasks still waiting in CI", async () => {
      const deps = {
        projectAttentionService: {
          openItems: vi.fn(),
          resolveItems: vi.fn(),
        },
      } as any;

      const coordinator = new CycleStateCoordinator(deps);
      const subtasks = [
        {
          id: "task-1",
          record_id: "rec-1",
          title: "Task 1",
          status: "CODING_COMPLETED",
          merge_indicator: "CI",
          pr_url: "https://example.com/pr/1",
        },
      ] as any[];
      const protocolResult = {
        awaitingMerge: [],
        actionRequiredTasks: [] as any[],
      };
      const args = {
        executionContext: { project: { id: "proj-1" }, sprint: { id: "sprint-1" } },
        sprintRunId: "run-1",
        defaultFeatureBranch: "feature/sprint-1",
        defaultBranch: "main",
        repoPath: "/repo",
        ciIntelligence: { resolveMergeConflicts: false },
      } as any;

      await coordinator.syncProtocolAttentionItems(
        subtasks,
        protocolResult,
        args,
        null,
        new Set(),
        new Set(),
        undefined,
        new Set(),
      );

      const resolvePayload = deps.projectAttentionService.resolveItems.mock.calls[0]?.[0] || [];
      expect(resolvePayload).not.toEqual(expect.arrayContaining([
        expect.objectContaining({
          filter: { projectId: "proj-1", taskId: "rec-1", attentionTypes: ["merge_required", "merge_conflict"] },
        }),
      ]));
      expect(resolvePayload).toEqual(expect.arrayContaining([
        expect.objectContaining({
          filter: { projectId: "proj-1", taskId: "rec-1", attentionTypes: ["action_required"] },
        }),
      ]));
    });
  });
});
