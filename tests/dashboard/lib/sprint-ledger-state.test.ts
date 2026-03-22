import { describe, it, expect } from "vitest";
import {
  filterSprints,
  sortSprints,
  getLedgerSprints,
  toggleSelection,
  selectAllFiltered,
  deselectAll,
  pruneSelection,
  getSelectedFilteredSprints,
  nextSort,
  formatSprintKey,
  STATUS_LABELS,
  STATUS_ORDER,
} from "../../../dashboard/src/v2/lib/sprint-ledger-state.js";
import type { Sprint } from "../../../dashboard/src/types.js";

function makeSprint(overrides: Partial<Sprint>): Sprint {
  return {
    id: "id-1",
    projectId: "proj-1",
    number: 1,
    slug: "sprint-1",
    name: "Sprint One",
    originalPrompt: null,
    goal: "Build the feature",
    status: "idle",
    showcasePinned: false,
    startDate: null,
    endDate: null,
    featureBranch: null,
    tasksCount: 3,
    completion: 0,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    date: "Jan 1",
    ...overrides,
  } as Sprint;
}

const sprints: Sprint[] = [
  makeSprint({ id: "a", number: 1, slug: "alpha", name: "Alpha Sprint", goal: "Auth module", status: "running", showcasePinned: true, tasksCount: 5, completion: 40, createdAt: "2024-01-01T00:00:00Z" }),
  makeSprint({ id: "b", number: 2, slug: "beta", name: "Beta Sprint", goal: "Dashboard UI", status: "idle", showcasePinned: false, tasksCount: 3, completion: 0, createdAt: "2024-01-02T00:00:00Z" }),
  makeSprint({ id: "c", number: 3, slug: "gamma", name: "Gamma Sprint", goal: "API endpoints", status: "completed", showcasePinned: true, tasksCount: 8, completion: 100, createdAt: "2024-01-03T00:00:00Z" }),
  makeSprint({ id: "d", number: null, slug: "hotfix", name: "Hotfix Deploy", goal: "Fix production bug", status: "failed", showcasePinned: false, tasksCount: 1, completion: 50, createdAt: "2024-01-04T00:00:00Z" }),
];

describe("sprint-ledger-state", () => {
  describe("formatSprintKey", () => {
    it("formats numbered sprints as SPR-N", () => {
      expect(formatSprintKey(sprints[0])).toBe("SPR-1");
      expect(formatSprintKey(sprints[2])).toBe("SPR-3");
    });

    it("formats slug-based sprints as uppercase slug", () => {
      expect(formatSprintKey(sprints[3])).toBe("HOTFIX");
    });
  });

  describe("STATUS_LABELS", () => {
    it("maps all statuses to human-readable labels", () => {
      expect(STATUS_LABELS.running).toBe("Running");
      expect(STATUS_LABELS.idle).toBe("Draft");
      expect(STATUS_LABELS.completed).toBe("Completed");
    });
  });

  describe("STATUS_ORDER", () => {
    it("ranks running before idle before completed", () => {
      expect(STATUS_ORDER.running).toBeLessThan(STATUS_ORDER.idle);
      expect(STATUS_ORDER.idle).toBeLessThan(STATUS_ORDER.completed);
    });
  });

  describe("filterSprints", () => {
    it("returns all sprints for empty query", () => {
      expect(filterSprints(sprints, "")).toHaveLength(4);
      expect(filterSprints(sprints, "  ")).toHaveLength(4);
    });

    it("filters by sprint key (SPR-N)", () => {
      const result = filterSprints(sprints, "SPR-1");
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("a");
    });

    it("filters by slug-based key", () => {
      const result = filterSprints(sprints, "HOTFIX");
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("d");
    });

    it("filters by name (case-insensitive)", () => {
      const result = filterSprints(sprints, "alpha");
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("a");
    });

    it("filters by status label", () => {
      const result = filterSprints(sprints, "Draft");
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("b");
    });

    it("filters by goal text", () => {
      const result = filterSprints(sprints, "production bug");
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("d");
    });

    it("matches partial strings", () => {
      const result = filterSprints(sprints, "sprint");
      expect(result).toHaveLength(3); // Alpha Sprint, Beta Sprint, Gamma Sprint
    });

    it("is case-insensitive", () => {
      expect(filterSprints(sprints, "RUNNING")).toHaveLength(1);
      expect(filterSprints(sprints, "running")).toHaveLength(1);
    });
  });

  describe("sortSprints", () => {
    it("sorts by name ascending", () => {
      const result = sortSprints(sprints, { key: "name", direction: "asc" });
      expect(result.map((s) => s.name)).toEqual([
        "Alpha Sprint", "Beta Sprint", "Gamma Sprint", "Hotfix Deploy",
      ]);
    });

    it("sorts by name descending", () => {
      const result = sortSprints(sprints, { key: "name", direction: "desc" });
      expect(result.map((s) => s.name)).toEqual([
        "Hotfix Deploy", "Gamma Sprint", "Beta Sprint", "Alpha Sprint",
      ]);
    });

    it("sorts by status using STATUS_ORDER", () => {
      const result = sortSprints(sprints, { key: "status", direction: "asc" });
      expect(result.map((s) => s.status)).toEqual(["running", "idle", "completed", "failed"]);
    });

    it("sorts by tasksCount ascending", () => {
      const result = sortSprints(sprints, { key: "tasksCount", direction: "asc" });
      expect(result.map((s) => s.tasksCount)).toEqual([1, 3, 5, 8]);
    });

    it("sorts by completion descending", () => {
      const result = sortSprints(sprints, { key: "completion", direction: "desc" });
      expect(result.map((s) => s.completion)).toEqual([100, 50, 40, 0]);
    });

    it("sorts by createdAt descending", () => {
      const result = sortSprints(sprints, { key: "createdAt", direction: "desc" });
      expect(result[0].id).toBe("d");
      expect(result[3].id).toBe("a");
    });

    it("sorts by showcasePinned descending (pinned first)", () => {
      const result = sortSprints(sprints, { key: "showcasePinned", direction: "desc" });
      // Comparator: Number(right) - Number(left), desc reverses → pinned first
      expect(result[0].showcasePinned).toBe(false);
      expect(result[result.length - 1].showcasePinned).toBe(true);
    });

    it("sorts by showcasePinned ascending (pinned first in natural order)", () => {
      const result = sortSprints(sprints, { key: "showcasePinned", direction: "asc" });
      // Comparator: Number(right) - Number(left), natural order puts pinned first
      expect(result[0].showcasePinned).toBe(true);
    });

    it("sorts by sprintKey with numbered sprints ascending", () => {
      const result = sortSprints(sprints, { key: "sprintKey", direction: "asc" });
      // When one sprint has null number, falls through to string compare
      // "HOTFIX" < "SPR-1" lexically, so HOTFIX comes first
      expect(result[0].id).toBe("d"); // HOTFIX
      expect(result[1].id).toBe("a"); // SPR-1
      expect(result[2].id).toBe("b"); // SPR-2
      expect(result[3].id).toBe("c"); // SPR-3
    });
  });

  describe("getLedgerSprints", () => {
    it("filters then sorts", () => {
      const result = getLedgerSprints(sprints, "sprint", { key: "name", direction: "asc" });
      expect(result).toHaveLength(3);
      expect(result[0].name).toBe("Alpha Sprint");
      expect(result[2].name).toBe("Gamma Sprint");
    });
  });

  describe("toggleSelection", () => {
    it("adds id when not present", () => {
      const result = toggleSelection(new Set(["a"]), "b");
      expect(result.has("a")).toBe(true);
      expect(result.has("b")).toBe(true);
    });

    it("removes id when already present", () => {
      const result = toggleSelection(new Set(["a", "b"]), "a");
      expect(result.has("a")).toBe(false);
      expect(result.has("b")).toBe(true);
    });

    it("does not mutate original set", () => {
      const original = new Set(["a"]);
      toggleSelection(original, "b");
      expect(original.size).toBe(1);
    });
  });

  describe("selectAllFiltered", () => {
    it("returns set of all filtered sprint ids", () => {
      const filtered = [sprints[0], sprints[2]];
      const result = selectAllFiltered(filtered);
      expect(result).toEqual(new Set(["a", "c"]));
    });

    it("returns empty set for empty array", () => {
      expect(selectAllFiltered([])).toEqual(new Set());
    });
  });

  describe("deselectAll", () => {
    it("returns empty set", () => {
      expect(deselectAll()).toEqual(new Set());
    });
  });

  describe("pruneSelection", () => {
    it("keeps only ids that exist in filtered set", () => {
      const selected = new Set(["a", "b", "c"]);
      const filtered = [sprints[0], sprints[2]]; // a and c
      const result = pruneSelection(selected, filtered);
      expect(result).toEqual(new Set(["a", "c"]));
    });

    it("returns empty if no overlap", () => {
      const selected = new Set(["x", "y"]);
      const result = pruneSelection(selected, sprints);
      expect(result).toEqual(new Set());
    });
  });

  describe("getSelectedFilteredSprints", () => {
    it("returns sprint objects that are both selected and filtered", () => {
      const selected = new Set(["a", "c", "x"]);
      const filtered = [sprints[0], sprints[1], sprints[2]]; // a, b, c
      const result = getSelectedFilteredSprints(selected, filtered);
      expect(result).toHaveLength(2);
      expect(result.map((s) => s.id)).toEqual(["a", "c"]);
    });

    it("returns empty if nothing selected", () => {
      expect(getSelectedFilteredSprints(new Set(), sprints)).toEqual([]);
    });
  });

  describe("nextSort", () => {
    it("toggles direction when clicking same column", () => {
      expect(nextSort({ key: "name", direction: "asc" }, "name")).toEqual({ key: "name", direction: "desc" });
      expect(nextSort({ key: "name", direction: "desc" }, "name")).toEqual({ key: "name", direction: "asc" });
    });

    it("defaults text columns to asc", () => {
      expect(nextSort({ key: "createdAt", direction: "desc" }, "name").direction).toBe("asc");
      expect(nextSort({ key: "createdAt", direction: "desc" }, "status").direction).toBe("asc");
      expect(nextSort({ key: "createdAt", direction: "desc" }, "sprintKey").direction).toBe("asc");
      expect(nextSort({ key: "createdAt", direction: "desc" }, "showcasePinned").direction).toBe("asc");
    });

    it("defaults numeric columns to desc", () => {
      expect(nextSort({ key: "name", direction: "asc" }, "tasksCount").direction).toBe("desc");
      expect(nextSort({ key: "name", direction: "asc" }, "completion").direction).toBe("desc");
      expect(nextSort({ key: "name", direction: "asc" }, "createdAt").direction).toBe("desc");
    });
  });
});
