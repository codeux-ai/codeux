import { normalizeProjectStatsQuery } from "./project-stats-query.js";
import { createUsageBuckets, createEmptyUsageTotals, InternalStatsBucket } from "./stats-buckets.js";
import { queryProjectGitStats } from "./project-stats-git-query.js";
import {
  ProjectStatsQuery,
  ProjectStatsWindow,
  ProjectExecutionStatsChartSeries,
  ProjectExecutionStatsSnapshot,
} from "../../contracts/app-types.js";
import { DatabaseAdapter as Database } from "../db/database-adapter.js";
import {
  ExecutionUsageTotals,
} from "../../contracts/app-types.js";
import { toNumber } from "./execution-utils.js";
import { StatsEntityMetadata, ProjectStatsQueryDependencies } from "./execution-stats-types.js";

export function queryProjectStatsSnapshot(
  db: Database,
  projectId: string,
  input: ProjectStatsQuery | ProjectStatsWindow = "7d",
  deps: ProjectStatsQueryDependencies
): ProjectExecutionStatsSnapshot {
  deps.requireProject(projectId);
  const projectRow = db.prepare(`
    SELECT id, name
    FROM projects
    WHERE id = ?
  `).get(projectId) as { id: string; name: string } | undefined;
  const now = new Date();
  const normalized = normalizeProjectStatsQuery(db, projectId, input, now);
  const rangeStartIso = normalized.range.from;
  const rangeEndIso = normalized.range.to;
  const nowIso = now.toISOString();
  const wallTimeByTaskId = deps.getWallTimeTotalsByTaskIdsForRange(projectId, rangeStartIso, rangeEndIso, nowIso);
  const wallTimeBySprintRunId = deps.getWallTimeTotalsBySprintRunIdsForRange(projectId, rangeStartIso, rangeEndIso, nowIso);
  const buckets = createUsageBuckets(normalized.range, normalized.bucketSizeMs);
  const taskMeta = deps.getTaskMetadata(projectId);
  const sprintMeta = deps.getSprintMetadata(projectId);
  const firstBucketStartMs = buckets.length > 0 ? buckets[0].bucketStartMs : 0;

  const { totals: gitTotals, buckets: gitBuckets, taskUsage: gitTaskUsage, sprintUsage: gitSprintUsage } = queryProjectGitStats(
    db,
    projectId,
    rangeStartIso,
    rangeEndIso,
    buckets,
    normalized.bucketSizeMs,
    firstBucketStartMs
  );

  const usageFields = `
    COUNT(*) as invocationCount,
    SUM(COALESCE(duration_ms, 0)) as activeTimeMs,
    SUM(input_tokens) as inputTokens,
    SUM(cached_input_tokens) as cachedInputTokens,
    SUM(output_tokens) as outputTokens,
    SUM(reasoning_output_tokens) as reasoningOutputTokens,
    SUM(total_tokens) as totalTokens,
    SUM(CASE WHEN usage_source = 'reported' THEN 1 ELSE 0 END) as reportedInvocationCount,
    SUM(CASE WHEN usage_source = 'estimated' THEN 1 ELSE 0 END) as estimatedInvocationCount,
    SUM(CASE WHEN usage_source = 'unsupported' THEN 1 ELSE 0 END) as unsupportedInvocationCount,
    SUM(CASE WHEN usage_source NOT IN ('reported', 'estimated', 'unsupported') THEN 1 ELSE 0 END) as unavailableInvocationCount
  `;

  const mapAggregatedUsage = (row: any): ExecutionUsageTotals => ({
    invocationCount: toNumber(row.invocationCount),
    activeTimeMs: toNumber(row.activeTimeMs),
    wallTimeMs: 0,
    inputTokens: toNumber(row.inputTokens),
    cachedInputTokens: toNumber(row.cachedInputTokens),
    outputTokens: toNumber(row.outputTokens),
    reasoningOutputTokens: toNumber(row.reasoningOutputTokens),
    totalTokens: toNumber(row.totalTokens),
    reportedInvocationCount: toNumber(row.reportedInvocationCount),
    estimatedInvocationCount: toNumber(row.estimatedInvocationCount),
    unsupportedInvocationCount: toNumber(row.unsupportedInvocationCount),
    unavailableInvocationCount: toNumber(row.unavailableInvocationCount),
  });

  const mergeAggregatedUsage = (target: ExecutionUsageTotals, source: ExecutionUsageTotals) => {
    target.invocationCount += source.invocationCount;
    target.activeTimeMs += source.activeTimeMs;
    target.inputTokens += source.inputTokens;
    target.cachedInputTokens += source.cachedInputTokens;
    target.outputTokens += source.outputTokens;
    target.reasoningOutputTokens += source.reasoningOutputTokens;
    target.totalTokens += source.totalTokens;
    target.reportedInvocationCount += source.reportedInvocationCount;
    target.estimatedInvocationCount += source.estimatedInvocationCount;
    target.unsupportedInvocationCount += source.unsupportedInvocationCount;
    target.unavailableInvocationCount += source.unavailableInvocationCount;
  };

  const usage = createEmptyUsageTotals();
  const taskUsage = new Map<string, ExecutionUsageTotals>();
  const sprintUsage = new Map<string, ExecutionUsageTotals>();
  const providerUsage = new Map<string, ExecutionUsageTotals>();
  const purposeUsage = new Map<string, ExecutionUsageTotals>();
  const tokenSourceCounts = new Map<string, number>();
  const taskLastActivity = new Map<string, string>();
  const sprintLastActivity = new Map<string, string>();
  const providerLastActivity = new Map<string, string>();
  const purposeLastActivity = new Map<string, string>();

  // 1. Task aggregations
  const taskAggs = db.prepare(`
    SELECT task_id, MAX(COALESCE(finished_at, started_at)) as lastActivityAt, ${usageFields}
    FROM provider_invocations
    WHERE project_id = ? AND started_at >= ? AND started_at < ? AND task_id IS NOT NULL
    GROUP BY task_id
  `).all(projectId, rangeStartIso, rangeEndIso) as any[];

  for (const row of taskAggs) {
    const u = mapAggregatedUsage(row);
    taskUsage.set(row.task_id, u);
    taskLastActivity.set(row.task_id, row.lastActivityAt);
  }

  // 2. Sprint aggregations
  const sprintAggs = db.prepare(`
    SELECT COALESCE(sprint_run_id, sprint_id) as sprint_key, MAX(COALESCE(finished_at, started_at)) as lastActivityAt, ${usageFields}
    FROM provider_invocations
    WHERE project_id = ? AND started_at >= ? AND started_at < ? AND (sprint_run_id IS NOT NULL OR sprint_id IS NOT NULL)
    GROUP BY sprint_key
  `).all(projectId, rangeStartIso, rangeEndIso) as any[];

  for (const row of sprintAggs) {
    const u = mapAggregatedUsage(row);
    sprintUsage.set(row.sprint_key, u);
    sprintLastActivity.set(row.sprint_key, row.lastActivityAt);
  }

  // 3. Bucket/Provider/Purpose/Source aggregations
  const bucketQuery = buckets.length > 0 ? `
    CAST((julianday(started_at) - julianday(?)) * 86400000 / ? AS INTEGER) as bucketIndex,
  ` : "-1 as bucketIndex,";
  const bucketParams = buckets.length > 0 ? [rangeStartIso, normalized.bucketSizeMs] : [];

  const mainAggs = db.prepare(`
    SELECT ${bucketQuery} provider, purpose, usage_source, MAX(COALESCE(finished_at, started_at)) as lastActivityAt, ${usageFields}
    FROM provider_invocations
    WHERE project_id = ? AND started_at >= ? AND started_at < ?
    GROUP BY bucketIndex, provider, purpose, usage_source
  `).all(...bucketParams, projectId, rangeStartIso, rangeEndIso) as any[];

  for (const row of mainAggs) {
    const u = mapAggregatedUsage(row);
    mergeAggregatedUsage(usage, u);

    // Provider usage
    const pU = providerUsage.get(row.provider) || createEmptyUsageTotals();
    mergeAggregatedUsage(pU, u);
    providerUsage.set(row.provider, pU);
    deps.updateLastActivity(providerLastActivity, row.provider, row.lastActivityAt);

    // Purpose usage
    const purU = purposeUsage.get(row.purpose) || createEmptyUsageTotals();
    mergeAggregatedUsage(purU, u);
    purposeUsage.set(row.purpose, purU);
    deps.updateLastActivity(purposeLastActivity, row.purpose, row.lastActivityAt);

    // Token sources
    tokenSourceCounts.set(row.usage_source, (tokenSourceCounts.get(row.usage_source) || 0) + row.invocationCount);

    // Buckets
    if (buckets.length > 0 && row.bucketIndex >= 0 && row.bucketIndex < buckets.length) {
      const bucket = buckets[row.bucketIndex];
      mergeAggregatedUsage(bucket.usage, u);
      bucket.providerTokens.set(row.provider, (bucket.providerTokens.get(row.provider) || 0) + u.totalTokens);
      bucket.purposeTime.set(row.purpose, (bucket.purposeTime.get(row.purpose) || 0) + u.activeTimeMs);
      bucket.purposeInvocations.set(row.purpose, (bucket.purposeInvocations.get(row.purpose) || 0) + u.invocationCount);
    }
  }

  for (const [taskId, wallTime] of wallTimeByTaskId) {
    const total = taskUsage.get(taskId) || createEmptyUsageTotals();
    total.wallTimeMs = wallTime;
    taskUsage.set(taskId, total);
  }
  for (const [sprintKey, wallTime] of wallTimeBySprintRunId) {
    const total = sprintUsage.get(sprintKey) || createEmptyUsageTotals();
    total.wallTimeMs = wallTime;
    sprintUsage.set(sprintKey, total);
  }
  usage.wallTimeMs = Array.from(wallTimeByTaskId.values()).reduce((sum, value) => sum + value, 0);

  const activeSprintRow = db.prepare(`
    SELECT sr.sprint_id, s.name AS sprint_name, s.number AS sprint_number
    FROM sprint_runs sr
    INNER JOIN sprints s ON s.id = sr.sprint_id
    WHERE sr.project_id = ?
      AND sr.status IN ('queued', 'running', 'paused', 'cancel_requested')
    ORDER BY COALESCE(sr.last_heartbeat_at, sr.updated_at, sr.created_at) DESC
    LIMIT 1
  `).get(projectId) as { sprint_id: string; sprint_name: string; sprint_number: number | string | null } | undefined;

  const chartSeries: ProjectExecutionStatsChartSeries[] = [
    { id: "core_total_tokens", label: "Total Tokens", grouping: "totals", defaultEnabled: true, data: buckets.map((b) => b.usage.totalTokens), color: '#00E0A0', signalLabel: 'Throughput', formatter: 'tokens' },
    { id: "core_active_time", label: "Active Time (ms)", grouping: "totals", defaultEnabled: false, data: buckets.map((b) => b.usage.activeTimeMs), color: '#FFB800', signalLabel: 'Latency', formatter: 'duration' },
    { id: "core_invocations", label: "Invocations", grouping: "totals", defaultEnabled: false, data: buckets.map((b) => b.usage.invocationCount), color: '#0EA5E9', signalLabel: 'Volume', formatter: 'number' },
    { id: "core_input_tokens", label: "Input Tokens", grouping: "details", defaultEnabled: false, data: buckets.map((b) => b.usage.inputTokens), formatter: 'tokens' },
    { id: "core_cached_tokens", label: "Cached Tokens", grouping: "details", defaultEnabled: false, data: buckets.map((b) => b.usage.cachedInputTokens), formatter: 'tokens' },
    { id: "core_output_tokens", label: "Output Tokens", grouping: "details", defaultEnabled: false, data: buckets.map((b) => b.usage.outputTokens), formatter: 'tokens' },
    { id: "core_reasoning_tokens", label: "Reasoning Tokens", grouping: "details", defaultEnabled: false, data: buckets.map((b) => b.usage.reasoningOutputTokens), formatter: 'tokens' },
    { id: "reliability_reported", label: "Reported Usage", grouping: "reliability", defaultEnabled: false, data: buckets.map((b) => b.usage.reportedInvocationCount), formatter: 'number' },
    { id: "reliability_estimated", label: "Estimated Usage", grouping: "reliability", defaultEnabled: false, data: buckets.map((b) => b.usage.estimatedInvocationCount), formatter: 'number' },
    { id: "reliability_unsupported", label: "Unsupported Usage", grouping: "reliability", defaultEnabled: false, data: buckets.map((b) => b.usage.unsupportedInvocationCount), formatter: 'number' },
    { id: "reliability_unavailable", label: "Unavailable Usage", grouping: "reliability", defaultEnabled: false, data: buckets.map((b) => b.usage.unavailableInvocationCount), formatter: 'number' },
    { id: "git_insertions", label: "Insertions", grouping: "git", defaultEnabled: true, data: gitBuckets.map((b) => b.metrics.insertions), color: '#10B981', signalLabel: 'Added', formatter: 'number' },
    { id: "git_deletions", label: "Deletions", grouping: "git", defaultEnabled: true, data: gitBuckets.map((b) => b.metrics.deletions), color: '#EF4444', signalLabel: 'Removed', formatter: 'number' },
    { id: "git_prs", label: "Pull Requests", grouping: "git", defaultEnabled: false, data: gitBuckets.map((b) => b.metrics.prCount), color: '#8B5CF6', signalLabel: 'Merged', formatter: 'number' },
    { id: "git_merges", label: "Commits", grouping: "git", defaultEnabled: false, data: gitBuckets.map((b) => b.metrics.mergedCount), color: '#F59E0B', signalLabel: 'History', formatter: 'number' },
    ...Array.from(providerUsage.keys()).map((providerId) => ({
      id: `provider_${providerId}`, label: `${providerId} Tokens`, grouping: "providers", defaultEnabled: false,
      data: buckets.map((b) => b.providerTokens.get(providerId) || 0), formatter: 'tokens' as const
    })),
    ...Array.from(purposeUsage.keys()).map((purposeId) => ({
      id: `purpose_time_${purposeId}`, label: `${purposeId.replace(/_/g, " ")} Time`, grouping: "purposes_time", defaultEnabled: false,
      data: buckets.map((b) => b.purposeTime.get(purposeId) || 0), formatter: 'duration' as const
    })),
    ...Array.from(purposeUsage.keys()).map((purposeId) => ({
      id: `purpose_invocations_${purposeId}`, label: `${purposeId.replace(/_/g, " ")} Calls`, grouping: "purposes_invocations", defaultEnabled: false,
      data: buckets.map((b) => b.purposeInvocations.get(purposeId) || 0), formatter: 'number' as const
    })),
  ];

  const mapEntityUsage = (map: Map<string, ExecutionUsageTotals>, activityMap: Map<string, string>, getMeta?: (id: string) => StatsEntityMetadata | undefined) => {
    return Array.from(map.entries()).map(([id, usage]) => {
      const meta = getMeta ? getMeta(id) : undefined;
      return {
        id,
        label: meta?.label || id,
        secondaryLabel: meta?.secondaryLabel || null,
        status: (meta?.status || null) as any,
        purpose: (meta?.purpose || null) as any,
        provider: (meta?.provider || null) as any,
        usage,
        lastActivityAt: activityMap.get(id) || null,
      };
    }).sort((a, b) => b.usage.totalTokens - a.usage.totalTokens);
  };

  return {
    projectId: projectRow?.id || projectId,
    projectName: projectRow?.name || projectId,
    window: normalized.range.window,
    query: normalized.query,
    range: normalized.range,
    generatedAt: nowIso,
    usage,
    git: {
      totals: gitTotals,
      buckets: gitBuckets,
      tasks: Array.from(gitTaskUsage.entries()).map(([id, metrics]) => {
        const meta = taskMeta.get(id);
        const label = meta?.label || id;
        return { id, label, secondaryLabel: meta?.secondaryLabel || null, metrics };
      }),
      sprints: Array.from(gitSprintUsage.entries()).map(([id, metrics]) => {
        const meta = sprintMeta.get(id);
        const label = meta?.label || id;
        return { id, label, secondaryLabel: meta?.secondaryLabel || null, metrics };
      })
    },
    activeSprint: activeSprintRow ? {
      sprintId: activeSprintRow.sprint_id,
      sprintName: activeSprintRow.sprint_name,
      sprintNumber: activeSprintRow.sprint_number !== null ? toNumber(activeSprintRow.sprint_number) : null,
    } : null,
    buckets: buckets.map((b) => ({ bucketStart: b.bucketStart, bucketEnd: b.bucketEnd, label: b.label, usage: b.usage })),
    sprints: mapEntityUsage(sprintUsage, sprintLastActivity, (id) => sprintMeta.get(id)),
    tasks: mapEntityUsage(taskUsage, taskLastActivity, (id) => taskMeta.get(id)),
    providers: mapEntityUsage(providerUsage, providerLastActivity),
    purposes: mapEntityUsage(purposeUsage, purposeLastActivity),
    tokenSources: Array.from(tokenSourceCounts.entries()).map(([source, count]) => ({ source: source as any, count })).sort((a, b) => b.count - a.count),
    chartSeries,
  };
}
