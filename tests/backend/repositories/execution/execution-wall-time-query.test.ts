import { describe, it, expect, beforeEach, vi } from "vitest";
import { ExecutionWallTimeQuery } from "../../../../src/repositories/execution/execution-wall-time-query.js";
import { AppDbStorage } from "../../../../src/repositories/app-db-storage.js";
import { DatabaseAdapter } from "../../../../src/repositories/db/database-adapter.js";

describe("ExecutionWallTimeQuery", () => {
  let db: DatabaseAdapter;
  let storage: AppDbStorage;
  let query: ExecutionWallTimeQuery;

  beforeEach(() => {
    db = {
      prepare: vi.fn(),
    } as unknown as DatabaseAdapter;

    storage = {
      executeChunkedInQuery: vi.fn(),
    } as unknown as AppDbStorage;

    query = new ExecutionWallTimeQuery(db, storage);
  });

  describe("getWallTimeTotalsByTaskIds", () => {
    it("returns empty map if no ids", () => {
      const result = query.getWallTimeTotalsByTaskIds("proj-1", [], "2023-01-01T00:00:00Z");
      expect(result.size).toBe(0);
    });

    it("queries missing ids and populates cache", () => {
      // Mock active rows query
      vi.mocked(storage.executeChunkedInQuery).mockReturnValueOnce([{ task_id: "t1", c: 1 }]);
      // Mock finished rows query
      vi.mocked(storage.executeChunkedInQuery).mockReturnValueOnce([{ task_id: "t1", total_duration_ms: 100 }, { task_id: "t2", total_duration_ms: 200 }]);
      // Mock active time query
      vi.mocked(storage.executeChunkedInQuery).mockReturnValueOnce([{ task_id: "t1", total_duration_ms: 50 }]);

      const result = query.getWallTimeTotalsByTaskIds("proj-1", ["t1", "t2"], "2023-01-01T00:00:00Z");

      expect(result.get("t1")).toBe(150); // 100 + 50
      expect(result.get("t2")).toBe(200);

      // Verify second call uses cache
      vi.mocked(storage.executeChunkedInQuery).mockClear();
      vi.mocked(storage.executeChunkedInQuery).mockReturnValueOnce([{ task_id: "t1", total_duration_ms: 60 }]); // Active time query for t1 still happens

      const result2 = query.getWallTimeTotalsByTaskIds("proj-1", ["t1", "t2"], "2023-01-01T00:01:00Z");
      expect(result2.get("t1")).toBe(160); // 100 (cached finished) + 60 (new active)
      expect(result2.get("t2")).toBe(200); // 200 (cached finished)

      expect(storage.executeChunkedInQuery).toHaveBeenCalledTimes(1); // Only the active time query
    });

    it("invalidates cache", () => {
      vi.mocked(storage.executeChunkedInQuery).mockReturnValueOnce([]);
      vi.mocked(storage.executeChunkedInQuery).mockReturnValueOnce([{ task_id: "t1", total_duration_ms: 100 }]);

      query.getWallTimeTotalsByTaskIds("proj-1", ["t1"], "2023-01-01T00:00:00Z");

      vi.mocked(storage.executeChunkedInQuery).mockClear();
      query.invalidateTask("t1");

      vi.mocked(storage.executeChunkedInQuery).mockReturnValueOnce([]);
      vi.mocked(storage.executeChunkedInQuery).mockReturnValueOnce([{ task_id: "t1", total_duration_ms: 150 }]);

      const result = query.getWallTimeTotalsByTaskIds("proj-1", ["t1"], "2023-01-01T00:00:00Z");
      expect(result.get("t1")).toBe(150);
      expect(storage.executeChunkedInQuery).toHaveBeenCalledTimes(2); // Queried missing ids again
    });
  });

  describe("getWallTimeTotalsBySprintRunIds", () => {
    it("returns empty map if no ids", () => {
      const result = query.getWallTimeTotalsBySprintRunIds("proj-1", [], "2023-01-01T00:00:00Z");
      expect(result.size).toBe(0);
    });

    it("queries missing ids and populates cache", () => {
      vi.mocked(storage.executeChunkedInQuery).mockReturnValueOnce([{ sprint_run_id: "s1", c: 1 }]);
      vi.mocked(storage.executeChunkedInQuery).mockReturnValueOnce([{ sprint_run_id: "s1", total_duration_ms: 100 }, { sprint_run_id: "s2", total_duration_ms: 200 }]);
      vi.mocked(storage.executeChunkedInQuery).mockReturnValueOnce([{ sprint_run_id: "s1", total_duration_ms: 50 }]);

      const result = query.getWallTimeTotalsBySprintRunIds("proj-1", ["s1", "s2"], "2023-01-01T00:00:00Z");

      expect(result.get("s1")).toBe(150);
      expect(result.get("s2")).toBe(200);
    });

    it("invalidates cache", () => {
      vi.mocked(storage.executeChunkedInQuery).mockReturnValueOnce([]);
      vi.mocked(storage.executeChunkedInQuery).mockReturnValueOnce([{ sprint_run_id: "s1", total_duration_ms: 100 }]);

      query.getWallTimeTotalsBySprintRunIds("proj-1", ["s1"], "2023-01-01T00:00:00Z");

      vi.mocked(storage.executeChunkedInQuery).mockClear();
      query.invalidateSprintRun("s1");

      vi.mocked(storage.executeChunkedInQuery).mockReturnValueOnce([]);
      vi.mocked(storage.executeChunkedInQuery).mockReturnValueOnce([{ sprint_run_id: "s1", total_duration_ms: 150 }]);

      const result = query.getWallTimeTotalsBySprintRunIds("proj-1", ["s1"], "2023-01-01T00:00:00Z");
      expect(result.get("s1")).toBe(150);
    });
  });

  describe("getWallTimeTotalsByTaskIdsForRange", () => {
    it("queries db for range", () => {
      const mockAll = vi.fn().mockReturnValue([{ task_id: "t1", total_duration_ms: 100 }]);
      db.prepare = vi.fn().mockReturnValue({ all: mockAll }) as any;

      const result = query.getWallTimeTotalsByTaskIdsForRange("proj-1", "start", "end", "now");

      expect(result.get("t1")).toBe(100);
      expect(db.prepare).toHaveBeenCalled();
      expect(mockAll).toHaveBeenCalledWith("now", "proj-1", "start", "end");
    });
  });

  describe("getWallTimeTotalsBySprintRunIdsForRange", () => {
    it("queries db for range", () => {
      const mockAll = vi.fn().mockReturnValue([{ sprint_run_id: "s1", total_duration_ms: 100 }]);
      db.prepare = vi.fn().mockReturnValue({ all: mockAll }) as any;

      const result = query.getWallTimeTotalsBySprintRunIdsForRange("proj-1", "start", "end", "now");

      expect(result.get("s1")).toBe(100);
      expect(db.prepare).toHaveBeenCalled();
      expect(mockAll).toHaveBeenCalledWith("now", "proj-1", "start", "end");
    });
  });
});
