import { describe, expect, it } from "vitest";
import {
  isOrchestratorHandledClarificationItem,
  resolveWorkerExecutionMode,
  projectNeedsVirtualWorker,
  peekNextWorkerAttention
} from "../../../../src/domain/workers/virtual-worker-scheduling-policy.js";
import type { DashboardSettings } from "../../../../src/contracts/app-types.js";
import type { ProjectAttentionItemRecord } from "../../../../src/contracts/project-attention-types.js";

describe("Virtual Worker Scheduling Policy", () => {
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

    it("handles merge_conflict based on settings", () => {
      const item = { ownerType: "worker", status: "open", summaryMarkdown: "", attentionType: "merge_conflict" } as ProjectAttentionItemRecord;
      expect(peekNextWorkerAttention([item], () => mockSettings({ ciIntelligence: { resolveMergeConflicts: false } }))).toBeNull();
      expect(peekNextWorkerAttention([item], () => mockSettings({ ciIntelligence: { resolveMergeConflicts: true } }))).toBe(item);
    });

    it("handles ci_fix_required based on settings", () => {
      const item = { ownerType: "worker", status: "open", summaryMarkdown: "", attentionType: "ci_fix_required" } as ProjectAttentionItemRecord;
      expect(peekNextWorkerAttention([item], () => mockSettings({ ciIntelligence: { waitForJulesCiAutofix: false } }))).toBeNull();
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
  });
});
