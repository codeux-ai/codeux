import { describe, expect, it } from "vitest";
import { ActivitySummaryService } from "../../../../src/domain/sessions/activity-summary.js";
import type { JulesActivity, JulesSession, JulesSource } from "../../../../src/contracts/app-types.js";

describe("ActivitySummaryService", () => {
  const service = new ActivitySummaryService();

  describe("toActivitySummary", () => {
    it("should correctly summarize an agent message activity", () => {
      const activity: JulesActivity = {
        id: "activities/1",
        name: "sessions/abc/activities/1",
        createTime: "2026-02-26T21:00:00.000Z",
        originator: "agent",
        agentMessaged: { agentMessage: "Hello world" },
      };

      const summary = service.toActivitySummary(activity);

      expect(summary).toEqual({
        id: "activities/1",
        name: "sessions/abc/activities/1",
        createTime: "2026-02-26T21:00:00.000Z",
        originator: "agent",
        kind: "agent_message",
        preview: "Hello world",
      });
    });

    it("should correctly summarize a progress updated activity", () => {
      const activity: JulesActivity = {
        id: "activities/2",
        name: "sessions/abc/activities/2",
        createTime: "2026-02-26T21:05:00.000Z",
        originator: "agent",
        progressUpdated: { title: "Step 1", description: "Doing things" },
      };

      const summary = service.toActivitySummary(activity);

      expect(summary).toEqual({
        id: "activities/2",
        name: "sessions/abc/activities/2",
        createTime: "2026-02-26T21:05:00.000Z",
        originator: "agent",
        kind: "progress_updated",
        preview: "Step 1 - Doing things",
      });
    });

    it("should truncate long previews", () => {
      const longMessage = "a".repeat(200);
      const activity: JulesActivity = {
        id: "activities/3",
        name: "sessions/abc/activities/3",
        createTime: "2026-02-26T21:10:00.000Z",
        agentMessaged: { agentMessage: longMessage },
      };

      const summary = service.toActivitySummary(activity);

      expect((summary.preview as string).length).toBe(180);
      expect((summary.preview as string).endsWith("…")).toBe(true);
    });
  });

  describe("toSessionSummary", () => {
    it("should correctly summarize a session", () => {
      const session: JulesSession = {
        id: "sessions/abc",
        name: "sessions/abc",
        title: "Test Session",
        state: "RUNNING",
        provider: "jules",
        prompt: "original prompt",
        createTime: "2026-02-26T21:00:00.000Z",
        outputs: [{ pullRequest: { url: "https://github.com/example/repo/pull/1", workerBranch: "feature/test" } }],
      };

      const summary = service.toSessionSummary(session);

      expect(summary).toEqual({
        id: "sessions/abc",
        name: "sessions/abc",
        title: "Test Session",
        state: "RUNNING",
        provider: "jules",
        createTime: "2026-02-26T21:00:00.000Z",
        hasPullRequest: true,
        pullRequests: [{ url: "https://github.com/example/repo/pull/1", workerBranch: "feature/test" }],
      });
    });

    it("should correctly summarize a session with empty outputs", () => {
      const session: JulesSession = {
        id: "sessions/abc",
        name: "sessions/abc",
        title: "Test Session",
        state: "RUNNING",
        provider: "jules",
        prompt: "original prompt",
        createTime: "2026-02-26T21:00:00.000Z",
        outputs: [],
      };

      const summary = service.toSessionSummary(session);

      expect(summary).toEqual({
        id: "sessions/abc",
        name: "sessions/abc",
        title: "Test Session",
        state: "RUNNING",
        provider: "jules",
        createTime: "2026-02-26T21:00:00.000Z",
        hasPullRequest: false,
        pullRequests: [],
      });
    });

    it("should include last activity when provided", () => {
      const session: JulesSession = {
        id: "sessions/abc",
        name: "sessions/abc",
        prompt: "prompt",
      };
      const activity: JulesActivity = {
        id: "activities/1",
        name: "sessions/abc/activities/1",
        createTime: "2026-02-26T21:00:00.000Z",
        agentMessaged: { agentMessage: "last activity" },
      };

      const summary = service.toSessionSummary(session, activity);

      expect(summary.lastActivity).toBeDefined();
      expect((summary.lastActivity as any).preview).toBe("last activity");
    });
  });

  describe("toSourceSummary", () => {
    it("should summarize a source", () => {
      const source: JulesSource = {
        id: "sources/123",
        name: "sources/123",
        somethingElse: "hidden",
      };

      const summary = service.toSourceSummary(source);

      expect(summary).toEqual({
        id: "sources/123",
        name: "sources/123",
      });
    });
  });

  describe("toActionResponseSummary", () => {
    it("should summarize an action response", () => {
      const payload = {
        id: "sessions/abc",
        state: "RUNNING",
        message: "Action accepted",
        somethingElse: "hidden",
      };

      const summary = service.toActionResponseSummary(payload, "approve_plan");

      expect(summary).toEqual({
        action: "approve_plan",
        id: "sessions/abc",
        state: "RUNNING",
        message: "Action accepted",
      });
    });

    it("returns only the action when payload is not an object", () => {
      expect(service.toActionResponseSummary(null, "cancel")).toEqual({ action: "cancel" });
      expect(service.toActionResponseSummary("nope", "cancel")).toEqual({ action: "cancel" });
    });
  });

  describe("getActivityKind via toActivitySummary", () => {
    const base = { id: "a", name: "sessions/x/activities/a", createTime: "2026-01-01T00:00:00.000Z" };
    const cases: Array<[Partial<JulesActivity>, string]> = [
      [{ sessionCompleted: {} as never }, "session_completed"],
      [{ sessionFailed: {} as never }, "session_failed"],
      [{ planApproved: {} as never }, "plan_approved"],
      [{ planGenerated: {} as never }, "plan_generated"],
      [{ userMessaged: { userMessage: "hi" } }, "user_message"],
      [{}, "activity"],
    ];
    it.each(cases)("classifies %o as %s", (partial, expectedKind) => {
      const summary = service.toActivitySummary({ ...base, ...partial } as JulesActivity);
      expect(summary.kind).toBe(expectedKind);
    });

    it("defaults originator to system when missing", () => {
      const summary = service.toActivitySummary({ ...base } as JulesActivity);
      expect(summary.originator).toBe("system");
    });
  });

  describe("getActivityPreview fallbacks", () => {
    const base = { id: "a", name: "sessions/x/activities/a", createTime: "2026-01-01T00:00:00.000Z" };

    it("uses the user message when no progress/agent message is present", () => {
      const summary = service.toActivitySummary({ ...base, userMessaged: { userMessage: "  user text  " } } as JulesActivity);
      expect(summary.preview).toBe("user text");
    });

    it("falls back to the description field", () => {
      const summary = service.toActivitySummary({ ...base, description: "  a description  " } as JulesActivity);
      expect(summary.preview).toBe("a description");
    });

    it("omits the preview entirely when nothing is available", () => {
      const summary = service.toActivitySummary({ ...base } as JulesActivity);
      expect(summary.preview).toBeUndefined();
    });
  });

  describe("toActivityCollectionSummary", () => {
    it("counts activity kinds, caps recent activities, and strips the sessions/ prefix", () => {
      const activities: JulesActivity[] = Array.from({ length: 12 }, (_, i) => ({
        id: `activities/${i}`,
        name: `sessions/abc/activities/${i}`,
        createTime: `2026-01-01T00:00:${String(i).padStart(2, "0")}.000Z`,
        agentMessaged: { agentMessage: `msg ${i}` },
      }));

      const summary = service.toActivityCollectionSummary("sessions/abc", activities);

      expect(summary.sessionId).toBe("abc");
      expect(summary.totalActivities).toBe(12);
      expect(summary.firstActivityTime).toBe("2026-01-01T00:00:00.000Z");
      expect(summary.lastActivityTime).toBe("2026-01-01T00:00:11.000Z");
      expect(summary.activityTypeCounts).toEqual({ agent_message: 12 });
      expect((summary.recentActivities as unknown[]).length).toBe(service.getActivityRecentLimit());
    });

    it("handles an empty activity list with null timestamps", () => {
      const summary = service.toActivityCollectionSummary("abc", []);
      expect(summary.totalActivities).toBe(0);
      expect(summary.firstActivityTime).toBeNull();
      expect(summary.lastActivityTime).toBeNull();
    });
  });

  describe("toActivityPageSummary", () => {
    it("returns paging metadata with defaults applied", () => {
      const activities: JulesActivity[] = [
        { id: "a1", name: "sessions/abc/activities/a1", createTime: "t", agentMessaged: { agentMessage: "x" } },
      ];

      const summary = service.toActivityPageSummary({ sessionId: "sessions/abc", activities });
      expect(summary).toMatchObject({
        sessionId: "abc",
        returnedCount: 1,
        pageSize: null,
        pageToken: null,
        nextPageToken: null,
        activityTypeCounts: { agent_message: 1 },
      });
    });

    it("preserves explicit paging arguments", () => {
      const summary = service.toActivityPageSummary({
        sessionId: "sessions/abc",
        activities: [],
        pageSize: 25,
        pageToken: "p1",
        nextPageToken: "p2",
      });
      expect(summary).toMatchObject({ pageSize: 25, pageToken: "p1", nextPageToken: "p2", returnedCount: 0 });
    });
  });

  describe("toSingleSourceSummary", () => {
    it("normalizes a bare fallback id when payload is not an object", () => {
      expect(service.toSingleSourceSummary(null, "123")).toEqual({ id: "sources/123", name: "sources/123" });
      expect(service.toSingleSourceSummary(null, "sources/123")).toEqual({ id: "sources/123", name: "sources/123" });
    });

    it("prefers the record id when present", () => {
      expect(service.toSingleSourceSummary({ id: "sources/9", name: "repo" }, "fallback")).toEqual({
        id: "sources/9",
        name: "repo",
      });
    });

    it("uses the record name as id when it looks like a source path", () => {
      expect(service.toSingleSourceSummary({ name: "sources/42" }, "fallback")).toEqual({
        id: "sources/42",
        name: "sources/42",
      });
    });

    it("falls back to the normalized fallback id when neither id nor source-name is usable", () => {
      expect(service.toSingleSourceSummary({ description: "x" }, "abc")).toEqual({
        id: "sources/abc",
        name: "sources/abc",
      });
    });
  });

  describe("toSourcePageSummary", () => {
    it("summarizes sources with filter and paging metadata", () => {
      const sources: JulesSource[] = [{ id: "sources/1", name: "sources/1" }];
      const summary = service.toSourcePageSummary({ sources, filter: "repo", pageSize: 10, pageToken: "p", nextPageToken: "n" });
      expect(summary).toEqual({
        returnedCount: 1,
        filter: "repo",
        pageSize: 10,
        pageToken: "p",
        nextPageToken: "n",
        sources: [{ id: "sources/1", name: "sources/1" }],
      });
    });

    it("defaults optional fields to null", () => {
      const summary = service.toSourcePageSummary({ sources: [] });
      expect(summary).toMatchObject({ filter: null, pageSize: null, pageToken: null, nextPageToken: null });
    });
  });

  describe("extractSourceListResponse", () => {
    it("returns an empty list for non-object payloads", () => {
      expect(service.extractSourceListResponse(null)).toEqual({ sources: [] });
      expect(service.extractSourceListResponse("nope")).toEqual({ sources: [] });
    });

    it("extracts sources and the next page token", () => {
      const result = service.extractSourceListResponse({
        sources: [{ id: "sources/1", name: "sources/1" }],
        nextPageToken: "next",
      });
      expect(result.sources).toHaveLength(1);
      expect(result.nextPageToken).toBe("next");
    });

    it("ignores a non-array sources field and a non-string token", () => {
      const result = service.extractSourceListResponse({ sources: "bad", nextPageToken: 5 });
      expect(result.sources).toEqual([]);
      expect(result.nextPageToken).toBeUndefined();
    });
  });
});
