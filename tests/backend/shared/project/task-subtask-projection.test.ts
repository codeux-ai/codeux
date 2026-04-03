import { describe, it, expect } from "vitest";
import {
  mapPlanningStatusToRuntimeStatus,
  mapRuntimeStatusToPlanningStatus,
  toMergeIndicator,
} from "../../../../src/shared/project/task-subtask-projection.js";

describe("task-subtask-projection", () => {
  describe("mapPlanningStatusToRuntimeStatus", () => {
    it("maps coding_completed to CODING_COMPLETED", () => {
      expect(mapPlanningStatusToRuntimeStatus("coding_completed")).toBe("CODING_COMPLETED");
    });
    it("maps completed to COMPLETED", () => {
      expect(mapPlanningStatusToRuntimeStatus("completed")).toBe("COMPLETED");
    });
    it("maps in_progress to RUNNING", () => {
      expect(mapPlanningStatusToRuntimeStatus("in_progress")).toBe("RUNNING");
    });
    it("maps pending to PENDING", () => {
      expect(mapPlanningStatusToRuntimeStatus("pending")).toBe("PENDING");
    });
    it("maps unknown to PENDING", () => {
      expect(mapPlanningStatusToRuntimeStatus("unknown" as any)).toBe("PENDING");
    });
  });

  describe("mapRuntimeStatusToPlanningStatus", () => {
    it("maps CODING_COMPLETED to coding_completed", () => {
      expect(mapRuntimeStatusToPlanningStatus("CODING_COMPLETED")).toBe("coding_completed");
    });
    it("maps COMPLETED to completed", () => {
      expect(mapRuntimeStatusToPlanningStatus("COMPLETED")).toBe("completed");
    });
    it("maps RUNNING to in_progress", () => {
      expect(mapRuntimeStatusToPlanningStatus("RUNNING")).toBe("in_progress");
    });
    it("maps PENDING to pending", () => {
      expect(mapRuntimeStatusToPlanningStatus("PENDING")).toBe("pending");
    });
    it("maps unknown to null", () => {
      expect(mapRuntimeStatusToPlanningStatus("UNKNOWN" as any)).toBeNull();
    });
  });

  describe("toMergeIndicator", () => {
    it("returns valid indicators", () => {
      expect(toMergeIndicator("CI")).toBe("CI");
      expect(toMergeIndicator("AUTOMERGE")).toBe("AUTOMERGE");
      expect(toMergeIndicator("MERGED")).toBe("MERGED");
      expect(toMergeIndicator("MERGE_BLOCKED")).toBe("MERGE_BLOCKED");
      expect(toMergeIndicator("MERGE_CONFLICT")).toBe("MERGE_CONFLICT");
    });
    it("returns undefined for invalid or nullish indicators", () => {
      expect(toMergeIndicator("INVALID")).toBeUndefined();
      expect(toMergeIndicator(null)).toBeUndefined();
      expect(toMergeIndicator(undefined)).toBeUndefined();
    });
  });
});
