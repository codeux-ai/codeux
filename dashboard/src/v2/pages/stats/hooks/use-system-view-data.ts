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
  };
}
