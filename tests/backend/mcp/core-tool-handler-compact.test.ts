import { describe, expect, it } from "vitest";
import type { JulesActivity, JulesSession } from "../../../src/contracts/app-types.js";
import { CoreToolHandler } from "../../../src/mcp/core-tool-handler.js";
import { buildDeps } from "./core-tool-handler.setup.js";

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
      outputs: [{ pullRequest: { url: "https://github.com/example/repo/pull/1", workerBranch: "feature/1" } }],
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
    expect(parsed.pullRequests).toEqual([{ url: "https://github.com/example/repo/pull/1", workerBranch: "feature/1" }]);
    expect(parsed.lastActivity.kind).toBe("agent_message");
    expect(parsed.prompt).toBeUndefined();
  });
});
