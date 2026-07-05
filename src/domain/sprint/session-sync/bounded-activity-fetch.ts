import type { JulesActivity } from "../../../contracts/app-types.js";
import type { Logger } from "../../../shared/logging/logger.js";

const DEFAULT_ACTIVITY_FETCH_TIMEOUT_MS = 30_000;

const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  sessionName: string,
): Promise<T> => {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }

  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`Timed out fetching activities for ${sessionName} after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
};

export const fetchActivitiesBounded = async (
  sessionNames: string[],
  concurrency: number,
  pageSize: number,
  fetchRecentActivities: (sessionName: string, pageSize?: number) => Promise<JulesActivity[]>,
  logger: Logger,
  timeoutMs: number = DEFAULT_ACTIVITY_FETCH_TIMEOUT_MS,
): Promise<Map<string, JulesActivity[]>> => {
  const results = new Map<string, JulesActivity[]>();
  let currentIndex = 0;

  const worker = async () => {
    while (currentIndex < sessionNames.length) {
      const index = currentIndex++;
      const sessionName = sessionNames[index];
      try {
        const activities = await withTimeout(fetchRecentActivities(sessionName, pageSize), timeoutMs, sessionName);
        results.set(sessionName, activities);
      } catch (err) {
        logger.warn("Could not fetch activities for session", { sessionName, error: err });
        results.set(sessionName, []);
      }
    }
  };

  const workers = [];
  for (let i = 0; i < Math.min(concurrency, sessionNames.length); i++) {
    workers.push(worker());
  }

  await Promise.all(workers);

  // Preserve ordering of results matching input sessionNames array
  const orderedResults = new Map<string, JulesActivity[]>();
  for (const sessionName of sessionNames) {
    orderedResults.set(sessionName, results.get(sessionName) || []);
  }

  return orderedResults;
};
