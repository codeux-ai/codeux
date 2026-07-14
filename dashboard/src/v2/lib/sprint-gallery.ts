import type { Sprint } from "../types.js";

/** Maximum number of sprints shown in the showcase gallery at once. */
export const MAX_SHOWCASE_SPRINTS = 20;

/**
 * Filter and sort sprints for the showcase gallery.
 * Returns only sprints that have showcasePinned: true,
 * regardless of their status (survives transitions), capped to the
 * most recent MAX_SHOWCASE_SPRINTS entries so the gallery can't grow
 * without bound and overlap the content below it.
 */
export function filterShowcaseSprints(sprints: ReadonlyArray<Sprint>): Sprint[] {
  return sprints.filter((s) => s.showcasePinned).slice(0, MAX_SHOWCASE_SPRINTS);
}

/**
 * Common sorting for sprints to ensure deterministic gallery order.
 */
export function sortSprintsByRecency(sprints: ReadonlyArray<Sprint>): Sprint[] {
  return [...sprints].sort((left, right) => {
    const createdAtDelta = (right.createdAt || "").localeCompare(left.createdAt || "");
    if (createdAtDelta !== 0) {
      return createdAtDelta;
    }
    return (right.number || 0) - (left.number || 0);
  });
}
