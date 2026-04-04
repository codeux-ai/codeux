import { describe, expect, it } from "vitest";
import {
  mapPlanningStatusToRuntimeStatus,
  mapRuntimeStatusToPlanningStatus,
  normalizeImportedTaskStatus,
  resolveSubtaskStatus,
  toMergeIndicator,
} from "../../../src/services/subtask-state-mapper.js";

describe("subtask-state-mapper", () => {
  describe("mapPlanningStatusToRuntimeStatus", () => {
    it("should map planning statuses to runtime states correctly", () => {
      expect(mapPlanningStatusToRuntimeStatus("coding_completed")).toBe("CODING_COMPLETED");
      expect(mapPlanningStatusToRuntimeStatus("completed")).toBe("COMPLETED");
      expect(mapPlanningStatusToRuntimeStatus("in_progress")).toBe("RUNNING");
      expect(mapPlanningStatusToRuntimeStatus("pending")).toBe("PENDING");
      // @ts-expect-error testing invalid fallback
      expect(mapPlanningStatusToRuntimeStatus("unknown")).toBe("PENDING");
    });
  });

  describe("mapRuntimeStatusToPlanningStatus", () => {
    it("should map runtime states to planning statuses correctly", () => {
      expect(mapRuntimeStatusToPlanningStatus("CODING_COMPLETED")).toBe("coding_completed");
      expect(mapRuntimeStatusToPlanningStatus("RUNNING")).toBe("in_progress");
      expect(mapRuntimeStatusToPlanningStatus("COMPLETED")).toBe("completed");
      expect(mapRuntimeStatusToPlanningStatus("PENDING")).toBe("pending");
      // @ts-expect-error testing invalid fallback
      expect(mapRuntimeStatusToPlanningStatus("UNKNOWN")).toBeNull();
    });
  });

  describe("normalizeImportedTaskStatus", () => {
    it("should normalize string statuses correctly", () => {
      expect(normalizeImportedTaskStatus("CODING_COMPLETED")).toBe("coding_completed");
      expect(normalizeImportedTaskStatus("COMPLETED")).toBe("completed");
      expect(normalizeImportedTaskStatus("RUNNING")).toBe("in_progress");
      expect(normalizeImportedTaskStatus("PENDING")).toBe("pending");
      expect(normalizeImportedTaskStatus(undefined)).toBe("pending");
      expect(normalizeImportedTaskStatus("UNKNOWN")).toBe("pending");
    });
  });

  describe("resolveSubtaskStatus", () => {
    it("should resolve subtask status based on latest run state if active", () => {
      expect(resolveSubtaskStatus("pending", "RUNNING")).toBe("RUNNING");
      expect(resolveSubtaskStatus("coding_completed", "FAILED")).toBe("FAILED");
      expect(resolveSubtaskStatus("completed", "BLOCKED")).toBe("BLOCKED");
    });

    it("should fall back to mapping planning status if latest run state is missing or COMPLETED", () => {
      expect(resolveSubtaskStatus("pending")).toBe("PENDING");
      expect(resolveSubtaskStatus("in_progress")).toBe("RUNNING");
      expect(resolveSubtaskStatus("coding_completed")).toBe("CODING_COMPLETED");
      expect(resolveSubtaskStatus("completed", "COMPLETED")).toBe("COMPLETED");
      expect(resolveSubtaskStatus("pending", "COMPLETED")).toBe("PENDING");
    });
  });

  describe("toMergeIndicator", () => {
    it("should normalize merge indicators correctly", () => {
      expect(toMergeIndicator("CI")).toBe("CI");
      expect(toMergeIndicator("AUTOMERGE")).toBe("AUTOMERGE");
      expect(toMergeIndicator("MERGED")).toBe("MERGED");
      expect(toMergeIndicator("MERGE_BLOCKED")).toBe("MERGE_BLOCKED");
      expect(toMergeIndicator("MERGE_CONFLICT")).toBe("MERGE_CONFLICT");
    });

    it("should return undefined for invalid indicators", () => {
      expect(toMergeIndicator("INVALID")).toBeUndefined();
      expect(toMergeIndicator(null)).toBeUndefined();
      expect(toMergeIndicator(undefined)).toBeUndefined();
    });
  });
});
