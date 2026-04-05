import { DatabaseAdapter } from "../db/database-adapter.js";
import { InternalStatsBucket } from "./stats-buckets.js";
import { ExecutionGitMetrics, ExecutionGitStatsSummary } from "../../contracts/app-types.js";

export function queryProjectGitStats(
  db: DatabaseAdapter,
  projectId: string,
  rangeStartIso: string,
  rangeEndIso: string,
  buckets: InternalStatsBucket[],
  bucketSizeMs: number,
  firstBucketStartMs: number
): {
  totals: ExecutionGitMetrics;
  buckets: Array<{
    bucketStart: string;
    bucketEnd: string;
    label: string;
    metrics: ExecutionGitMetrics;
  }>;
  taskUsage: Map<string, ExecutionGitMetrics>;
  sprintUsage: Map<string, ExecutionGitMetrics>;
} {
  const gitTotals = { insertions: 0, deletions: 0, filesChanged: 0, prCount: 0, mergedCount: 0 };
  const gitBuckets = buckets.map(b => ({
    bucketStart: b.bucketStart,
    bucketEnd: b.bucketEnd,
    label: b.label,
    metrics: { insertions: 0, deletions: 0, filesChanged: 0, prCount: 0, mergedCount: 0 }
  }));
  const gitTaskUsage = new Map<string, ExecutionGitMetrics>();
  const gitSprintUsage = new Map<string, ExecutionGitMetrics>();

  const getGitMetrics = (map: Map<string, ExecutionGitMetrics>, key: string) => {
    if (!map.has(key)) map.set(key, { insertions: 0, deletions: 0, filesChanged: 0, prCount: 0, mergedCount: 0 });
    return map.get(key)!;
  };

  const processGitMetric = (metrics: ExecutionGitMetrics, insertions: number, deletions: number, filesChanged: number) => {
    metrics.insertions += insertions;
    metrics.deletions += deletions;
    metrics.filesChanged += filesChanged;
  };

  // Process code metrics using SQL grouping
  const gitMetricsAggregations = db.prepare(`
    SELECT
      tr.task_id,
      COALESCE(tr.sprint_run_id, tr.sprint_id) as sprint_key,
      (CAST(strftime('%s', tre.created_at) AS REAL) * 1000 - ?) / ? as raw_bucket_index,
      SUM(CAST(json_extract(tre.payload_json, '$.insertions') AS INTEGER)) as sum_insertions,
      SUM(CAST(json_extract(tre.payload_json, '$.deletions') AS INTEGER)) as sum_deletions,
      SUM(CAST(json_extract(tre.payload_json, '$.filesChanged') AS INTEGER)) as sum_files
    FROM task_run_events tre
    INNER JOIN task_runs tr ON tr.id = tre.task_run_id
    WHERE tr.project_id = ?
      AND tre.event_type IN ('cli_git_pushed', 'jules_git_pushed', 'git_metrics')
      AND tre.created_at >= ?
      AND tre.created_at < ?
    GROUP BY tr.task_id, sprint_key, CAST((CAST(strftime('%s', tre.created_at) AS REAL) * 1000 - ?) / ? AS INTEGER)
  `).all(firstBucketStartMs, bucketSizeMs, projectId, rangeStartIso, rangeEndIso, firstBucketStartMs, bucketSizeMs) as Array<{
    task_id: string;
    sprint_key: string;
    raw_bucket_index: number | null;
    sum_insertions: number | null;
    sum_deletions: number | null;
    sum_files: number | null;
  }>;

  for (const row of gitMetricsAggregations) {
    const insertions = row.sum_insertions || 0;
    const deletions = row.sum_deletions || 0;
    const filesChanged = row.sum_files || 0;

    processGitMetric(gitTotals, insertions, deletions, filesChanged);

    if (row.raw_bucket_index !== null) {
      const bucketIndex = Math.floor(row.raw_bucket_index);
      if (bucketIndex >= 0 && bucketIndex < gitBuckets.length) {
        processGitMetric(gitBuckets[bucketIndex]!.metrics, insertions, deletions, filesChanged);
      }
    }

    const taskMetrics = getGitMetrics(gitTaskUsage, row.task_id);
    processGitMetric(taskMetrics, insertions, deletions, filesChanged);

    const sprintMetrics = getGitMetrics(gitSprintUsage, row.sprint_key);
    processGitMetric(sprintMetrics, insertions, deletions, filesChanged);
  }

  // Process PR and merged counts using SQL grouping
  const prAndMergedAggregations = db.prepare(`
    SELECT
      tr.task_id,
      COALESCE(tr.sprint_run_id, tr.sprint_id) as sprint_key,
      (CAST(strftime('%s', COALESCE(tr.finished_at, tr.started_at, ?)) AS REAL) * 1000 - ?) / ? as raw_bucket_index,
      COUNT(DISTINCT CASE WHEN tr.pr_url IS NOT NULL THEN tr.id END) as pr_count,
      COUNT(DISTINCT CASE WHEN t.is_merged IS NOT NULL AND t.is_merged != 0 AND t.is_merged != '0' THEN tr.id END) as merged_count
    FROM task_runs tr
    INNER JOIN tasks t ON t.id = tr.task_id
    WHERE tr.project_id = ?
      AND COALESCE(tr.finished_at, tr.started_at) >= ?
      AND COALESCE(tr.finished_at, tr.started_at) < ?
    GROUP BY tr.task_id, sprint_key, CAST((CAST(strftime('%s', COALESCE(tr.finished_at, tr.started_at, ?)) AS REAL) * 1000 - ?) / ? AS INTEGER)
  `).all(rangeStartIso, firstBucketStartMs, bucketSizeMs, projectId, rangeStartIso, rangeEndIso, rangeStartIso, firstBucketStartMs, bucketSizeMs) as Array<{
    task_id: string;
    sprint_key: string;
    raw_bucket_index: number | null;
    pr_count: number;
    merged_count: number;
  }>;

  for (const row of prAndMergedAggregations) {
    const prCount = row.pr_count || 0;
    const mergedCount = row.merged_count || 0;

    gitTotals.prCount += prCount;
    gitTotals.mergedCount += mergedCount;

    if (row.raw_bucket_index !== null) {
      const bucketIndex = Math.floor(row.raw_bucket_index);
      if (bucketIndex >= 0 && bucketIndex < gitBuckets.length) {
        gitBuckets[bucketIndex]!.metrics.prCount += prCount;
        gitBuckets[bucketIndex]!.metrics.mergedCount += mergedCount;
      }
    }

    const taskMetrics = getGitMetrics(gitTaskUsage, row.task_id);
    taskMetrics.prCount += prCount;
    taskMetrics.mergedCount += mergedCount;

    const sprintMetrics = getGitMetrics(gitSprintUsage, row.sprint_key);
    sprintMetrics.prCount += prCount;
    sprintMetrics.mergedCount += mergedCount;
  }

  return { totals: gitTotals, buckets: gitBuckets, taskUsage: gitTaskUsage, sprintUsage: gitSprintUsage };
}
