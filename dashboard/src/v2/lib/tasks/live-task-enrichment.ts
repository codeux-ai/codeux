import type { Subtask, ExecutionTaskDispatchSummary, ExecutionRuntimeEventSummary } from "../../../types.js";
import { buildLiveTaskTimingSummary } from "../live-stats.js";

export interface LiveTaskEnrichment {
  sessionId?: string;
  sessionState?: string;
  prUrl?: string;
  liveStartedAt?: string | null;
  liveTotalSeconds?: number;
}

export function buildLiveTaskEnrichmentMap(
  runtimeTasks: Subtask[],
  dispatches: ExecutionTaskDispatchSummary[],
  events: ExecutionRuntimeEventSummary[]
): Map<string, LiveTaskEnrichment> {
  const map = new Map<string, LiveTaskEnrichment>();

  for (const task of runtimeTasks) {
    const timing = buildLiveTaskTimingSummary({ task, dispatches, events });

    const enrichment: LiveTaskEnrichment = {};

    if (task.session_id) {
      enrichment.sessionId = task.session_id.replace(/^sessions\//, "");
    }

    if (timing.startedAt) {
      enrichment.liveStartedAt = timing.startedAt;
    }

    if (timing.totalSeconds > 0) {
      enrichment.liveTotalSeconds = timing.totalSeconds;
    }

    const primaryKey = task.record_id;
    const fallbackKey = task.id;

    if (primaryKey) {
      map.set(primaryKey, enrichment);
    }

    if (fallbackKey && fallbackKey !== primaryKey) {
      map.set(fallbackKey, enrichment);
    }
  }

  return map;
}
