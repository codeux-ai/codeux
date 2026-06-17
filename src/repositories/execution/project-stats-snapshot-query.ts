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
import {
  addStatusCount,
  buildModelStatsKey,
  buildModelStatsLabel,
  computeDurationStats,
  computeDurationStatsFromAggregates,
  computeSuccessRate,
  createEmptyStatusCounts,
  ExecutionDurationAggregates,
} from "./model-stats.js";
import {
  ExecutionInvocationStatusCounts,
  ExecutionModelStatsSummary,
} from "../../contracts/app-types.js";

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
    SUM(tool_call_count) as toolCallCount,
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
    toolCallCount: toNumber(row.toolCallCount),
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
    target.toolCallCount = (target.toolCallCount ?? 0) + (source.toolCallCount ?? 0);
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
  const modelUsage = new Map<string, ExecutionUsageTotals>();
  const modelMeta = new Map<string, { provider: string; model: string | null }>();
  const modelStatusCounts = new Map<string, ExecutionInvocationStatusCounts>();
  const modelLastActivity = new Map<string, string>();
  const statusCounts = createEmptyStatusCounts();

  const bucketQuery = buckets.length > 0 ? `
    CAST((julianday(started_at) - julianday(?)) * 86400000 / ? AS INTEGER) as bucketIndex,
  ` : "-1 as bucketIndex,";
  const bucketParams = buckets.length > 0 ? [rangeStartIso, normalized.bucketSizeMs] : [];

  // Single comprehensive query
  const mainAggs = db.prepare(`
    SELECT
      ${bucketQuery}
      task_id,
      COALESCE(sprint_run_id, sprint_id) as sprint_key,
      provider,
      purpose,
      usage_source,
      model,
      status,
      MAX(COALESCE(finished_at, started_at)) as lastActivityAt,
      ${usageFields}
    FROM provider_invocations
    WHERE project_id = ? AND started_at >= ? AND started_at < ?
    GROUP BY bucketIndex, task_id, sprint_key, provider, purpose, usage_source, model, status
  `).all(...bucketParams, projectId, rangeStartIso, rangeEndIso) as any[];

  for (const row of mainAggs) {
    const u = mapAggregatedUsage(row);
    mergeAggregatedUsage(usage, u);

    // Task aggregations
    if (row.task_id) {
      const tU = taskUsage.get(row.task_id) || createEmptyUsageTotals();
      mergeAggregatedUsage(tU, u);
      taskUsage.set(row.task_id, tU);
      deps.updateLastActivity(taskLastActivity, row.task_id, row.lastActivityAt);
    }

    // Sprint aggregations
    if (row.sprint_key) {
      const sU = sprintUsage.get(row.sprint_key) || createEmptyUsageTotals();
      mergeAggregatedUsage(sU, u);
      sprintUsage.set(row.sprint_key, sU);
      deps.updateLastActivity(sprintLastActivity, row.sprint_key, row.lastActivityAt);
    }

    // Provider usage
    if (row.provider) {
      const pU = providerUsage.get(row.provider) || createEmptyUsageTotals();
      mergeAggregatedUsage(pU, u);
      providerUsage.set(row.provider, pU);
      deps.updateLastActivity(providerLastActivity, row.provider, row.lastActivityAt);
    }

    // Purpose usage
    if (row.purpose) {
      const purU = purposeUsage.get(row.purpose) || createEmptyUsageTotals();
      mergeAggregatedUsage(purU, u);
      purposeUsage.set(row.purpose, purU);
      deps.updateLastActivity(purposeLastActivity, row.purpose, row.lastActivityAt);
    }

    // Token sources
    if (row.usage_source) {
      tokenSourceCounts.set(row.usage_source, (tokenSourceCounts.get(row.usage_source) || 0) + row.invocationCount);
    }

    // Model + status aggregations
    const modelKey = buildModelStatsKey(row.provider, row.model);
    if (!modelMeta.has(modelKey)) {
      modelMeta.set(modelKey, { provider: row.provider || "unknown", model: row.model || null });
    }
    const mU = modelUsage.get(modelKey) || createEmptyUsageTotals();
    mergeAggregatedUsage(mU, u);
    modelUsage.set(modelKey, mU);
    deps.updateLastActivity(modelLastActivity, modelKey, row.lastActivityAt);
    const mCounts = modelStatusCounts.get(modelKey) || createEmptyStatusCounts();
    addStatusCount(mCounts, row.status, u.invocationCount);
    modelStatusCounts.set(modelKey, mCounts);
    addStatusCount(statusCounts, row.status, u.invocationCount);

    // Buckets
    if (buckets.length > 0 && row.bucketIndex >= 0 && row.bucketIndex < buckets.length) {
      const bucket = buckets[row.bucketIndex];
      mergeAggregatedUsage(bucket.usage, u);
      bucket.providerTokens.set(row.provider, (bucket.providerTokens.get(row.provider) || 0) + u.totalTokens);
      bucket.purposeTime.set(row.purpose, (bucket.purposeTime.get(row.purpose) || 0) + u.activeTimeMs);
      bucket.purposeInvocations.set(row.purpose, (bucket.purposeInvocations.get(row.purpose) || 0) + u.invocationCount);
      bucket.modelTokens.set(modelKey, (bucket.modelTokens.get(modelKey) || 0) + u.totalTokens);
    }
  }

  // Duration distribution aggregates
  const durationAggRows = db.prepare(`
    SELECT
      provider,
      model,
      COUNT(duration_ms) as sampleCount,
      MIN(duration_ms) as minMs,
      MAX(duration_ms) as maxMs,
      AVG(duration_ms) as avgMs
    FROM provider_invocations
    WHERE project_id = ? AND started_at >= ? AND started_at < ?
      AND duration_ms IS NOT NULL AND duration_ms > 0
    GROUP BY provider, model
  `).all(projectId, rangeStartIso, rangeEndIso) as Array<{
    provider: string | null;
    model: string | null;
    sampleCount: number;
    minMs: number;
    maxMs: number;
    avgMs: number;
  }>;

  const modelDurationAggs = new Map<string, ExecutionDurationAggregates>();
  let overallSampleCount = 0;
  let overallMinMs = Number.MAX_SAFE_INTEGER;
  let overallMaxMs = 0;
  let overallSumMs = 0;

  for (const row of durationAggRows) {
    const key = buildModelStatsKey(row.provider, row.model);
    modelDurationAggs.set(key, {
      sampleCount: toNumber(row.sampleCount),
      minMs: toNumber(row.minMs),
      maxMs: toNumber(row.maxMs),
      avgMs: toNumber(row.avgMs),
    });

    const count = toNumber(row.sampleCount);
    overallSampleCount += count;
    overallMinMs = Math.min(overallMinMs, toNumber(row.minMs));
    overallMaxMs = Math.max(overallMaxMs, toNumber(row.maxMs));
    overallSumMs += toNumber(row.avgMs) * count;
  }

  const overallDurationAggs: ExecutionDurationAggregates = {
    sampleCount: overallSampleCount,
    minMs: overallSampleCount > 0 ? overallMinMs : 0,
    maxMs: overallMaxMs,
    avgMs: overallSampleCount > 0 ? overallSumMs / overallSampleCount : 0,
  };

  // Duration distribution per model (percentiles need raw samples, not SUM aggregates)
  // Bound to the most recent 10000 invocations to prevent unbounded memory growth
  const durationSampleRows = db.prepare(`
    SELECT provider, model, duration_ms as durationMs
    FROM provider_invocations
    WHERE project_id = ? AND started_at >= ? AND started_at < ?
      AND duration_ms IS NOT NULL AND duration_ms > 0
    ORDER BY started_at DESC
    LIMIT 10000
  `).all(projectId, rangeStartIso, rangeEndIso) as Array<{ provider: string | null; model: string | null; durationMs: number | string }>;

  const allDurations: number[] = [];
  const modelDurations = new Map<string, number[]>();
  for (const row of durationSampleRows) {
    const durationMs = toNumber(row.durationMs);
    if (durationMs <= 0) continue;
    allDurations.push(durationMs);
    const key = buildModelStatsKey(row.provider, row.model);
    const samples = modelDurations.get(key) || [];
    samples.push(durationMs);
    modelDurations.set(key, samples);
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

  const taskIds = Array.from(new Set([...taskUsage.keys(), ...gitTaskUsage.keys()]));
  const sprintIds = Array.from(new Set([...sprintUsage.keys(), ...gitSprintUsage.keys()]));

  const taskMeta = deps.getTaskMetadata(projectId, taskIds);
  const sprintMeta = deps.getSprintMetadata(projectId, sprintIds);

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
    { id: "git_files_changed", label: "Files Changed", grouping: "git", defaultEnabled: true, data: gitBuckets.map((b) => b.metrics.filesChanged), color: '#3B82F6', signalLabel: 'Modified', formatter: 'number' },
    { id: "git_prs", label: "Pull Requests", grouping: "git", defaultEnabled: false, data: gitBuckets.map((b) => b.metrics.prCount), color: '#8B5CF6', signalLabel: 'Merged', formatter: 'number' },
    { id: "git_merges", label: "Commits", grouping: "git", defaultEnabled: false, data: gitBuckets.map((b) => b.metrics.mergedCount), color: '#F59E0B', signalLabel: 'History', formatter: 'number' },
    { id: "core_cache_hit", label: "Cache Hit Rate", grouping: "details", defaultEnabled: false, data: buckets.map((b) => {
      const denominator = b.usage.inputTokens + b.usage.cachedInputTokens;
      return denominator > 0 ? Math.round((b.usage.cachedInputTokens / denominator) * 1000) / 10 : 0;
    }), formatter: 'percent' },
    ...Array.from(providerUsage.keys()).map((providerId) => ({
      id: `provider_${providerId}`, label: `${providerId} Tokens`, grouping: "providers", defaultEnabled: false,
      data: buckets.map((b) => b.providerTokens.get(providerId) || 0), formatter: 'tokens' as const
    })),
    ...Array.from(modelUsage.keys()).map((modelKey) => {
      const meta = modelMeta.get(modelKey);
      return {
        id: `model_${modelKey}`,
        label: `${buildModelStatsLabel(meta?.provider, meta?.model)} Tokens`,
        grouping: "models",
        defaultEnabled: false,
        data: buckets.map((b) => b.modelTokens.get(modelKey) || 0),
        formatter: 'tokens' as const,
      };
    }),
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
    mergeConflictCount: gitTotals.mergeConflictCount,
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
    models: Array.from(modelUsage.entries()).map(([key, modelTotals]): ExecutionModelStatsSummary => {
      const meta = modelMeta.get(key);
      const counts = modelStatusCounts.get(key) || createEmptyStatusCounts();
      return {
        id: key,
        provider: meta?.provider || "unknown",
        model: meta?.model || null,
        label: buildModelStatsLabel(meta?.provider, meta?.model),
        usage: modelTotals,
        statusCounts: counts,
        successRate: computeSuccessRate(counts),
        duration: computeDurationStatsFromAggregates(modelDurationAggs.get(key), modelDurations.get(key) || []),
        lastActivityAt: modelLastActivity.get(key) || null,
      };
    }).sort((a, b) => b.usage.totalTokens - a.usage.totalTokens),
    statusCounts,
    duration: computeDurationStatsFromAggregates(overallDurationAggs, allDurations),
    tokenSources: Array.from(tokenSourceCounts.entries()).map(([source, count]) => ({ source: source as any, count })).sort((a, b) => b.count - a.count),
    chartSeries,
  };
}
