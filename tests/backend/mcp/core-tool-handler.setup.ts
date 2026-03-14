import { vi } from "vitest";
import type { JulesSession } from "../../../src/contracts/app-types.js";
import { ActivitySummaryService } from "../../../src/domain/sessions/activity-summary.js";

export const buildDeps = () => {
  const getSession = vi.fn();
  const fetchRecentActivities = vi.fn();
  const activitySummary = new ActivitySummaryService();

  const deps = {
    julesApi: {
      getSession,
    } as any,
    activitySummary,
    normalizeName: (type: string, id: string) => `${type}/${id.replace(`${type}/`, "")}`,
    resolveSessionName: (session: Partial<JulesSession>) => session.name,
    fetchRecentActivities,
    isJulesApiConfigured: () => true,
    getMissingJulesApiKeyInstruction: () => "missing key",
    isTrackedCliSession: () => false,
    getTrackedSession: () => null,
  };

  return { deps, getSession, fetchRecentActivities };
};
