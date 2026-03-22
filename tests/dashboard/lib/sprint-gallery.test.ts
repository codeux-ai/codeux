import { describe, it, expect } from "vitest";
import { filterShowcaseSprints, sortSprintsByRecency } from "../../../dashboard/src/v2/lib/sprint-gallery.js";
import type { Sprint } from "../../../dashboard/src/types.js";

describe("sprint-gallery", () => {
  const mockSprints: Partial<Sprint>[] = [
    { id: "1", name: "S1", showcasePinned: true, status: "completed", createdAt: "2024-01-01T00:00:00Z" },
    { id: "2", name: "S2", showcasePinned: false, status: "idle", createdAt: "2024-01-02T00:00:00Z" },
    { id: "3", name: "S3", showcasePinned: true, status: "running", createdAt: "2024-01-03T00:00:00Z" },
    { id: "4", name: "S4", showcasePinned: true, status: "paused", createdAt: "2024-01-04T00:00:00Z" },
  ];

  it("filterShowcaseSprints should include all pinned sprints regardless of status", () => {
    const result = filterShowcaseSprints(mockSprints as Sprint[]);
    expect(result).toHaveLength(3);
    expect(result.map(s => s.id)).toContain("1");
    expect(result.map(s => s.id)).toContain("3");
    expect(result.map(s => s.id)).toContain("4");
    expect(result.map(s => s.id)).not.toContain("2");
  });

  it("sortSprintsByRecency should sort by recency (createdAt then number)", () => {
    const result = sortSprintsByRecency(mockSprints as Sprint[]);
    expect(result[0].id).toBe("4");
    expect(result[1].id).toBe("3");
    expect(result[2].id).toBe("2");
    expect(result[3].id).toBe("1");
  });
});
