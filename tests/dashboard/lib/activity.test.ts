import { describe, expect, it } from "vitest";
import { getActivityText } from "../../../dashboard/src/lib/activity.js";

describe("getActivityText", () => {
  it("prefers agent message", () => {
    expect(getActivityText({ id: "1", name: "a", createTime: "now", agentMessaged: { agentMessage: "hello" } })).toBe("hello");
  });

  it("handles progress updates", () => {
    expect(getActivityText({ id: "1", name: "a", createTime: "now", progressUpdated: { title: "Compiling" } })).toBe("Compiling");
  });

  it("falls back for unknown shapes", () => {
    expect(getActivityText({ id: "1", name: "a", createTime: "now" })).toBe("System activity...");
  });
});
