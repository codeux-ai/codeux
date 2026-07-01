import type { JulesActivity } from "../../../contracts/app-types.js";
import type { Logger } from "../../../shared/logging/logger.js";

export const fetchActivitiesBounded = async (
  sessionNames: string[],
  concurrency: number,
  pageSize: number,
  fetchRecentActivities: (sessionName: string, pageSize?: number) => Promise<JulesActivity[]>,
  logger: Logger
): Promise<Map<string, JulesActivity[]>> => {
  const results = new Map<string, JulesActivity[]>();
  let currentIndex = 0;

  const worker = async () => {
    while (currentIndex < sessionNames.length) {
      const index = currentIndex++;
      const sessionName = sessionNames[index];
      try {
        const activities = await fetchRecentActivities(sessionName, pageSize);
        results.set(sessionName, activities);
      } catch (err) {
        logger.warn("Could not fetch activities for session", { sessionName });
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
