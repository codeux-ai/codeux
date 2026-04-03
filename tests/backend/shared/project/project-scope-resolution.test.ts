import { describe, it, expect, vi } from "vitest";
import { getSelectedProjectIdFromSettings, getSelectedSprintIdFromSettings } from "../../../../src/shared/project/project-scope-resolution.js";
import { DatabaseAdapter } from "../../../../src/repositories/db/database-adapter.js";

describe("project-scope-resolution", () => {
  describe("getSelectedProjectIdFromSettings", () => {
    it("returns null when no row is found", () => {
      const db = {
        prepare: vi.fn().mockReturnValue({
          get: vi.fn().mockReturnValue(undefined),
        }),
      } as unknown as DatabaseAdapter;

      expect(getSelectedProjectIdFromSettings(db)).toBeNull();
    });

    it("returns null on invalid JSON", () => {
      const db = {
        prepare: vi.fn().mockReturnValue({
          get: vi.fn().mockReturnValue({ payload: "{" }),
        }),
      } as unknown as DatabaseAdapter;

      expect(getSelectedProjectIdFromSettings(db)).toBeNull();
    });

    it("returns projectId when valid JSON is provided", () => {
      const db = {
        prepare: vi.fn().mockReturnValue({
          get: vi.fn().mockReturnValue({ payload: JSON.stringify({ projectId: "proj-1" }) }),
        }),
      } as unknown as DatabaseAdapter;

      expect(getSelectedProjectIdFromSettings(db)).toBe("proj-1");
    });
  });

  describe("getSelectedSprintIdFromSettings", () => {
    it("returns null when no row is found", () => {
      const db = {
        prepare: vi.fn().mockReturnValue({
          get: vi.fn().mockReturnValue(undefined),
        }),
      } as unknown as DatabaseAdapter;

      expect(getSelectedSprintIdFromSettings(db, "proj-1")).toBeNull();
    });

    it("returns null on invalid JSON", () => {
      const db = {
        prepare: vi.fn().mockReturnValue({
          get: vi.fn().mockReturnValue({ payload: "{" }),
        }),
      } as unknown as DatabaseAdapter;

      expect(getSelectedSprintIdFromSettings(db, "proj-1")).toBeNull();
    });

    it("returns sprintId when valid JSON is provided", () => {
      const db = {
        prepare: vi.fn().mockReturnValue({
          get: vi.fn().mockReturnValue({ payload: JSON.stringify({ sprintId: "sprint-1" }) }),
        }),
      } as unknown as DatabaseAdapter;

      expect(getSelectedSprintIdFromSettings(db, "proj-1")).toBe("sprint-1");
    });
  });
});
