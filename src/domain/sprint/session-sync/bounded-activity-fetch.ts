import type { JulesActivity } from "../../../contracts/app-types.js";
import type { Logger } from "../../../shared/logging/logger.js";

export const DEFAULT_ACTIVITY_FETCH_TIMEOUT_MS = 8_000;

export interface FetchActivitiesBoundedOptions {
  timeoutMs?: number;
  fetchPhase?: string;
}

interface ActivityFetchTimeout {
  timedOut: true;
}

const ACTIVITY_FETCH_TIMEOUT: ActivityFetchTimeout = { timedOut: true };

const isActivityFetchTimeout = (value: JulesActivity[] | ActivityFetchTimeout): value is ActivityFetchTimeout => (
  "timedOut" in value && value.timedOut === true
);

const createTimeout = (timeoutMs: number): { promise: Promise<ActivityFetchTimeout>; cancel: () => void } => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<ActivityFetchTimeout>((resolve) => {
    timeout = setTimeout(() => {
      resolve(ACTIVITY_FETCH_TIMEOUT);
    }, timeoutMs);
  });
  return {
    promise,
    cancel: () => {
      if (timeout) {
        clearTimeout(timeout);
      }
    },
  };
};

export const fetchActivitiesBounded = async (
  sessionNames: string[],
  concurrency: number,
  pageSize: number,
  fetchRecentActivities: (sessionName: string, pageSize?: number) => Promise<JulesActivity[]>,
  logger: Logger,
  options: FetchActivitiesBoundedOptions = {},
): Promise<Map<string, JulesActivity[]>> => {
  const results = new Map<string, JulesActivity[]>();
  const timeoutMs = options.timeoutMs ?? DEFAULT_ACTIVITY_FETCH_TIMEOUT_MS;
  const fetchPhase = options.fetchPhase ?? "session_sync_activity_fetch";
  let currentIndex = 0;

  const worker = async () => {
    while (currentIndex < sessionNames.length) {
      const index = currentIndex++;
      const sessionName = sessionNames[index];
      const timeout = createTimeout(timeoutMs);
      try {
        const activities = await Promise.race([
          fetchRecentActivities(sessionName, pageSize),
          timeout.promise,
        ]);
        if (isActivityFetchTimeout(activities)) {
          logger.warn("Timed out fetching activities for session", {
            sessionName,
            timeoutMs,
            fetchPhase,
          });
          results.set(sessionName, []);
          continue;
        }
        results.set(sessionName, activities);
      } catch (err) {
        logger.warn("Could not fetch activities for session", { sessionName, fetchPhase, error: err });
        results.set(sessionName, []);
      } finally {
        timeout.cancel();
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
