import {
  ExecutionDurationStats,
  ExecutionInvocationStatusCounts,
} from "../../contracts/app-types.js";

export function createEmptyStatusCounts(): ExecutionInvocationStatusCounts {
  return {
    completed: 0,
    failed: 0,
    cancelled: 0,
    running: 0,
    paused: 0,
  };
}

export function createEmptyDurationStats(): ExecutionDurationStats {
  return {
    sampleCount: 0,
    avgMs: 0,
    p50Ms: 0,
    p95Ms: 0,
    maxMs: 0,
  };
}

export function addStatusCount(counts: ExecutionInvocationStatusCounts, status: string | null | undefined, amount: number): void {
  switch (status) {
    case "completed":
      counts.completed += amount;
      break;
    case "failed":
      counts.failed += amount;
      break;
    case "cancelled":
      counts.cancelled += amount;
      break;
    case "running":
      counts.running += amount;
      break;
    case "paused":
      counts.paused += amount;
      break;
    default:
      break;
  }
}

export function computeSuccessRate(counts: ExecutionInvocationStatusCounts): number | null {
  const finished = counts.completed + counts.failed + counts.cancelled;
  if (finished <= 0) {
    return null;
  }
  return counts.completed / finished;
}

export function computeDurationStats(durations: number[]): ExecutionDurationStats {
  const samples = durations.filter((value) => Number.isFinite(value) && value > 0).sort((left, right) => left - right);
  if (samples.length === 0) {
    return createEmptyDurationStats();
  }
  const total = samples.reduce((sum, value) => sum + value, 0);
  const percentile = (fraction: number): number => {
    const index = Math.min(samples.length - 1, Math.max(0, Math.ceil(fraction * samples.length) - 1));
    return samples[index]!;
  };
  return {
    sampleCount: samples.length,
    avgMs: Math.round(total / samples.length),
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    maxMs: samples[samples.length - 1]!,
  };
}

export function buildModelStatsKey(provider: string | null | undefined, model: string | null | undefined): string {
  return `${provider || "unknown"}::${model || ""}`;
}

export function buildModelStatsLabel(provider: string | null | undefined, model: string | null | undefined): string {
  if (model && model.trim().length > 0) {
    return model.trim();
  }
  return `${provider || "unknown"} (default)`;
}
