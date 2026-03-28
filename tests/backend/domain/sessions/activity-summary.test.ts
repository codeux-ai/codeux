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

    it("should correctly assign kinds for all flags", () => {
      expect(service.toActivitySummary({ sessionCompleted: {} } as any).kind).toBe("session_completed");
      expect(service.toActivitySummary({ sessionFailed: {} } as any).kind).toBe("session_failed");
      expect(service.toActivitySummary({ planApproved: {} } as any).kind).toBe("plan_approved");
      expect(service.toActivitySummary({ planGenerated: {} } as any).kind).toBe("plan_generated");
      expect(service.toActivitySummary({ userMessaged: { userMessage: "test" } } as any).kind).toBe("user_message");
      expect(service.toActivitySummary({ description: "test" } as any).kind).toBe("activity");
    });

    it("should fallback preview generation gracefully", () => {
      expect(service.toActivitySummary({ userMessaged: { userMessage: "test" } } as any).preview).toBe("test");
      expect(service.toActivitySummary({ description: "test" } as any).preview).toBe("test");
      expect(service.toActivitySummary({} as any).preview).toBeUndefined();
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

  describe("toActivityCollectionSummary", () => {
    it("should summarize activity collection", () => {
      const result = service.toActivityCollectionSummary("sessions/abc", [
        { createTime: "t1", sessionCompleted: {} } as any,
        { createTime: "t2", sessionFailed: {} } as any
      ]);
      expect(result.sessionId).toBe("abc");
      expect(result.totalActivities).toBe(2);
      expect(result.firstActivityTime).toBe("t1");
      expect(result.lastActivityTime).toBe("t2");
      expect(result.activityTypeCounts).toEqual({ "session_completed": 1, "session_failed": 1 });
      expect((result.recentActivities as any).length).toBe(2);
    });
  });

  describe("toActivityPageSummary", () => {
    it("should summarize activity page", () => {
      const result = service.toActivityPageSummary({
         sessionId: "sessions/abc",
         activities: [{ sessionCompleted: {} } as any],
         pageSize: 10,
         pageToken: "pt1",
         nextPageToken: "nt1"
      });
      expect(result.sessionId).toBe("abc");
      expect(result.returnedCount).toBe(1);
      expect(result.pageSize).toBe(10);
      expect(result.pageToken).toBe("pt1");
      expect(result.nextPageToken).toBe("nt1");
      expect(result.activityTypeCounts).toEqual({ "session_completed": 1 });
      expect((result.activities as any).length).toBe(1);
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

  describe("toSingleSourceSummary", () => {
    it("should handle null payload", () => {
      expect(service.toSingleSourceSummary(null, "fallback")).toEqual({ id: "sources/fallback", name: "sources/fallback" });
    });

    it("should handle valid payload with string id", () => {
      expect(service.toSingleSourceSummary({ id: "custom" }, "fallback")).toEqual({ id: "custom", name: "custom" });
      expect(service.toSingleSourceSummary({ id: "custom", name: "custom-name" }, "fallback")).toEqual({ id: "custom", name: "custom-name" });
    });

    it("should handle valid payload with implicit id from name", () => {
      expect(service.toSingleSourceSummary({ name: "sources/valid" }, "fallback")).toEqual({ id: "sources/valid", name: "sources/valid" });
    });
  });

  describe("toSourcePageSummary", () => {
    it("should summarize source page", () => {
       const result = service.toSourcePageSummary({
          sources: [{ id: "s1", name: "s1" } as any],
          nextPageToken: "npt",
          pageSize: 10,
          pageToken: "pt",
          filter: "f1"
       });
       expect(result.returnedCount).toBe(1);
       expect(result.filter).toBe("f1");
       expect(result.pageSize).toBe(10);
       expect(result.pageToken).toBe("pt");
       expect(result.nextPageToken).toBe("npt");
       expect((result.sources as any).length).toBe(1);
    });
  });

  describe("extractSourceListResponse", () => {
     it("should extract default values on empty input", () => {
        expect(service.extractSourceListResponse(null)).toEqual({ sources: [] });
     });

     it("should extract correctly", () => {
        expect(service.extractSourceListResponse({ sources: [{ id: "1" }], nextPageToken: "npt" })).toEqual({ sources: [{ id: "1" }], nextPageToken: "npt" });
     });
  });

  describe("toActionResponseSummary", () => {
    it("should summarize an action response", () => {
      const payload = {
        id: "sessions/abc",
        state: "RUNNING",
        message: "Action accepted",
        title: "Test title",
        updateTime: "2026",
        done: true,
        somethingElse: "hidden",
      };

      const summary = service.toActionResponseSummary(payload, "approve_plan");

      expect(summary).toEqual({
        action: "approve_plan",
        id: "sessions/abc",
        state: "RUNNING",
        message: "Action accepted",
        title: "Test title",
        updateTime: "2026",
        done: true,
      });
    });

    it("should fallback gracefully to action only", () => {
       expect(service.toActionResponseSummary(null, "action")).toEqual({ action: "action" });
    });
  });

  describe("getActivityRecentLimit", () => {
     it("returns correct value", () => {
        expect(service.getActivityRecentLimit()).toBe(10);
     });
  });
});
