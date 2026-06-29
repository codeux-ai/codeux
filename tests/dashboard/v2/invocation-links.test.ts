import { describe, it, expect } from "vitest";
import { buildInvocationLinks } from "../../../dashboard/src/v2/components/chat/invocation-display.js";

describe("buildInvocationLinks", () => {
  it("formats the sprint key with the project's configured prefix", () => {
    const links = buildInvocationLinks(
      { sprintId: "s-1", sprintNumber: 28, taskId: null },
      "CODUX",
    );
    expect(links.sprintKey).toBe("CODUX-28");
    expect(links.sprintHref).toBe("/sprints?sprintKey=CODUX-28");
  });

  it("does not hard-code the default SPR prefix", () => {
    const links = buildInvocationLinks(
      { sprintId: "s-1", sprintNumber: 31, taskId: null },
      "ACME",
    );
    expect(links.sprintKey).toBe("ACME-31");
    expect(links.sprintKey).not.toContain("SPR");
  });

  it("returns null sprint links when there is no sprint number", () => {
    const links = buildInvocationLinks(
      { sprintId: "s-1", sprintNumber: null, taskId: "t-1" },
      "CODUX",
    );
    expect(links.sprintKey).toBeNull();
    expect(links.sprintHref).toBeNull();
    expect(links.taskHref).toBe("/tasks?sprintId=s-1&taskId=t-1");
  });
});
