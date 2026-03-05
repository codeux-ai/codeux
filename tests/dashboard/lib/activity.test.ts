import { describe, expect, it } from "vitest";
import { getActivityText } from "../../../dashboard/src/lib/activity.js";

describe("getActivityText", () => {
  it("prefers agent message", () => {
    expect(getActivityText({ id: "1", name: "a", createTime: "now", agentMessaged: { agentMessage: "hello" } })).toBe("hello");
  });

  it("handles user message", () => {
    expect(getActivityText({ id: "1", name: "a", createTime: "now", userMessaged: { userMessage: "hello" } })).toBe("hello");
  });

  it("handles progress updates", () => {
    expect(getActivityText({ id: "1", name: "a", createTime: "now", progressUpdated: { title: "Compiling" } })).toBe("Compiling");
  });

  it("handles progress updates fallback", () => {
    expect(getActivityText({ id: "1", name: "a", createTime: "now", progressUpdated: { description: "Compiling" } })).toBe("Compiling");
  });

  it("handles plan generated", () => {
    expect(getActivityText({ id: "1", name: "a", createTime: "now", planGenerated: { plan: { steps: [{ title: "step 1" }] } } })).toBe("Plan generated: step 1");
  });

  it("handles plan generated without title", () => {
    expect(getActivityText({ id: "1", name: "a", createTime: "now", planGenerated: { plan: { steps: [{ }] } } })).toBe("Plan generated");
  });

  it("handles plan approved", () => {
    expect(getActivityText({ id: "1", name: "a", createTime: "now", planApproved: { planId: "123" } })).toBe("Plan approved (123)");
  });

  it("handles session failed", () => {
    expect(getActivityText({ id: "1", name: "a", createTime: "now", sessionFailed: { reason: "error" } })).toBe("Session failed: error");
  });

  it("handles session completed", () => {
    expect(getActivityText({ id: "1", name: "a", createTime: "now", sessionCompleted: {} })).toBe("Session completed");
  });

  it("handles description", () => {
    expect(getActivityText({ id: "1", name: "a", createTime: "now", description: "desc" })).toBe("desc");
  });

  it("falls back for unknown shapes", () => {
    expect(getActivityText({ id: "1", name: "a", createTime: "now" })).toBe("System activity...");
  });

  it("returns fallback if undefined", () => {
    expect(getActivityText(undefined)).toBe("System activity...");
  });
});
