import { describe, it, expect } from "vitest";
import {
  buildHumanInterventionSummaryBySprintRun,
  buildHumanInterventionSummaryFromAttentionRows,
  buildHumanInterventionSummaryFromEvents,
  compareAttentionPriority
} from "../../../src/repositories/execution/human-intervention-summary.js";
import type {
  ExecutionRuntimeEventSummaryRow,
  ExecutionSprintRunSummaryRow,
  ExecutionTaskDispatchSummaryRow
} from "../../../src/repositories/execution/execution-row-mappers.js";
import type { ProjectAttentionSummaryRow } from "../../../src/repositories/execution-repository.js";

// Testing internal module helpers mapped out of snapshot execution
describe("project-execution-snapshot-query helpers", () => {
  describe("human-intervention-summary", () => {
    describe("compareAttentionPriority", () => {
      it("prioritizes escalation over merge conflict, and high severity over low", () => {
        const p1 = { attention_type: "merge_conflict", severity: "high", updated_at: "1", id: "1" } as ProjectAttentionSummaryRow;
        const p2 = { attention_type: "human_escalation_required", severity: "medium", updated_at: "1", id: "2" } as ProjectAttentionSummaryRow;
        const p3 = { attention_type: "merge_conflict", severity: "critical", updated_at: "1", id: "3" } as ProjectAttentionSummaryRow;

        const sorted = [p1, p2, p3].sort(compareAttentionPriority);
        expect(sorted[0].id).toBe("2"); // escalation first
        expect(sorted[1].id).toBe("3"); // then critical merge conflict
        expect(sorted[2].id).toBe("1"); // then high merge conflict
      });
    });

    describe("buildHumanInterventionSummaryFromAttentionRows", () => {
      it("extracts correct summary from attention row", () => {
        const row = {
          id: "1",
          attention_type: "merge_required",
          severity: "high",
          owner_type: "human",
          status: "open",
          title: "Merge PR",
          summary_markdown: "Need merge",
          payload_json: JSON.stringify({ prUrl: "http://github.com" }),
          updated_at: "2024-01-01",
        } as ProjectAttentionSummaryRow;

        const result = buildHumanInterventionSummaryFromAttentionRows([row]);
        expect(result).not.toBeNull();
        expect(result?.title).toBe("Merge PR");
        expect(result?.instructions).toContain("http://github.com");
      });
    });

    describe("buildHumanInterventionSummaryFromEvents", () => {
      it("extracts relevant blocked events when no attention items exist", () => {
        const events = [
          { event_type: "planning_preflight_blocked", payload_json: JSON.stringify({ planningTarget: "test sprint" }) } as ExecutionRuntimeEventSummaryRow
        ];

        const result = buildHumanInterventionSummaryFromEvents("paused", events);
        expect(result).not.toBeNull();
        expect(result?.title).toBe("Sprint planning required");
        expect(result?.reason).toContain("test sprint");
      });

      it("ignores events if sprint is not paused for certain types", () => {
        const events = [
          { event_type: "sprint_paused", payload_json: "{}" } as ExecutionRuntimeEventSummaryRow
        ];

        const result = buildHumanInterventionSummaryFromEvents("running", events);
        expect(result).toBeNull();
      });
    });

    describe("buildHumanInterventionSummaryBySprintRun", () => {
      it("maps intervention to correct paused sprint run via attention rows or events", () => {
        const sprintRuns = [
          { id: "sr-1", sprint_id: "s-1", status: "paused" } as ExecutionSprintRunSummaryRow,
          { id: "sr-2", sprint_id: "s-2", status: "running" } as ExecutionSprintRunSummaryRow,
          { id: "sr-3", sprint_id: "s-3", status: "paused" } as ExecutionSprintRunSummaryRow,
        ];

        const attentionRows = [
          {
            id: "att-1",
            sprint_run_id: "sr-1",
            attention_type: "merge_required",
            severity: "high",
            owner_type: "human",
            status: "open",
            title: "Merge SR1",
            summary_markdown: "Merge SR1",
            payload_json: JSON.stringify({ sprintRunId: "sr-1" }),
            updated_at: "1",
          } as ProjectAttentionSummaryRow
        ];

        const recentEvents = [
          {
            id: "evt-1",
            sprint_run_id: "sr-3",
            event_type: "branch_preflight_blocked",
            payload_json: JSON.stringify({}),
            created_at: "1"
          } as ExecutionRuntimeEventSummaryRow
        ];

        const map = buildHumanInterventionSummaryBySprintRun(sprintRuns, attentionRows, recentEvents);

        expect(map.has("sr-1")).toBe(true);
        expect(map.get("sr-1")?.title).toBe("Merge SR1");

        expect(map.has("sr-2")).toBe(false); // running sprint

        expect(map.has("sr-3")).toBe(true);
        expect(map.get("sr-3")?.title).toBe("Branch preparation blocked");
      });
    });
  });
});
