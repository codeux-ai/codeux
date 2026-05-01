import { useMemo } from "preact/hooks";
import type { ExecutionGitStatsSummary, ExecutionGitStatsBucketSummary } from "../../types.js";

function createGitSeries(
  buckets: ExecutionGitStatsBucketSummary[],
  selector: (bucket: ExecutionGitStatsBucketSummary) => number,
): number[] {
  const values = buckets.map(selector);
  return values.some((value) => value > 0) ? values : new Array(Math.max(buckets.length, 7)).fill(0);
}

export function useGitMetricsMapper(gitStats: ExecutionGitStatsSummary | undefined | null) {
  return useMemo(() => {
    if (!gitStats) {
      return {
        insertions: { value: "+0", series: [] },
        deletions: { value: "-0", series: [] },
        prCount: { value: "0", series: [] },
        mergedCount: { value: "0", series: [] },
      };
    }

    const { totals, buckets } = gitStats;

    return {
      insertions: {
        value: `+${totals.insertions.toLocaleString()}`,
        series: createGitSeries(buckets, (b) => b.metrics.insertions),
      },
      deletions: {
        value: `-${totals.deletions.toLocaleString()}`,
        series: createGitSeries(buckets, (b) => b.metrics.deletions),
      },
      prCount: {
        value: totals.prCount.toLocaleString(),
        series: createGitSeries(buckets, (b) => b.metrics.prCount),
      },
      mergedCount: {
        value: totals.mergedCount.toLocaleString(),
        series: createGitSeries(buckets, (b) => b.metrics.mergedCount),
      },
    };
  }, [gitStats]);
}
