import type { Sprint } from "../types.js";

/**
 * Filter and sort sprints for the showcase gallery.
 * Returns only sprints that have showcasePinned: true,
 * regardless of their status (survives transitions).
 */
export function filterShowcaseSprints(sprints: Sprint[]): Sprint[] {
  return sprints.filter((s) => s.showcasePinned);
}

/**
 * Common sorting for sprints to ensure deterministic gallery order.
 */
export function sortSprintsByRecency(sprints: Sprint[]): Sprint[] {
  return [...sprints].sort((left, right) => {
    const createdAtDelta = (right.createdAt || "").localeCompare(left.createdAt || "");
    if (createdAtDelta !== 0) {
      return createdAtDelta;
    }
    return (right.number || 0) - (left.number || 0);
  });
}
