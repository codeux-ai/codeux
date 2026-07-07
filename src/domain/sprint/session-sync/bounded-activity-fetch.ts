import type { JulesActivity } from "../../../contracts/app-types.js";
import type { Logger } from "../../../shared/logging/logger.js";
import {
  mapBoundedOrdered,
  normalizeActivityFetchError,
  withActivityFetchTimeout,
} from "./activity-fetch-utils.js";

const DEFAULT_ACTIVITY_FETCH_TIMEOUT_MS = 30_000;

export const fetchActivitiesBounded = async (
  sessionNames: string[],
  concurrency: number,
  pageSize: number,
  fetchRecentActivities: (sessionName: string, pageSize?: number) => Promise<JulesActivity[]>,
  logger: Logger,
  timeoutMs: number = DEFAULT_ACTIVITY_FETCH_TIMEOUT_MS,
): Promise<Map<string, JulesActivity[]>> => {
  const fetchResults = await mapBoundedOrdered({
    items: sessionNames,
    concurrency,
    mapper: async (sessionName) => {
      const startedAt = Date.now();
      try {
        const activities = await withActivityFetchTimeout(
          fetchRecentActivities(sessionName, pageSize),
          {
            timeoutMs,
            createTimeoutError: () => new Error(`Timed out fetching activities for ${sessionName} after ${timeoutMs}ms`),
          },
        );
        return activities;
      } catch (err) {
        logger.warn("Could not fetch activities for session", {
          sessionName,
          pageSize,
          concurrency,
          timeoutMs,
          elapsedMs: Date.now() - startedAt,
          ...normalizeActivityFetchError(err),
        });
        return [];
      }
    },
  });

  const orderedResults = new Map<string, JulesActivity[]>();
  for (const [index, sessionName] of sessionNames.entries()) {
    orderedResults.set(sessionName, fetchResults[index] || []);
  }

  return orderedResults;
};
