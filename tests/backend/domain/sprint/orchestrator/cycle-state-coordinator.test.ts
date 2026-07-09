import { describe, expect, it, vi } from "vitest";
import {
  buildResolvedWorkerMergeConflictKey,
  CycleStateCoordinator,
  hasMergeStateChanges,
  isTaskLevelHumanMergeConflictEscalation,
  shouldEscalateFeatureMergeConflict,
} from "../../../../../src/domain/sprint/orchestrator/cycle-state-coordinator.js";

describe("CycleStateCoordinator", () => {
  describe("shouldEscalateFeatureMergeConflict", () => {
    it("does not keep stale worker conflict attention alive after the task marker is cleared", () => {
      const task = {
        id: "T01",
        record_id: "task-1",
        status: "CODING_COMPLETED",
        merge_indicator: undefined,
      };

      expect(shouldEscalateFeatureMergeConflict(
        task as any,
        { ciIntelligence: { resolveMergeConflicts: true } } as any,
        null,
        new Set(["task-1"]),
      )).toBe(false);
    });

    it("does not reopen a stale worker conflict snapshot for an already resolved branch pair", () => {
      const task = {
        id: "T01",
        record_id: "task-1",
        worker_branch: "worker/task-1",
        status: "CODING_COMPLETED",
        merge_indicator: "MERGE_CONFLICT",
      };

      expect(shouldEscalateFeatureMergeConflict(
        task as any,
        {
          ciIntelligence: { resolveMergeConflicts: true },
          defaultFeatureBranch: "feature/sprint",
        } as any,
        null,
        new Set(),
        undefined,
        new Set([
          buildResolvedWorkerMergeConflictKey("task-1", "worker/task-1", "feature/sprint"),
        ]),
      )).toBe(false);
    });

    it("allows a new worker conflict on a different branch pair to escalate", () => {
      const task = {
        id: "T01",
        record_id: "task-1",
        worker_branch: "worker/task-1-rerun",
        status: "CODING_COMPLETED",
        merge_indicator: "MERGE_CONFLICT",
      };

      expect(shouldEscalateFeatureMergeConflict(
        task as any,
        {
          ciIntelligence: { resolveMergeConflicts: true },
          defaultFeatureBranch: "feature/sprint",
        } as any,
        null,
        new Set(),
        undefined,
        new Set([
          buildResolvedWorkerMergeConflictKey("task-1", "worker/task-1", "feature/sprint"),
        ]),
      )).toBe(true);
    });

    it("does not recreate resolved worker conflict attention from stale dirty PR mergeability", () => {
      const task = {
        id: "T01",
        record_id: "task-1",
        worker_branch: "worker/task-1",
        status: "CODING_COMPLETED",
        merge_indicator: null,
      };

      const gitStatus = {
        available: true,
        openPullRequests: [
          {
            number: 1,
            url: "https://example.com/pr/1",
            headRefName: "worker/task-1",
            mergeStateStatus: "DIRTY",
          },
        ],
        mergedPullRequests: [],
      };

      expect(shouldEscalateFeatureMergeConflict(
        task as any,
        { ciIntelligence: { resolveMergeConflicts: true } } as any,
        gitStatus as any,
        new Set(),
        undefined,
        new Set([
          buildResolvedWorkerMergeConflictKey("task-1", "worker/task-1", undefined),
        ]),
      )).toBe(false);
    });
  });

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

    it("uses stable task identity for repeated merge-required observations", async () => {
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
        executionContext: { project: { id: "proj-1" }, sprint: { id: "sprint-1" } },
        sprintRunId: "run-1",
        defaultFeatureBranch: "feature/sprint-1",
        defaultBranch: "main",
        repoPath: "/repo",
        ciIntelligence: { resolveMergeConflicts: false },
      } as any;

      await coordinator.syncProtocolAttentionItems(subtasks, protocolResult, args, null, new Set());
      await coordinator.syncProtocolAttentionItems(subtasks, protocolResult, args, null, new Set());

      expect(deps.projectAttentionService.openItems).toHaveBeenCalledTimes(2);
      const first = deps.projectAttentionService.openItems.mock.calls[0][0][0];
      const second = deps.projectAttentionService.openItems.mock.calls[1][0][0];
      expect(second).toMatchObject({
        projectId: first.projectId,
        sprintId: first.sprintId,
        taskId: first.taskId,
        sprintRunId: first.sprintRunId,
        attentionType: first.attentionType,
        ownerType: first.ownerType,
        title: first.title,
      });
      expect(second.payload).toMatchObject({
        taskKey: first.payload.taskKey,
        mergeIndicator: first.payload.mergeIndicator,
        prUrl: first.payload.prUrl,
      });
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

    it("dismisses stale task-level human merge-conflict handoffs after the task marker is cleared", async () => {
      const deps = {
        projectAttentionService: {
          openItems: vi.fn(),
          resolveItems: vi.fn(),
          resolveItem: vi.fn(),
        },
      } as any;

      const coordinator = new CycleStateCoordinator(deps);
      const subtasks = [
        {
          id: "T01",
          record_id: "task-1",
          title: "Task 1",
          status: "COMPLETED",
          is_merged: false,
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
        ciIntelligence: { resolveMergeConflicts: true },
      } as any;

      coordinator.syncProtocolAttentionItems(
        subtasks,
        protocolResult,
        args,
        null,
        new Set(),
        new Set(),
        undefined,
        new Set(),
        new Set(),
        [
          {
            id: "human-conflict-1",
            projectId: "proj-1",
            sprintId: "sprint-1",
            taskId: "task-1",
            sprintRunId: "run-1",
            dispatchId: null,
            attentionType: "human_escalation_required",
            severity: "high",
            ownerType: "human",
            status: "open",
            assignedWorkerEndpointId: null,
            title: "Virtual worker escalation: Merge conflict for T01",
            summaryMarkdown: "Virtual worker escalated.",
            payload: {
              sourceAttentionType: "merge_conflict",
              escalatedBy: "virtual_worker",
              conflictingBranches: {
                source: "task/t01",
                target: "feature/sprint-1",
              },
            },
            openedAt: "2026-07-07T10:00:00.000Z",
            claimedAt: null,
            resolvedAt: null,
            updatedAt: "2026-07-07T10:00:00.000Z",
          },
        ] as any[],
      );

      expect(deps.projectAttentionService.resolveItem).toHaveBeenCalledWith(
        "human-conflict-1",
        expect.objectContaining({
          status: "dismissed",
          reason: "stale_merge_conflict_handoff_cleared",
          payloadPatch: expect.objectContaining({
            staleHandoffClearedByCycle: true,
            staleHandoffClearedAtTaskState: expect.objectContaining({
              status: "COMPLETED",
              mergeIndicator: null,
              isMerged: false,
            }),
          }),
        }),
      );
    });

    it("keeps human merge-conflict handoffs while the task still carries MERGE_CONFLICT", () => {
      const deps = {
        projectAttentionService: {
          openItems: vi.fn(),
          resolveItems: vi.fn(),
          resolveItem: vi.fn(),
        },
      } as any;

      const coordinator = new CycleStateCoordinator(deps);
      coordinator.syncProtocolAttentionItems(
        [{
          id: "T01",
          record_id: "task-1",
          status: "CODING_COMPLETED",
          is_merged: false,
          merge_indicator: "MERGE_CONFLICT",
        }] as any[],
        { awaitingMerge: [], actionRequiredTasks: [] as any[] },
        {
          executionContext: { project: { id: "proj-1" }, sprint: { id: "sprint-1" } },
          sprintRunId: "run-1",
          defaultFeatureBranch: "feature/sprint-1",
          defaultBranch: "main",
          repoPath: "/repo",
          ciIntelligence: { resolveMergeConflicts: true },
        } as any,
        null,
        new Set(),
        new Set(),
        undefined,
        new Set(),
        new Set(),
        [{
          id: "human-conflict-1",
          sprintId: "sprint-1",
          taskId: "task-1",
          attentionType: "human_escalation_required",
          ownerType: "human",
          payload: { sourceAttentionType: "merge_conflict" },
        }] as any[],
      );

      expect(deps.projectAttentionService.resolveItem).not.toHaveBeenCalled();
    });

    it("matches stale human conflict handoffs by payload task key when the subtask record id is missing", () => {
      const deps = {
        projectAttentionService: {
          openItems: vi.fn(),
          resolveItems: vi.fn(),
          resolveItem: vi.fn(),
        },
      } as any;

      const coordinator = new CycleStateCoordinator(deps);
      coordinator.syncProtocolAttentionItems(
        [{
          id: "T01",
          title: "Task 1",
          status: "CODING_COMPLETED",
          is_merged: false,
          merge_indicator: null,
        }] as any[],
        { awaitingMerge: [], actionRequiredTasks: [] as any[] },
        {
          executionContext: { project: { id: "proj-1" }, sprint: { id: "sprint-1" } },
          sprintRunId: "run-1",
          defaultFeatureBranch: "feature/sprint-1",
          defaultBranch: "main",
          repoPath: "/repo",
          ciIntelligence: { resolveMergeConflicts: true },
        } as any,
        null,
        new Set(),
        new Set(),
        undefined,
        new Set(),
        new Set(),
        [{
          id: "human-conflict-1",
          sprintId: "sprint-1",
          taskId: "db-task-1",
          attentionType: "human_escalation_required",
          ownerType: "human",
          payload: {
            sourceAttentionType: "merge_conflict",
            taskKey: "T01",
          },
        }] as any[],
      );

      expect(deps.projectAttentionService.resolveItem).toHaveBeenCalledWith(
        "human-conflict-1",
        expect.objectContaining({ reason: "stale_merge_conflict_handoff_cleared" }),
      );
    });

    it("classifies only task-level human merge-conflict escalations as stale-cleanup candidates", () => {
      expect(isTaskLevelHumanMergeConflictEscalation({
        sprintId: "sprint-1",
        taskId: "task-1",
        attentionType: "human_escalation_required",
        ownerType: "human",
        payload: { sourceAttentionType: "merge_conflict" },
      } as any, "sprint-1")).toBe(true);

      expect(isTaskLevelHumanMergeConflictEscalation({
        sprintId: "sprint-1",
        taskId: "task-1",
        attentionType: "human_escalation_required",
        ownerType: "human",
        payload: { sourceAttentionType: "merge_conflict", mergeStage: "main" },
      } as any, "sprint-1")).toBe(false);

      expect(isTaskLevelHumanMergeConflictEscalation({
        sprintId: "sprint-1",
        taskId: "task-1",
        attentionType: "human_escalation_required",
        ownerType: "human",
        payload: { sourceAttentionType: "manual_attention" },
      } as any, "sprint-1")).toBe(false);
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

    it("does not issue no-op attention resolutions when the active snapshot is empty", async () => {
      const deps = {
        projectAttentionService: {
          openItems: vi.fn(),
          resolveItems: vi.fn(),
        },
      } as any;
      const coordinator = new CycleStateCoordinator(deps);

      coordinator.syncProtocolAttentionItems(
        [{ id: "T01", record_id: "rec-1", title: "Task 1", status: "COMPLETED", merge_indicator: null }] as any,
        { awaitingMerge: [], actionRequiredTasks: [] },
        {
          executionContext: { project: { id: "proj-1" }, sprint: { id: "sprint-1" } },
          sprintRunId: "run-1",
          defaultFeatureBranch: "feature/sprint-1",
          defaultBranch: "main",
          repoPath: "/repo",
        } as any,
        null,
        new Set(),
        new Set(),
        undefined,
        new Set(),
        new Set(),
        [],
      );

      expect(deps.projectAttentionService.resolveItems).not.toHaveBeenCalled();
    });

    it("resolves stale merge attention for worker-resolved branch pairs", async () => {
      const deps = {
        projectAttentionService: {
          openItems: vi.fn(),
          resolveItems: vi.fn(),
        },
      } as any;

      const coordinator = new CycleStateCoordinator(deps);
      const task = {
        id: "T01",
        record_id: "rec-1",
        title: "Task 1",
        prompt: "Prompt 1",
        status: "CODING_COMPLETED",
        merge_indicator: "MERGE_CONFLICT",
        worker_branch: "worker/task-1",
      } as any;
      const args = {
        executionContext: { project: { id: "proj-1" }, sprint: { id: "sprint-1" } },
        sprintRunId: "run-1",
        defaultFeatureBranch: "feature/sprint-1",
        defaultBranch: "main",
        repoPath: "/repo",
        ciIntelligence: { resolveMergeConflicts: true },
      } as any;

      await coordinator.syncProtocolAttentionItems(
        [task],
        { awaitingMerge: [task], actionRequiredTasks: [] },
        args,
        null,
        new Set(),
        new Set(),
        undefined,
        new Set(),
        new Set([
          buildResolvedWorkerMergeConflictKey("rec-1", "worker/task-1", "feature/sprint-1"),
        ]),
      );

      expect(deps.projectAttentionService.openItems).not.toHaveBeenCalled();
      expect(deps.projectAttentionService.resolveItems).toHaveBeenCalledWith(expect.arrayContaining([
        expect.objectContaining({
          filter: { projectId: "proj-1", taskId: "rec-1", attentionTypes: ["merge_required", "merge_conflict"] },
          resolution: { status: "resolved", reason: "merge_attention_cleared" },
        }),
      ]));
    });
  });
});
