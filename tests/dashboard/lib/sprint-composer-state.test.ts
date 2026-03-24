import { describe, expect, it } from "vitest";
import { getAvailableModes, toPlanningOverrides, resolveSubmitOriginalPrompt } from "../../../dashboard/src/v2/lib/sprint-composer-state.js";

describe("Sprint Composer State Helpers", () => {
  describe("getAvailableModes", () => {
    it("returns creation modes for new sprints", () => {
      const modes = getAvailableModes(false, false);
      expect(modes.map(m => m.id)).toEqual(["plan_and_start", "plan_only", "draft"]);
      expect(modes[0].label).toBe("Plan & Start");
      expect(modes[2].label).toBe("Save Draft");
    });

    it("returns planning actions for draft edit mode", () => {
      // Draft edit = isEditing(true), hasTasks(false)
      const modes = getAvailableModes(true, false);
      expect(modes.map(m => m.id)).toEqual(["plan_and_start", "plan_only", "draft"]);
      expect(modes[2].label).toBe("Save Changes");
      expect(modes[0].label).toBe("Plan & Start");
    });

    it("returns replan and append_tasks actions for planned sprints", () => {
      // Planned edit = isEditing(true), hasTasks(true)
      const modes = getAvailableModes(true, true);
      expect(modes.map(m => m.id)).toEqual(["replan", "append_tasks", "draft"]);
      expect(modes[0].id).toBe("replan");
      expect(modes[1].id).toBe("append_tasks");
      expect(modes[1].label).toBe("Add Tasks");
      expect(modes[2].label).toBe("Save Changes");
    });
  });

  describe("toPlanningOverrides", () => {
    it("returns undefined if no overrides", () => {
      expect(toPlanningOverrides(null, null, null)).toBeUndefined();
    });

    it("returns workerId for connected route", () => {
      expect(toPlanningOverrides({ type: "connected", id: "worker-1", label: "Worker 1" }, null, null))
        .toEqual({ workerId: "worker-1" });
    });

    it("returns virtualProvider and virtualModel for virtual route", () => {
      expect(toPlanningOverrides({ type: "virtual", id: "gemini", label: "Gemini", provider: "gemini" }, "pro", null))
        .toEqual({ virtualProvider: "gemini", virtualModel: "pro" });
    });

    it("returns virtualModel if only model override provided", () => {
      expect(toPlanningOverrides(null, "pro", null)).toEqual({ virtualModel: "pro" });
    });

    it("returns planningAgentPresetId if provided", () => {
      expect(toPlanningOverrides(null, null, "preset-123")).toEqual({ planningAgentPresetId: "preset-123" });
    });

    it("combines multiple overrides", () => {
      expect(toPlanningOverrides({ type: "connected", id: "worker-1", label: "Worker 1" }, null, "preset-123"))
        .toEqual({ workerId: "worker-1", planningAgentPresetId: "preset-123" });
    });
  });

  describe("resolveSubmitOriginalPrompt", () => {
    it("returns goal when mode is plan_only and originalPrompt is null", () => {
      expect(resolveSubmitOriginalPrompt("plan_only", null, "New goal text")).toBe("New goal text");
    });

    it("returns goal when mode is plan_and_start and originalPrompt is empty", () => {
      expect(resolveSubmitOriginalPrompt("plan_and_start", "", "New goal text")).toBe("New goal text");
    });

    it("returns existing originalPrompt when mode is plan_only", () => {
      expect(resolveSubmitOriginalPrompt("plan_only", "Existing original", "New goal text")).toBe("Existing original");
    });

    it("returns existing originalPrompt when mode is draft", () => {
      expect(resolveSubmitOriginalPrompt("draft", "Existing original", "New goal text")).toBe("Existing original");
    });

    it("returns null when mode is draft and originalPrompt is null", () => {
      expect(resolveSubmitOriginalPrompt("draft", null, "New goal text")).toBeNull();
    });

    it("returns null when mode is replan and originalPrompt is null", () => {
      expect(resolveSubmitOriginalPrompt("replan", null, "New goal text")).toBeNull();
    });

    it("trims returned goal", () => {
      expect(resolveSubmitOriginalPrompt("plan_and_start", null, "  Spaced goal  ")).toBe("Spaced goal");
    });
  });
});
