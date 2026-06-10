import type { ExecutionUsageBucketSummary } from "../../types.js";

export interface TrendDelta {
  current: number;
  previous: number;
  changePercent: number | null;
  direction: "up" | "down" | "flat";
}

/**
 * Compares the second half of the window against the first half so every KPI
 * tile can show momentum without needing a second backend query.
 */
export function computeWindowDelta(
  buckets: ExecutionUsageBucketSummary[],
  selector: (bucket: ExecutionUsageBucketSummary) => number,
): TrendDelta {
  if (buckets.length < 2) {
    const only = buckets.reduce((sum, bucket) => sum + selector(bucket), 0);
    return { current: only, previous: 0, changePercent: null, direction: "flat" };
  }

  const midpoint = Math.floor(buckets.length / 2);
  const previous = buckets.slice(0, midpoint).reduce((sum, bucket) => sum + selector(bucket), 0);
  const current = buckets.slice(midpoint).reduce((sum, bucket) => sum + selector(bucket), 0);

  const changePercent = previous > 0 ? ((current - previous) / previous) * 100 : null;
  const direction = current > previous ? "up" : current < previous ? "down" : "flat";

  return { current, previous, changePercent, direction };
}

export function formatDeltaPercent(delta: TrendDelta): string {
  if (delta.changePercent === null) {
    return delta.current > 0 ? "new" : "—";
  }
  const rounded = Math.round(Math.abs(delta.changePercent));
  if (rounded === 0) {
    return "flat";
  }
  return `${delta.changePercent > 0 ? "+" : "-"}${rounded}%`;
}
