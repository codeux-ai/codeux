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
        outputs: [{ pullRequest: { url: "https://github.com/example/repo/pull/1" } }],
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
        pullRequests: [{ url: "https://github.com/example/repo/pull/1" }],
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
  });
});
