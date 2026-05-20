import { describe, expect, it } from "vitest";
import { buildHumanInterventionSummaryBySprintRun } from "../../../../src/repositories/execution/execution-human-intervention-query.js";
import { ProjectAttentionSummaryRow, ExecutionRuntimeEventSummaryRow } from "../../../../src/repositories/execution/execution-repository-types.js";

describe("execution-human-intervention-query", () => {
  describe("buildHumanInterventionSummaryBySprintRun", () => {
    it("returns null for a sprint run with status completed", () => {
      const sprintRuns = [{ id: "sr-1", sprint_id: "s-1", status: "completed" }];
      const attentionRows: ProjectAttentionSummaryRow[] = [{
        id: "a-1",
        project_id: "p-1",
        sprint_id: "s-1",
        sprint_run_id: "sr-1",
        attention_type: "merge_required",
        severity: "high",
        owner_type: "human",
        status: "open",
        title: "Test",
        summary_markdown: "Test",
        payload_json: "{}",
        updated_at: new Date().toISOString()
      }];

      const result = buildHumanInterventionSummaryBySprintRun(sprintRuns, attentionRows, []);
      expect(result.get("sr-1")).toBeUndefined();
    });

    it("returns null for an attention item with ownerType === 'worker' and status === 'claimed'", () => {
      const sprintRuns = [{ id: "sr-1", sprint_id: "s-1", status: "running" }];
      const attentionRows: ProjectAttentionSummaryRow[] = [{
        id: "a-1",
        project_id: "p-1",
        sprint_id: "s-1",
        sprint_run_id: "sr-1",
        attention_type: "merge_required",
        severity: "high",
        owner_type: "worker",
        status: "claimed",
        title: "Test",
        summary_markdown: "Test",
        payload_json: "{}",
        updated_at: new Date().toISOString()
      }];

      const result = buildHumanInterventionSummaryBySprintRun(sprintRuns, attentionRows, []);
      expect(result.get("sr-1")).toBeUndefined();
    });

    it("returns the summary for a genuinely open human-required attention item", () => {
      const sprintRuns = [{ id: "sr-1", sprint_id: "s-1", status: "running" }];
      const attentionRows: ProjectAttentionSummaryRow[] = [{
        id: "a-1",
        project_id: "p-1",
        sprint_id: "s-1",
        sprint_run_id: "sr-1",
        attention_type: "merge_required",
        severity: "high",
        owner_type: "human",
        status: "open",
        title: "Merge Required",
        summary_markdown: "Merge this",
        payload_json: "{}",
        updated_at: new Date().toISOString()
      }];

      const result = buildHumanInterventionSummaryBySprintRun(sprintRuns, attentionRows, []);
      const summary = result.get("sr-1");
      expect(summary).toBeDefined();
      expect(summary?.title).toBe("Merge Required");
      expect(summary?.attentionType).toBe("merge_required");
    });

    it("returns null for sprint_paused event if sprintRunStatus is not paused", () => {
      const sprintRuns = [{ id: "sr-1", sprint_id: "s-1", status: "running" }];
      const events: ExecutionRuntimeEventSummaryRow[] = [{
        id: "e-1",
        project_id: "p-1",
        sprint_id: "s-1",
        sprint_run_id: "sr-1",
        task_id: null,
        task_dispatch_id: null,
        event_type: "sprint_paused",
        event_message: "Paused",
        payload_json: "{}",
        task_title: null,
        created_at: new Date().toISOString()
      }];

      const result = buildHumanInterventionSummaryBySprintRun(sprintRuns, [], events);
      expect(result.get("sr-1")).toBeUndefined();
    });

    it("returns summary for sprint_paused event if sprintRunStatus is paused", () => {
      const sprintRuns = [{ id: "sr-1", sprint_id: "s-1", status: "paused" }];
      const events: ExecutionRuntimeEventSummaryRow[] = [{
        id: "e-1",
        project_id: "p-1",
        sprint_id: "s-1",
        sprint_run_id: "sr-1",
        task_id: null,
        task_dispatch_id: null,
        event_type: "sprint_paused",
        event_message: "Paused",
        payload_json: "{}",
        task_title: null,
        created_at: new Date().toISOString()
      }];

      const result = buildHumanInterventionSummaryBySprintRun(sprintRuns, [], events);
      const summary = result.get("sr-1");
      expect(summary).toBeDefined();
      expect(summary?.title).toBe("Sprint paused");
    });

    describe("error fallback handling", () => {
      it("handles string error payloads", () => {
        const sprintRuns = [{ id: "sr-1", sprint_id: "s-1", status: "error" }];
        const events: ExecutionRuntimeEventSummaryRow[] = [{
          id: "e-1",
          project_id: "p-1",
          sprint_id: "s-1",
          sprint_run_id: "sr-1",
          task_id: null,
          task_dispatch_id: null,
          event_type: "sprint_run_error",
          event_message: "Error",
          payload_json: JSON.stringify({ error: "A string error occurred" }),
          task_title: null,
          created_at: new Date().toISOString()
        }];

        const result = buildHumanInterventionSummaryBySprintRun(sprintRuns, [], events);
        const summary = result.get("sr-1");
        expect(summary?.reason).toBe("A string error occurred");
      });

      it("handles standard error objects with a message property", () => {
        const sprintRuns = [{ id: "sr-1", sprint_id: "s-1", status: "error" }];
        const events: ExecutionRuntimeEventSummaryRow[] = [{
          id: "e-1",
          project_id: "p-1",
          sprint_id: "s-1",
          sprint_run_id: "sr-1",
          task_id: null,
          task_dispatch_id: null,
          event_type: "sprint_run_error",
          event_message: "Error",
          payload_json: JSON.stringify({ error: { message: "An object error occurred" } }),
          task_title: null,
          created_at: new Date().toISOString()
        }];

        const result = buildHumanInterventionSummaryBySprintRun(sprintRuns, [], events);
        const summary = result.get("sr-1");
        expect(summary?.reason).toBe("An object error occurred");
      });

      it("handles malformed error payloads (e.g. null) gracefully with a fallback", () => {
        const sprintRuns = [{ id: "sr-1", sprint_id: "s-1", status: "error" }];
        const events: ExecutionRuntimeEventSummaryRow[] = [{
          id: "e-1",
          project_id: "p-1",
          sprint_id: "s-1",
          sprint_run_id: "sr-1",
          task_id: null,
          task_dispatch_id: null,
          event_type: "sprint_run_error",
          event_message: "Error",
          payload_json: JSON.stringify({ error: null }),
          task_title: null,
          created_at: new Date().toISOString()
        }];

        const result = buildHumanInterventionSummaryBySprintRun(sprintRuns, [], events);
        const summary = result.get("sr-1");
        expect(summary?.reason).toBe("An unknown execution error occurred");
      });

      it("handles malformed error payloads (e.g. empty object) gracefully with a fallback", () => {
        const sprintRuns = [{ id: "sr-1", sprint_id: "s-1", status: "error" }];
        const events: ExecutionRuntimeEventSummaryRow[] = [{
          id: "e-1",
          project_id: "p-1",
          sprint_id: "s-1",
          sprint_run_id: "sr-1",
          task_id: null,
          task_dispatch_id: null,
          event_type: "sprint_run_error",
          event_message: "Error",
          payload_json: JSON.stringify({ error: {} }),
          task_title: null,
          created_at: new Date().toISOString()
        }];

        const result = buildHumanInterventionSummaryBySprintRun(sprintRuns, [], events);
        const summary = result.get("sr-1");
        expect(summary?.reason).toBe("An unknown execution error occurred");
      });
    });
  });
});
