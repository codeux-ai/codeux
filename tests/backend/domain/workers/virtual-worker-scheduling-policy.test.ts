import { describe, expect, it, vi } from "vitest";
import {
  decideVirtualWorkerProjectScheduling,
  hasPendingManagerClarificationForScope,
  isProjectManagerOwnedClarificationItem,
  isOrchestratorHandledClarificationItem,
  planVirtualWorkerAttentionClaim,
  resolveWorkerExecutionMode,
  projectNeedsVirtualWorker,
  peekNextWorkerAttention,
  computeReconciliationCandidates,
  resolveVirtualWorkerAttentionRoute
} from "../../../../src/domain/workers/virtual-worker-scheduling-policy.js";
import type { DashboardSettings } from "../../../../src/contracts/app-types.js";
import type { ProjectAttentionItemRecord } from "../../../../src/contracts/project-attention-types.js";

describe("Virtual Worker Scheduling Policy", () => {
  describe("table-driven scheduling decisions", () => {
    const actionableAttention = {
      ownerType: "worker",
      status: "open",
      summaryMarkdown: "Needs worker action.",
      attentionType: "worker_dispatch_blocked",
    } as ProjectAttentionItemRecord;

    const cases = [
      {
        name: "idle virtual worker project with attention is selected",
        state: {
          executionMode: "VIRTUAL",
          hasActiveCycle: false,
          isAlreadyScheduled: false,
          nextAttentionItem: actionableAttention,
          hasPendingDispatch: false,
        },
        expected: { shouldSchedule: true, reason: "virtual_worker_work_available" },
      },
      {
        name: "idle virtual worker project with a pending dispatch is selected",
        state: {
          executionMode: "VIRTUAL",
          hasActiveCycle: false,
          isAlreadyScheduled: false,
          nextAttentionItem: null,
          hasPendingDispatch: true,
        },
        expected: { shouldSchedule: true, reason: "virtual_worker_work_available" },
      },
      {
        name: "busy project with an active cycle is skipped",
        state: {
          executionMode: "VIRTUAL",
          hasActiveCycle: true,
          isAlreadyScheduled: false,
          nextAttentionItem: actionableAttention,
          hasPendingDispatch: true,
        },
        expected: { shouldSchedule: false, reason: "active_cycle" },
      },
      {
        name: "busy project already queued is skipped",
        state: {
          executionMode: "VIRTUAL",
          hasActiveCycle: false,
          isAlreadyScheduled: true,
          nextAttentionItem: actionableAttention,
          hasPendingDispatch: true,
        },
        expected: { shouldSchedule: false, reason: "already_scheduled" },
      },
      {
        name: "disabled virtual scheduling for connected-worker mode is skipped",
        state: {
          executionMode: "CONNECTED",
          hasActiveCycle: false,
          isAlreadyScheduled: false,
          nextAttentionItem: actionableAttention,
          hasPendingDispatch: true,
        },
        expected: { shouldSchedule: false, reason: "workers_not_virtual" },
      },
      {
        name: "idle project with no actionable work is skipped",
        state: {
          executionMode: "VIRTUAL",
          hasActiveCycle: false,
          isAlreadyScheduled: false,
          nextAttentionItem: null,
          hasPendingDispatch: false,
        },
        expected: { shouldSchedule: false, reason: "no_actionable_work" },
      },
    ] satisfies Array<{
      name: string;
      state: Parameters<typeof decideVirtualWorkerProjectScheduling>[0];
      expected: ReturnType<typeof decideVirtualWorkerProjectScheduling>;
    }>;

    it.each(cases)("$name", ({ state, expected }) => {
      expect(decideVirtualWorkerProjectScheduling(state)).toEqual(expected);
    });

  });

  describe("isProjectManagerOwnedClarificationItem", () => {
    it("recognizes both the canonical attention type and payload discriminator", () => {
      expect(isProjectManagerOwnedClarificationItem({
        attentionType: "worker_clarification",
        payload: null,
      })).toBe(true);
      expect(isProjectManagerOwnedClarificationItem({
        attentionType: "action_required",
        payload: { type: "worker_clarification" },
      })).toBe(true);
    });
  });

  describe("hasPendingManagerClarificationForScope", () => {
    const clarification = (overrides: Partial<ProjectAttentionItemRecord> = {}) => ({
      attentionType: "worker_clarification",
      payload: { type: "worker_clarification", status: "pending" },
      taskId: "task-1",
      dispatchId: "dispatch-1",
      ...overrides,
    } as ProjectAttentionItemRecord);

    it("matches the same task or dispatch only", () => {
      const items = [clarification()];

      expect(hasPendingManagerClarificationForScope(
        { taskId: "task-1", dispatchId: "dispatch-2" },
        items,
      )).toBe(true);
      expect(hasPendingManagerClarificationForScope(
        { taskId: "task-2", dispatchId: "dispatch-1" },
        items,
      )).toBe(true);
      expect(hasPendingManagerClarificationForScope(
        { taskId: "task-2", dispatchId: "dispatch-2" },
        items,
      )).toBe(false);
    });

    it("does not let a taskless general clarification block coding scope", () => {
      expect(hasPendingManagerClarificationForScope(
        { taskId: "task-1", dispatchId: "dispatch-1" },
        [clarification({ taskId: null, dispatchId: null })],
      )).toBe(false);
    });
  });

  describe("isOrchestratorHandledClarificationItem", () => {
    it("returns true for cooldown active", () => {
      expect(isOrchestratorHandledClarificationItem("Clarification cooldown active...")).toBe(true);
    });
    it("returns true for auto-answered", () => {
      expect(isOrchestratorHandledClarificationItem("...already answered automatically...")).toBe(true);
    });
    it("returns true for resume instruction", () => {
      expect(isOrchestratorHandledClarificationItem("Resume instruction already sent here")).toBe(true);
    });
    it("returns false for normal summary", () => {
      expect(isOrchestratorHandledClarificationItem("Just a normal summary")).toBe(false);
    });
  });

  describe("resolveWorkerExecutionMode", () => {
    it("returns execution mode from settings", () => {
      expect(resolveWorkerExecutionMode({ workers: { executionMode: "VIRTUAL" } } as DashboardSettings)).toBe("VIRTUAL");
      expect(resolveWorkerExecutionMode({ workers: { executionMode: "CONNECTED" } } as DashboardSettings)).toBe("CONNECTED");
    });
  });

  describe("projectNeedsVirtualWorker", () => {
    it("returns false if there is an active cycle", () => {
      expect(projectNeedsVirtualWorker(true, {} as any)).toBe(false);
    });
    it("returns false if nextItem is null", () => {
      expect(projectNeedsVirtualWorker(false, null)).toBe(false);
    });
    it("returns true if no active cycle and nextItem is present", () => {
      expect(projectNeedsVirtualWorker(false, {} as any)).toBe(true);
    });
  });

  describe("peekNextWorkerAttention", () => {
    const mockSettings = (overrides: any) => ({
      ciIntelligence: { resolveMergeConflicts: false, waitForJulesCiAutofix: false, ...overrides?.ciIntelligence },
      automationInterventions: { autoAnswerClarification: false, autoApprovePlan: false, ...overrides?.automationInterventions }
    } as DashboardSettings);

    it("ignores non-worker owner types", () => {
      const item = { ownerType: "human", status: "open", summaryMarkdown: "" } as ProjectAttentionItemRecord;
      expect(peekNextWorkerAttention([item], () => mockSettings({}))).toBeNull();
    });

    it("ignores items that are not open or properly claimed", () => {
      const item1 = { ownerType: "worker", status: "resolved", summaryMarkdown: "" } as ProjectAttentionItemRecord;
      const item2 = { ownerType: "worker", status: "claimed", assignedWorkerEndpointId: "e1", summaryMarkdown: "" } as ProjectAttentionItemRecord;
      expect(peekNextWorkerAttention([item1, item2], () => mockSettings({}))).toBeNull();
    });

    it("ignores orchestrator handled clarification items", () => {
      const item = { ownerType: "worker", status: "open", summaryMarkdown: "Clarification cooldown active" } as ProjectAttentionItemRecord;
      expect(peekNextWorkerAttention([item], () => mockSettings({}))).toBeNull();
    });

    it("ignores manager-owned clarification payloads even if legacy data marks them worker-owned", () => {
      const resolver = vi.fn().mockReturnValue(mockSettings({
        automationInterventions: { autoAnswerClarification: true },
      }));
      const item = {
        ownerType: "worker",
        status: "open",
        summaryMarkdown: "Should the worker preserve compatibility?",
        attentionType: "action_required",
        payload: { type: "worker_clarification", status: "pending" },
      } as ProjectAttentionItemRecord;

      expect(peekNextWorkerAttention([item], resolver)).toBeNull();
      expect(resolver).not.toHaveBeenCalled();
    });

    it("ignores worker action items for a task that already has a pending manager clarification", () => {
      const resolver = vi.fn().mockReturnValue(mockSettings({
        automationInterventions: { autoAnswerClarification: true },
      }));
      const workerItem = {
        id: "worker-item",
        projectId: "project-1",
        taskId: "task-1",
        ownerType: "worker",
        status: "open",
        summaryMarkdown: "The worker is blocked.",
        attentionType: "action_required",
        payload: { sessionState: "AWAITING_USER_FEEDBACK" },
      } as ProjectAttentionItemRecord;
      const clarification = {
        id: "clarification-1",
        projectId: "project-1",
        taskId: "task-1",
        ownerType: "human",
        status: "open",
        summaryMarkdown: "Which behavior should be used?",
        attentionType: "worker_clarification",
        payload: { type: "worker_clarification", status: "pending" },
      } as ProjectAttentionItemRecord;

      expect(peekNextWorkerAttention([workerItem, clarification], resolver)).toBeNull();
      expect(resolver).not.toHaveBeenCalled();
    });

    it("keeps unrelated worker attention eligible while a clarification is pending", () => {
      const resolver = vi.fn().mockReturnValue(mockSettings({
        automationInterventions: { autoAnswerClarification: true },
      }));
      const workerItem = {
        projectId: "project-1",
        taskId: "task-2",
        dispatchId: "dispatch-2",
        ownerType: "worker",
        status: "open",
        summaryMarkdown: "The unrelated worker needs action.",
        attentionType: "action_required",
      } as ProjectAttentionItemRecord;
      const clarification = {
        projectId: "project-1",
        taskId: "task-1",
        dispatchId: "dispatch-1",
        ownerType: "human",
        status: "open",
        summaryMarkdown: "Manager input required.",
        attentionType: "worker_clarification",
        payload: { type: "worker_clarification", status: "pending" },
      } as ProjectAttentionItemRecord;

      expect(peekNextWorkerAttention([workerItem, clarification], resolver)).toBe(workerItem);
    });

    it.each([
      {
        name: "retry deferral for clarification cooldown",
        item: {
          ownerType: "worker",
          status: "open",
          summaryMarkdown: "Clarification cooldown active for this task.",
          attentionType: "action_required",
        } as ProjectAttentionItemRecord,
      },
      {
        name: "retry deferral for already answered clarification",
        item: {
          ownerType: "worker",
          status: "open",
          summaryMarkdown: "The clarification was already answered automatically.",
          attentionType: "action_required",
        } as ProjectAttentionItemRecord,
      },
    ])("defers $name", ({ item }) => {
      const resolver = vi.fn().mockReturnValue(mockSettings({
        automationInterventions: { autoAnswerClarification: true },
      }));

      expect(peekNextWorkerAttention([item], resolver)).toBeNull();
      expect(resolver).not.toHaveBeenCalled();
    });

    it("handles merge_conflict based on settings", () => {
      const item = { ownerType: "worker", status: "open", summaryMarkdown: "", attentionType: "merge_conflict" } as ProjectAttentionItemRecord;
      expect(peekNextWorkerAttention([item], () => mockSettings({ ciIntelligence: { resolveMergeConflicts: false } }))).toBeNull();
      expect(peekNextWorkerAttention([item], () => mockSettings({ ciIntelligence: { resolveMergeConflicts: true } }))).toBe(item);
    });

    it("handles ci_fix_required independently from the Jules notification setting", () => {
      const item = { ownerType: "worker", status: "open", summaryMarkdown: "", attentionType: "ci_fix_required" } as ProjectAttentionItemRecord;
      expect(peekNextWorkerAttention([item], () => mockSettings({ ciIntelligence: { waitForJulesCiAutofix: false } }))).toBe(item);
      expect(peekNextWorkerAttention([item], () => mockSettings({ ciIntelligence: { waitForJulesCiAutofix: true } }))).toBe(item);
    });

    it("handles action_required based on settings", () => {
      const item = { ownerType: "worker", status: "open", summaryMarkdown: "", attentionType: "action_required" } as ProjectAttentionItemRecord;
      expect(peekNextWorkerAttention([item], () => mockSettings({ automationInterventions: { autoAnswerClarification: false, autoApprovePlan: false } }))).toBeNull();
      expect(peekNextWorkerAttention([item], () => mockSettings({ automationInterventions: { autoAnswerClarification: true, autoApprovePlan: false } }))).toBe(item);
    });

    it("returns default worker item", () => {
      const item = { ownerType: "worker", status: "open", summaryMarkdown: "", attentionType: "custom" } as ProjectAttentionItemRecord;
      expect(peekNextWorkerAttention([item], () => mockSettings({}))).toBe(item);
    });

    it("calls the resolver only for eligible worker-owned attention items", () => {
      const resolver = vi.fn().mockReturnValue(mockSettings({}));
      const humanItem = { ownerType: "human", status: "open", summaryMarkdown: "", attentionType: "custom" } as ProjectAttentionItemRecord;
      const claimedItem = { ownerType: "worker", status: "claimed", assignedWorkerEndpointId: "e1", summaryMarkdown: "" } as ProjectAttentionItemRecord;
      const openWorkerItem = { ownerType: "worker", status: "open", summaryMarkdown: "", attentionType: "custom" } as ProjectAttentionItemRecord;

      const result = peekNextWorkerAttention([humanItem, claimedItem, openWorkerItem], resolver);

      expect(result).toBe(openWorkerItem);
      expect(resolver).toHaveBeenCalledTimes(1); // Should only be called once, for openWorkerItem
    });
  });

  describe("computeReconciliationCandidates", () => {
    it("returns an empty array when all inputs are empty", () => {
      expect(computeReconciliationCandidates([], [], [])).toEqual([]);
    });

    it("deduplicates project IDs across lists", () => {
      const activeAttention = ["proj-1", "proj-2"];
      const pendingDispatch = ["proj-2", "proj-3"];
      const activeCycles = ["proj-3", "proj-4", "proj-1"];

      const result = computeReconciliationCandidates(activeAttention, pendingDispatch, activeCycles);

      expect(result).toHaveLength(4);
      expect(result).toContain("proj-1");
      expect(result).toContain("proj-2");
      expect(result).toContain("proj-3");
      expect(result).toContain("proj-4");
    });

    it("handles non-overlapping lists", () => {
      expect(computeReconciliationCandidates(["p1"], ["p2"], ["p3"])).toEqual(["p1", "p2", "p3"]);
    });
  });

  describe("attention route and claim policy", () => {
    it.each([
      {
        name: "attention escalation for unsupported worker attention",
        item: { attentionType: "worker_dispatch_blocked", summaryMarkdown: "Blocked." } as ProjectAttentionItemRecord,
        expected: "escalate_to_human",
      },
      {
        name: "merge conflict repair",
        item: { attentionType: "merge_conflict", summaryMarkdown: "Conflict." } as ProjectAttentionItemRecord,
        expected: "merge_conflict",
      },
      {
        name: "ci retry repair",
        item: { attentionType: "ci_fix_required", summaryMarkdown: "CI failed." } as ProjectAttentionItemRecord,
        expected: "ci_fix",
      },
      {
        name: "retry deferral for orchestrator-handled clarification",
        item: { attentionType: "action_required", summaryMarkdown: "Resume instruction already sent." } as ProjectAttentionItemRecord,
        expected: "skip_orchestrator_handled",
      },
      {
        name: "project-manager-owned worker clarification",
        item: {
          attentionType: "action_required",
          summaryMarkdown: "Manager input required.",
          payload: { type: "worker_clarification", status: "pending" },
        } as ProjectAttentionItemRecord,
        expected: "skip_orchestrator_handled",
      },
    ])("$name routes to $expected", ({ item, expected }) => {
      expect(resolveVirtualWorkerAttentionRoute(item)).toBe(expected);
    });

    it.each([
      {
        name: "open attention uses a claimed reason",
        item: { status: "open" } as ProjectAttentionItemRecord,
        expected: "virtual_worker_claimed:reconcile",
      },
      {
        name: "unassigned claimed attention uses a reclaimed reason",
        item: { status: "claimed" } as ProjectAttentionItemRecord,
        expected: "virtual_worker_reclaimed:reconcile",
      },
    ])("$name", ({ item, expected }) => {
      expect(planVirtualWorkerAttentionClaim(item, "reconcile").claimReason).toBe(expected);
    });
  });
});
