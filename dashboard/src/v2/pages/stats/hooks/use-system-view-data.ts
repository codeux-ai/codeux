import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { fetchProjectInvocations } from "../../../lib/invocation-api.js";
import type { ExecutionInvocationRecord, ExecutionInvocationStatus } from "../../../types.js";

export type SystemSortKey = "startedAt" | "inputTokens" | "outputTokens" | "totalTokens" | "durationMs";

export interface SystemSort {
  key: SystemSortKey;
  dir: "asc" | "desc";
}

export interface SystemFilters {
  status: ExecutionInvocationStatus[];
  purpose: string[];
  provider: string[];
  errorCategories?: string[];
}

export interface ExternalApiMetrics {
  git: { calls: number; avgDurationMs: number };
  jules: { calls: number; avgDurationMs: number };
  jira: { calls: number; avgDurationMs: number };
  other: { calls: number; avgDurationMs: number };
}

export interface SprintStateSummary {
  totalSprints: number;
  activeSprints: number;
  completedSprints: number;
  failedSprints: number;
  totalTasks: number;
  runningTasks: number;
  blockedTasks: number;
}

export interface ErrorsByCategory {
  timeout: number;
  rateLimit: number;
  apiError: number;
  modelError: number;
  cancelled: number;
  other: number;
}

export interface SystemSummaryMetrics {
  totalInvocations: number;
  runningCount: number;
  failedCount: number;
  completedCount: number;
  cancelledCount: number;
  pausedCount: number;
  errorRate: number;
  successRate: number | null;
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  cacheHitRate: number | null;
  avgDurationMs: number;
  p95DurationMs: number;
}

const EMPTY_FILTERS: SystemFilters = {
  status: [],
  purpose: [],
  provider: [],
  errorCategories: [],
};

const normalizeText = (value: string | null | undefined): string => (value || "").trim().toLowerCase();

const getNumericValue = (value: number | null | undefined): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

const getTimestampMs = (value: string | null | undefined): number => {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const getDurationMs = (record: ExecutionInvocationRecord): number => {
  if (!record.finishedAt) {
    return 0;
  }
  const startedAtMs = getTimestampMs(record.startedAt);
  const finishedAtMs = getTimestampMs(record.finishedAt);
  return Math.max(0, finishedAtMs - startedAtMs);
};

export function useSystemViewData(projectId: string) {
  const [allInvocations, setAllInvocations] = useState<ExecutionInvocationRecord[]>([]);
  const [filters, setFilters] = useState<SystemFilters>(EMPTY_FILTERS);
  const [search, setSearch] = useState<string>("");
  const [sort, setSort] = useState<SystemSort>({ key: "startedAt", dir: "desc" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!projectId) {
      setAllInvocations([]);
      setLoading(false);
      setError(null);
      return;
    }

    let active = true;

    setLoading(true);
    setError(null);

    void fetchProjectInvocations(projectId)
      .then((nextInvocations) => {
        if (!active) {
          return;
        }
        setAllInvocations(nextInvocations);
      })
      .catch((fetchError: unknown) => {
        if (!active) {
          return;
        }
        setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [projectId, refreshKey]);

  const filteredInvocations = useMemo(() => {
    const normalizedSearch = normalizeText(search);

    const filtered = allInvocations.filter((record) => {
      if (filters.status.length > 0 && !filters.status.includes(record.status)) {
        return false;
      }

      const purposeValue = (record.type || "").trim();
      if (filters.purpose.length > 0 && !filters.purpose.includes(purposeValue)) {
        return false;
      }

      const providerValue = (record.provider || "").trim();
      if (filters.provider.length > 0 && !filters.provider.includes(providerValue)) {
        return false;
      }

      if (filters.errorCategories && filters.errorCategories.length > 0) {
        const msg = (record.lastErrorMessage || "").toLowerCase();
        let matched = false;
        for (const cat of filters.errorCategories) {
          if (cat === "timeout" && msg.includes("timeout")) matched = true;
          else if (cat === "rateLimit" && (msg.includes("rate") || msg.includes("429"))) matched = true;
          else if (cat === "modelError" && msg.includes("model")) matched = true;
          else if (cat === "apiError" && (msg.includes("api") || msg.includes("http"))) matched = true;
          else if (cat === "cancelled" && (msg.includes("cancel") || record.status === "cancelled")) matched = true;
        }
        if (!matched) return false;
      }

      if (normalizedSearch.length === 0) {
        return true;
      }

      const searchTarget = [
        record.id,
        record.model,
        record.type,
        record.taskTitle,
        record.lastErrorMessage,
        record.errorMessage,
      ].map(normalizeText).join(" ");

      return searchTarget.includes(normalizedSearch);
    });

    const sorted = [...filtered].sort((left, right) => {
      const direction = sort.dir === "asc" ? 1 : -1;

      let leftValue = 0;
      let rightValue = 0;

      switch (sort.key) {
        case "startedAt":
          leftValue = getTimestampMs(left.startedAt);
          rightValue = getTimestampMs(right.startedAt);
          break;
        case "totalTokens":
          leftValue = getNumericValue(left.totalTokens);
          rightValue = getNumericValue(right.totalTokens);
          break;
        case "durationMs":
          leftValue = left.finishedAt ? Date.parse(left.finishedAt) - Date.parse(left.startedAt) : 0;
          rightValue = right.finishedAt ? Date.parse(right.finishedAt) - Date.parse(right.startedAt) : 0;
          leftValue = Number.isFinite(leftValue) ? leftValue : 0;
          rightValue = Number.isFinite(rightValue) ? rightValue : 0;
          break;
        case "inputTokens":
          leftValue = getNumericValue(left.inputTokens);
          rightValue = getNumericValue(right.inputTokens);
          break;
        case "outputTokens":
          leftValue = getNumericValue(left.outputTokens);
          rightValue = getNumericValue(right.outputTokens);
          break;
        default:
          break;
      }

      const delta = leftValue - rightValue;
      if (delta !== 0) {
        return delta * direction;
      }

      return left.id.localeCompare(right.id) * direction;
    });

    return sorted;
  }, [allInvocations, filters, search, sort]);

  const summaryMetrics = useMemo<SystemSummaryMetrics>(() => {
    const totalInvocations = filteredInvocations.length;
    let runningCount = 0;
    let failedCount = 0;
    let completedCount = 0;
    let cancelledCount = 0;
    let pausedCount = 0;
    let totalTokens = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCachedTokens = 0;
    let durationTotal = 0;
    const durations: number[] = [];

    for (const record of filteredInvocations) {
      if (record.status === "running") {
        runningCount += 1;
      } else if (record.status === "failed") {
        failedCount += 1;
      } else if (record.status === "completed") {
        completedCount += 1;
      } else if (record.status === "cancelled") {
        cancelledCount += 1;
      } else if (record.status === "paused") {
        pausedCount += 1;
      }

      totalTokens += getNumericValue(record.totalTokens);
      totalInputTokens += getNumericValue(record.inputTokens);
      totalOutputTokens += getNumericValue(record.outputTokens);
      totalCachedTokens += getNumericValue(record.cachedInputTokens);

      if (record.finishedAt !== null) {
        const durationMs = getDurationMs(record);
        durationTotal += durationMs;
        durations.push(durationMs);
      }
    }

    durations.sort((left, right) => left - right);
    const finishedCount = durations.length;
    const p95DurationMs = finishedCount > 0
      ? durations[Math.min(finishedCount - 1, Math.max(0, Math.ceil(0.95 * finishedCount) - 1))]!
      : 0;
    const decidedCount = completedCount + failedCount + cancelledCount;
    const cacheDenominator = totalInputTokens + totalCachedTokens;

    return {
      totalInvocations,
      runningCount,
      failedCount,
      completedCount,
      cancelledCount,
      pausedCount,
      errorRate: failedCount / Math.max(1, totalInvocations),
      successRate: decidedCount > 0 ? completedCount / decidedCount : null,
      totalTokens,
      totalInputTokens,
      totalOutputTokens,
      totalCachedTokens,
      cacheHitRate: cacheDenominator > 0 ? totalCachedTokens / cacheDenominator : null,
      avgDurationMs: finishedCount > 0 ? durationTotal / finishedCount : 0,
      p95DurationMs,
    };
  }, [filteredInvocations]);

  const availablePurposes = useMemo(() => {
    const purposes = new Set<string>();
    for (const record of allInvocations) {
      const purpose = (record.type || "").trim();
      if (purpose) {
        purposes.add(purpose);
      }
    }
    return Array.from(purposes).sort((left, right) => left.localeCompare(right));
  }, [allInvocations]);

  const externalApiMetrics = useMemo<ExternalApiMetrics>(() => {
    const metrics: ExternalApiMetrics = {
      git: { calls: 0, avgDurationMs: 0 },
      jules: { calls: 0, avgDurationMs: 0 },
      jira: { calls: 0, avgDurationMs: 0 },
      other: { calls: 0, avgDurationMs: 0 },
    };

    const totals = { git: 0, jules: 0, jira: 0, other: 0 };
    const finishedCounts = { git: 0, jules: 0, jira: 0, other: 0 };

    for (const record of allInvocations) {
      const type = (record.type || "").toLowerCase();
      const purpose = ((record as any).purpose || "").toLowerCase();
      const provider = (record.provider || "").toLowerCase();
      const isModel = type === "coding" || type === "planning" || type === "qa";

      let category: keyof ExternalApiMetrics | null = null;

      if (type.includes("git") || purpose.includes("git")) {
        category = "git";
      } else if (provider === "jules" || type.includes("jules")) {
        category = "jules";
      } else if (type.includes("jira") || purpose.includes("jira")) {
        category = "jira";
      } else if (!isModel) {
        category = "other";
      }

      if (category) {
        metrics[category].calls += 1;
        if (record.finishedAt) {
          totals[category] += getDurationMs(record);
          finishedCounts[category] += 1;
        }
      }
    }

    for (const key of ["git", "jules", "jira", "other"] as const) {
      if (finishedCounts[key] > 0) {
        metrics[key].avgDurationMs = totals[key] / finishedCounts[key];
      }
    }

    return metrics;
  }, [allInvocations]);

  const sprintStateSummary = useMemo<SprintStateSummary>(() => {
    const sprintMap = new Map<string, { statusCounts: Record<string, number> }>();
    let totalTasks = 0;
    let runningTasks = 0;
    let blockedTasks = 0;

    for (const record of allInvocations) {
      const sprintId = record.sprintId || (record as any).projectRunId || "";

      if (!sprintMap.has(sprintId)) {
        sprintMap.set(sprintId, { statusCounts: {} });
      }

      const sprintData = sprintMap.get(sprintId)!;
      sprintData.statusCounts[record.status] = (sprintData.statusCounts[record.status] || 0) + 1;

      totalTasks += 1;
      if (record.status === "running") runningTasks += 1;
      if (record.status === "paused") blockedTasks += 1;
    }

    let activeSprints = 0;
    let completedSprints = 0;
    let failedSprints = 0;

    for (const [sprintId, data] of sprintMap.entries()) {
      if (!sprintId) continue;

      const counts = data.statusCounts;
      const totalInSprint = Object.values(counts).reduce((sum, c) => sum + c, 0);

      if (counts["running"] > 0) activeSprints += 1;
      if (counts["failed"] > 0) failedSprints += 1;
      if (counts["completed"] === totalInSprint && totalInSprint > 0) completedSprints += 1;
    }

    const uniqueSprintCount = Array.from(sprintMap.keys()).filter(id => id !== "").length;

    return {
      totalSprints: uniqueSprintCount,
      activeSprints,
      completedSprints,
      failedSprints,
      totalTasks,
      runningTasks,
      blockedTasks,
    };
  }, [allInvocations]);

  const errorsByCategory = useMemo<ErrorsByCategory>(() => {
    const counts: ErrorsByCategory = {
      timeout: 0,
      rateLimit: 0,
      apiError: 0,
      modelError: 0,
      cancelled: 0,
      other: 0,
    };

    for (const record of allInvocations) {
      if (record.status === "failed" || record.status === "cancelled") {
        const msg = (record.lastErrorMessage || "").toLowerCase();

        if (msg.includes("timeout")) counts.timeout += 1;
        else if (msg.includes("rate") || msg.includes("429")) counts.rateLimit += 1;
        else if (msg.includes("model")) counts.modelError += 1;
        else if (msg.includes("api") || msg.includes("http")) counts.apiError += 1;
        else if (msg.includes("cancel") || record.status === "cancelled") counts.cancelled += 1;
        else counts.other += 1;
      }
    }

    return counts;
  }, [allInvocations]);

  const availableProviders = useMemo(() => {
    const providers = new Set<string>();
    for (const record of allInvocations) {
      const provider = (record.provider || "").trim();
      if (provider) {
        providers.add(provider);
      }
    }
    return Array.from(providers).sort((left, right) => left.localeCompare(right));
  }, [allInvocations]);

  const refetch = useCallback(() => {
    setRefreshKey((current) => current + 1);
  }, []);

  return {
    invocations: filteredInvocations,
    allInvocations,
    summaryMetrics,
    availablePurposes,
    availableProviders,
    filters,
    setFilters,
    search,
    setSearch,
    sort,
    setSort,
    loading,
    error,
    refetch,
    externalApiMetrics,
    sprintStateSummary,
    errorsByCategory,
  };
}
