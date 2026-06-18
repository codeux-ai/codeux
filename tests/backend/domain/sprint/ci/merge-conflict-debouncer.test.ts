import { describe, expect, it } from "vitest";
import { MergeConflictDebouncer } from "../../../../../src/domain/sprint/ci/merge-conflict-debouncer.js";

describe("MergeConflictDebouncer", () => {
  it("does not confirm a conflict on a single DIRTY reading", () => {
    const debouncer = new MergeConflictDebouncer();
    debouncer.beginCycle();
    expect(debouncer.observe("pr-1", "DIRTY")).toBe(false);
  });

  it("confirms a conflict once DIRTY persists across consecutive cycles", () => {
    const debouncer = new MergeConflictDebouncer();
    debouncer.beginCycle();
    expect(debouncer.observe("pr-1", "DIRTY")).toBe(false);
    debouncer.beginCycle();
    expect(debouncer.observe("pr-1", "DIRTY")).toBe(true);
    debouncer.beginCycle();
    expect(debouncer.observe("pr-1", "DIRTY")).toBe(true);
  });

  it("is idempotent within a cycle — multiple observes do not advance the streak", () => {
    const debouncer = new MergeConflictDebouncer();
    debouncer.beginCycle();
    expect(debouncer.observe("pr-1", "DIRTY")).toBe(false);
    // Same cycle, observed again (e.g. by a second call site) — still not confirmed.
    expect(debouncer.observe("pr-1", "DIRTY")).toBe(false);
    expect(debouncer.observe("pr-1", "DIRTY")).toBe(false);
    debouncer.beginCycle();
    expect(debouncer.observe("pr-1", "DIRTY")).toBe(true);
  });

  it("resets the streak when the PR reports a non-DIRTY state", () => {
    const debouncer = new MergeConflictDebouncer();
    debouncer.beginCycle();
    debouncer.observe("pr-1", "DIRTY");
    debouncer.beginCycle();
    expect(debouncer.observe("pr-1", "UNKNOWN")).toBe(false);
    // Streak restarts from scratch — one DIRTY reading is not yet a conflict.
    debouncer.beginCycle();
    expect(debouncer.observe("pr-1", "DIRTY")).toBe(false);
    debouncer.beginCycle();
    expect(debouncer.observe("pr-1", "DIRTY")).toBe(true);
  });

  it("tracks PRs independently by key", () => {
    const debouncer = new MergeConflictDebouncer();
    debouncer.beginCycle();
    debouncer.observe("pr-1", "DIRTY");
    debouncer.observe("pr-2", "DIRTY");
    debouncer.beginCycle();
    debouncer.observe("pr-1", "DIRTY");
    // pr-2 is mergeable this cycle; only pr-1 reached the threshold.
    expect(debouncer.observe("pr-2", "CLEAN")).toBe(false);
    expect(debouncer.observe("pr-1", "DIRTY")).toBe(true);
  });

  it("honours a custom threshold", () => {
    const debouncer = new MergeConflictDebouncer(3);
    for (let i = 0; i < 2; i++) {
      debouncer.beginCycle();
      expect(debouncer.observe("pr-1", "DIRTY")).toBe(false);
    }
    debouncer.beginCycle();
    expect(debouncer.observe("pr-1", "DIRTY")).toBe(true);
  });

  it("falls back to the raw DIRTY signal when no PR key is available", () => {
    const debouncer = new MergeConflictDebouncer();
    debouncer.beginCycle();
    expect(debouncer.observe(null, "DIRTY")).toBe(true);
    expect(debouncer.observe(undefined, "CLEAN")).toBe(false);
  });
});
