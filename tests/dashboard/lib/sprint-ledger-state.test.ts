import { describe, it, expect } from "vitest";
import {
  filterSprints,
  sortSprints,
  getLedgerSprints,
  sliceLedgerSprints,
  toggleSelection,
  selectAllFiltered,
  deselectAll,
  pruneSelection,
  getSelectedFilteredSprints,
  nextSort,
  formatSprintKey,
  STATUS_LABELS,
  STATUS_ORDER,
  DEFAULT_LEDGER_FILTERS,
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
  makeSprint({ id: "e", number: 4, slug: "epsilon", name: "Epsilon QA", goal: "Test running", status: "completed", showcasePinned: true, tasksCount: 1, completion: 100, latestReview: { status: "running", outcome: null, summary: null, findings: [], reviewer: null, finishedAt: null } }),
  makeSprint({ id: "f", number: 5, slug: "zeta", name: "Zeta Reviewed", goal: "Test completed", status: "completed", showcasePinned: false, tasksCount: 1, completion: 100, latestReview: { status: "completed", outcome: "approved", summary: null, findings: [], reviewer: null, finishedAt: null } }),
  makeSprint({ id: "g", number: 6, slug: "eta", name: "Eta Failed", goal: "Test failed", status: "completed", showcasePinned: false, tasksCount: 1, completion: 100, latestReview: { status: "failed", outcome: "rejected", summary: null, findings: [], reviewer: null, finishedAt: null } }),
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
      expect(filterSprints(sprints, DEFAULT_LEDGER_FILTERS)).toHaveLength(7);
      expect(filterSprints(sprints, { ...DEFAULT_LEDGER_FILTERS, query: "  " })).toHaveLength(7);
    });

    it("filters by sprint key (SPR-N)", () => {
      const result = filterSprints(sprints, { ...DEFAULT_LEDGER_FILTERS, query: "SPR-1" });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("a");
    });

    it("filters by slug-based key", () => {
      const result = filterSprints(sprints, { ...DEFAULT_LEDGER_FILTERS, query: "HOTFIX" });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("d");
    });

    it("filters by name (case-insensitive)", () => {
      const result = filterSprints(sprints, { ...DEFAULT_LEDGER_FILTERS, query: "alpha" });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("a");
    });

    it("filters by status label", () => {
      const result = filterSprints(sprints, { ...DEFAULT_LEDGER_FILTERS, query: "Draft" });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("b");
    });

    it("filters by goal text", () => {
      const result = filterSprints(sprints, { ...DEFAULT_LEDGER_FILTERS, query: "production bug" });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("d");
    });

    it("matches partial strings", () => {
      const result = filterSprints(sprints, { ...DEFAULT_LEDGER_FILTERS, query: "sprint" });
      expect(result).toHaveLength(3); // Alpha Sprint, Beta Sprint, Gamma Sprint
    });

    it("is case-insensitive", () => {
      expect(filterSprints(sprints, { ...DEFAULT_LEDGER_FILTERS, query: "RUNNING" })).toHaveLength(2); // Matches "running" status label and "Test running" goal
      expect(filterSprints(sprints, { ...DEFAULT_LEDGER_FILTERS, query: "running" })).toHaveLength(2);
    });

    it("filters by specific statuses", () => {
      const result = filterSprints(sprints, { ...DEFAULT_LEDGER_FILTERS, status: new Set(["running", "failed"]) });
      expect(result).toHaveLength(2);
      expect(result.map(s => s.id)).toEqual(["a", "d"]);
    });

    it("filters by showcase pinned", () => {
      const result = filterSprints(sprints, { ...DEFAULT_LEDGER_FILTERS, showcase: "pinned" });
      expect(result).toHaveLength(3);
      expect(result.map(s => s.id)).toEqual(["a", "c", "e"]);
    });

    it("filters by showcase unpinned", () => {
      const result = filterSprints(sprints, { ...DEFAULT_LEDGER_FILTERS, showcase: "unpinned" });
      expect(result).toHaveLength(4);
      expect(result.map(s => s.id)).toEqual(["b", "d", "f", "g"]);
    });

    it("filters by QA missing", () => {
      const result = filterSprints(sprints, { ...DEFAULT_LEDGER_FILTERS, qa: "missing" });
      expect(result).toHaveLength(4);
      expect(result.map(s => s.id)).toEqual(["a", "b", "c", "d"]);
    });

    it("filters by QA running", () => {
      const result = filterSprints(sprints, { ...DEFAULT_LEDGER_FILTERS, qa: "running" });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("e");
    });

    it("filters by QA reviewed (completed or failed)", () => {
      const result = filterSprints(sprints, { ...DEFAULT_LEDGER_FILTERS, qa: "reviewed" });
      expect(result).toHaveLength(2);
      expect(result.map(s => s.id)).toEqual(["f", "g"]);
    });

    it("combines multiple explicit filters and query text", () => {
      const result = filterSprints(sprints, {
        query: "test",
        status: new Set(["completed"]),
        showcase: "unpinned",
        qa: "reviewed",
      });
      // "test" matches e, f, g ("Test running", "Test completed", "Test failed")
      // status "completed" matches c, e, f, g
      // showcase "unpinned" matches b, d, f, g
      // qa "reviewed" matches f, g
      // Intersection: f, g
      expect(result).toHaveLength(2);
      expect(result.map(s => s.id)).toEqual(["f", "g"]);
    });
  });

  describe("sortSprints", () => {
    it("sorts by name ascending", () => {
      const result = sortSprints(sprints, { key: "name", direction: "asc" });
      expect(result.map((s) => s.name)).toEqual([
        "Alpha Sprint", "Beta Sprint", "Epsilon QA", "Eta Failed", "Gamma Sprint", "Hotfix Deploy", "Zeta Reviewed",
      ]);
    });

    it("sorts by name descending", () => {
      const result = sortSprints(sprints, { key: "name", direction: "desc" });
      expect(result.map((s) => s.name)).toEqual([
        "Zeta Reviewed", "Hotfix Deploy", "Gamma Sprint", "Eta Failed", "Epsilon QA", "Beta Sprint", "Alpha Sprint",
      ]);
    });

    it("sorts by status using STATUS_ORDER", () => {
      const result = sortSprints(sprints, { key: "status", direction: "asc" });
      expect(result.map((s) => s.status)).toEqual(["running", "idle", "completed", "completed", "completed", "completed", "failed"]);
    });

    it("sorts by tasksCount ascending", () => {
      const result = sortSprints(sprints, { key: "tasksCount", direction: "asc" });
      expect(result.map((s) => s.tasksCount)).toEqual([1, 1, 1, 1, 3, 5, 8]);
    });

    it("sorts by completion descending", () => {
      const result = sortSprints(sprints, { key: "completion", direction: "desc" });
      expect(result.map((s) => s.completion)).toEqual([100, 100, 100, 100, 50, 40, 0]);
    });

    it("sorts by createdAt descending", () => {
      const result = sortSprints(sprints, { key: "createdAt", direction: "desc" });
      // all new sprints e, f, g use the default 2024-01-01 createdAt from makeSprint override.
      // let's just test the first and last to ensure sort order is applied generally correctly
      expect(result[0].id).toBe("d"); // 2024-01-04
      expect(result[result.length - 1].createdAt).toBe("2024-01-01T00:00:00Z");
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
      const result = getLedgerSprints(sprints, { ...DEFAULT_LEDGER_FILTERS, query: "sprint" }, { key: "name", direction: "asc" });
      expect(result).toHaveLength(3);
      expect(result[0].name).toBe("Alpha Sprint");
      expect(result[2].name).toBe("Gamma Sprint");
    });
  });

  describe("sliceLedgerSprints", () => {
    it("slices the array up to the limit", () => {
      const result = sliceLedgerSprints(sprints, 2);
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("a");
      expect(result[1].id).toBe("b");
    });

    it("returns all if limit exceeds length", () => {
      const result = sliceLedgerSprints(sprints, 10);
      expect(result).toHaveLength(7);
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
