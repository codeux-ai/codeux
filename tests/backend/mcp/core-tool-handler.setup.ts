import { vi } from "vitest";
import type { JulesSession } from "../../../src/contracts/app-types.js";
import { ActivitySummaryService } from "../../../src/domain/sessions/activity-summary.js";

export const buildDeps = () => {
  const getSession = vi.fn();
  const listAllActivities = vi.fn();
  const fetchRecentActivities = vi.fn();
  const activitySummary = new ActivitySummaryService();

  const deps = {
    julesApi: {
      getSession,
      listAllActivities,
    } as any,
    activitySummary,
    normalizeName: (type: string, id: string) => `${type}/${id.replace(`${type}/`, "")}`,
    resolveSessionName: (session: Partial<JulesSession>) => session.name,
    fetchRecentActivities,
    isActionRequiredState: () => false,
    getConsecutiveFailures: () => 0,
    setConsecutiveFailures: vi.fn(),
    getMaxFailures: () => 5,
    isJulesApiConfigured: () => true,
    getMissingJulesApiKeyInstruction: () => "missing key",
    isTrackedCliSession: () => false,
    getTrackedSession: () => null,
    listTrackedSessions: () => ({ sessions: [] }),
    listTrackedActivities: () => ({ activities: [] }),
    listAllTrackedActivities: () => [],
    connectionChatRepository: {
      startListen: vi.fn().mockReturnValue({ connection: { id: "conn-1", connectionKey: "listener-1" }, inbox: [] }),
      pullInbox: vi.fn().mockReturnValue([]),
      postListenReply: vi.fn().mockReturnValue({ threadId: "thread-1", deliveryStatus: "processed" }),
    },
    workerTaskDispatchService: {
      pullNextDispatch: vi.fn().mockReturnValue(null),
      updateDispatch: vi.fn().mockReturnValue({ dispatch: { id: "dispatch-1", status: "completed" }, controlAction: null }),
    },
    workerSprintPreflightService: {
      pullNextJob: vi.fn().mockReturnValue(null),
      updateJob: vi.fn().mockReturnValue({ job: { id: "job-1", status: "completed" }, controlAction: null }),
    },
  };

  return { deps, getSession, listAllActivities, fetchRecentActivities };
};
