import { describe, expect, it, vi } from "vitest";
import type { JulesActivity, JulesSession } from "../../../src/contracts/app-types.js";
import { CoreToolHandler } from "../../../src/mcp/core-tool-handler.js";
import { ActivitySummaryService } from "../../../src/domain/sessions/activity-summary.js";

const buildDeps = () => {
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
  };

  return { deps, getSession, listAllActivities, fetchRecentActivities };
};

describe("CoreToolHandler compact responses", () => {
  it("returns a compact get_session payload", async () => {
    const { deps, getSession, fetchRecentActivities } = buildDeps();
    const handler = new CoreToolHandler(deps as any);

    getSession.mockResolvedValue({
      id: "sessions/abc",
      name: "sessions/abc",
      title: "Large session",
      prompt: "very large prompt that should not be returned",
      state: "RUNNING",
      provider: "jules",
      createTime: "2026-02-26T21:00:00.000Z",
      outputs: [{ pullRequest: { url: "https://github.com/example/repo/pull/1" } }],
    } satisfies JulesSession);
    fetchRecentActivities.mockResolvedValue([
      {
        id: "activities/1",
        name: "sessions/abc/activities/1",
        createTime: "2026-02-26T21:10:00.000Z",
        originator: "agent",
        agentMessaged: { agentMessage: "done" },
      } satisfies JulesActivity,
    ]);

    const response = await handler.handleGetSession({ session_id: "abc" });
    const parsed = JSON.parse(response.content[0].text as string);

    expect(parsed.id).toBe("sessions/abc");
    expect(parsed.hasPullRequest).toBe(true);
    expect(parsed.pullRequests).toEqual([{ url: "https://github.com/example/repo/pull/1" }]);
    expect(parsed.lastActivity.kind).toBe("agent_message");
    expect(parsed.prompt).toBeUndefined();
  });

  it("returns compact list_all_activities payload with recent preview only", async () => {
    const { deps, listAllActivities } = buildDeps();
    const handler = new CoreToolHandler(deps as any);

    const activities: JulesActivity[] = Array.from({ length: 15 }, (_, index) => ({
      id: `activities/${index + 1}`,
      name: `sessions/abc/activities/${index + 1}`,
      createTime: `2026-02-26T21:${String(index).padStart(2, "0")}:00.000Z`,
      originator: "agent",
      progressUpdated: { title: `step-${index + 1}` },
    }));
    listAllActivities.mockResolvedValue(activities);

    const response = await handler.handleListAllActivities({ session_id: "abc" });
    const parsed = JSON.parse(response.content[0].text as string);

    expect(parsed.totalActivities).toBe(15);
    expect(parsed.recentActivities).toHaveLength(10);
    expect(parsed.recentActivities[0].id).toBe("activities/6");
    expect(parsed.activityTypeCounts.progress_updated).toBe(15);
    expect(parsed.activities).toBeUndefined();
  });

  it("returns compact list_activities and list_sessions payloads", async () => {
    const { deps, listAllActivities } = buildDeps();
    const handler = new CoreToolHandler(deps as any);
    const listActivities = vi.fn();
    const listSessions = vi.fn();
    deps.julesApi.listActivities = listActivities;
    deps.julesApi.listSessions = listSessions;

    listActivities.mockResolvedValue({
      activities: [
        {
          id: "activities/1",
          name: "sessions/abc/activities/1",
          createTime: "2026-02-26T21:00:00.000Z",
          originator: "agent",
          agentMessaged: { agentMessage: "long output..." },
        },
      ],
      nextPageToken: "next-token",
    });
    listSessions.mockResolvedValue({
      sessions: [
        {
          id: "sessions/abc",
          name: "sessions/abc",
          title: "A session",
          state: "RUNNING",
          provider: "jules",
          outputs: [{ pullRequest: { url: "https://example.com/pr/1" } }],
          prompt: "large prompt",
        },
      ],
      nextPageToken: "next-session-token",
    });

    const activitiesResponse = await handler.handleListActivities({ session_id: "abc", page_size: 20 });
    const sessionsResponse = await handler.handleListSessions({ page_size: 20 });
    const activitiesParsed = JSON.parse(activitiesResponse.content[0].text as string);
    const sessionsParsed = JSON.parse(sessionsResponse.content[0].text as string);

    expect(activitiesParsed.returnedCount).toBe(1);
    expect(activitiesParsed.activities[0].kind).toBe("agent_message");
    expect(activitiesParsed.activities[0].preview).toBe("long output...");
    expect(activitiesParsed.activities[0].agentMessaged).toBeUndefined();
    expect(activitiesParsed.nextPageToken).toBe("next-token");

    expect(sessionsParsed.returnedCount).toBe(1);
    expect(sessionsParsed.sessions[0].hasPullRequest).toBe(true);
    expect(sessionsParsed.sessions[0].pullRequests).toEqual([{ url: "https://example.com/pr/1" }]);
    expect(sessionsParsed.sessions[0].prompt).toBeUndefined();
    expect(sessionsParsed.nextPageToken).toBe("next-session-token");
    expect(listAllActivities).not.toHaveBeenCalled();
  });

  it("returns compact list_sources and list_all_sources payloads", async () => {
    const { deps } = buildDeps();
    const handler = new CoreToolHandler(deps as any);
    const listSources = vi.fn();
    const listAllSources = vi.fn();
    deps.julesApi.listSources = listSources;
    deps.julesApi.listAllSources = listAllSources;

    listSources.mockResolvedValue({
      sources: [
        {
          id: "sources/1",
          name: "sources/1",
          gigantic: { nested: { payload: "x".repeat(2000) } },
        },
      ],
      nextPageToken: "next-source-token",
    });
    listAllSources.mockResolvedValue([
      {
        id: "sources/2",
        name: "sources/2",
        gigantic: { nested: { payload: "y".repeat(2000) } },
      },
    ]);

    const listSourcesResponse = await handler.handleListSources({ page_size: 10, filter: "state:ACTIVE" });
    const listAllSourcesResponse = await handler.handleListAllSources({ filter: "state:ACTIVE" });
    const listSourcesParsed = JSON.parse(listSourcesResponse.content[0].text as string);
    const listAllSourcesParsed = JSON.parse(listAllSourcesResponse.content[0].text as string);

    expect(listSourcesParsed.returnedCount).toBe(1);
    expect(listSourcesParsed.sources[0]).toEqual({ id: "sources/1", name: "sources/1" });
    expect(listSourcesParsed.sources[0].gigantic).toBeUndefined();
    expect(listSourcesParsed.nextPageToken).toBe("next-source-token");

    expect(listAllSourcesParsed.returnedCount).toBe(1);
    expect(listAllSourcesParsed.sources[0]).toEqual({ id: "sources/2", name: "sources/2" });
    expect(listAllSourcesParsed.sources[0].gigantic).toBeUndefined();
  });

  it("returns compact get_source, create_session, and action responses", async () => {
    const { deps } = buildDeps();
    const handler = new CoreToolHandler(deps as any);
    const getSource = vi.fn();
    const createSession = vi.fn();
    const approveSessionPlan = vi.fn();
    const sendSessionMessage = vi.fn();
    deps.julesApi.getSource = getSource;
    deps.julesApi.createSession = createSession;
    deps.julesApi.approveSessionPlan = approveSessionPlan;
    deps.julesApi.sendSessionMessage = sendSessionMessage;

    getSource.mockResolvedValue({
      id: "sources/123",
      name: "sources/123",
      huge: { payload: "x".repeat(2000) },
    });
    createSession.mockResolvedValue({
      id: "sessions/new",
      name: "sessions/new",
      title: "New session",
      state: "RUNNING",
      provider: "jules",
      prompt: "very large prompt",
      outputs: [{ pullRequest: { url: "https://example.com/pr/new" } }],
    });
    approveSessionPlan.mockResolvedValue({
      id: "sessions/new",
      state: "RUNNING",
      huge: { payload: "x".repeat(2000) },
    });
    sendSessionMessage.mockResolvedValue({
      id: "sessions/new",
      state: "RUNNING",
      message: "ok",
      huge: { payload: "x".repeat(2000) },
    });

    const sourceResponse = await handler.handleGetSource({ source_id: "123" });
    const createResponse = await handler.handleCreateSession({ prompt: "run", source: "123" });
    const approveResponse = await handler.handleApproveSessionPlan({ session_id: "new" });
    const messageResponse = await handler.handleSendSessionMessage({ session_id: "new", prompt: "continue" });

    const sourceParsed = JSON.parse(sourceResponse.content[0].text as string);
    const createParsed = JSON.parse(createResponse.content[0].text as string);
    const approveParsed = JSON.parse(approveResponse.content[0].text as string);
    const messageParsed = JSON.parse(messageResponse.content[0].text as string);

    expect(sourceParsed).toEqual({ id: "sources/123", name: "sources/123" });
    expect(sourceParsed.huge).toBeUndefined();

    expect(createParsed.id).toBe("sessions/new");
    expect(createParsed.hasPullRequest).toBe(true);
    expect(createParsed.prompt).toBeUndefined();

    expect(approveParsed.action).toBe("approve_session_plan");
    expect(approveParsed.id).toBe("sessions/new");
    expect(approveParsed.huge).toBeUndefined();

    expect(messageParsed.action).toBe("send_session_message");
    expect(messageParsed.message).toBe("ok");
    expect(messageParsed.huge).toBeUndefined();
  });
});
