import { describe, it, expect } from "vitest";
import { McpApprovalTracker } from "../../../src/services/mcp-approval-tracker.js";

describe("McpApprovalTracker", () => {
  it("should store and retrieve a pending approval", () => {
    const tracker = new McpApprovalTracker();
    const approval = {
      action: { domain: "sprints", action: "delete", payload: { sprintId: "s1" } },
      approvalMessage: "Delete sprint requires approval.",
      proposedAt: "2026-04-06T12:00:00Z",
    };

    tracker.setPending(approval);
    const result = tracker.takePending();

    expect(result).toEqual(approval);
  });

  it("should return null when no pending approval exists", () => {
    const tracker = new McpApprovalTracker();
    expect(tracker.takePending()).toBeNull();
  });

  it("should clear pending approval after take", () => {
    const tracker = new McpApprovalTracker();
    tracker.setPending({
      action: { domain: "projects", action: "delete", payload: { id: "p1" } },
      approvalMessage: "Requires approval.",
      proposedAt: "2026-04-06T12:00:00Z",
    });

    expect(tracker.takePending()).not.toBeNull();
    expect(tracker.takePending()).toBeNull();
  });

  it("should overwrite previous pending with latest", () => {
    const tracker = new McpApprovalTracker();
    tracker.setPending({
      action: { domain: "sprints", action: "delete", payload: { id: "s1" } },
      approvalMessage: "First",
      proposedAt: "2026-04-06T12:00:00Z",
    });
    tracker.setPending({
      action: { domain: "projects", action: "delete", payload: { id: "p1" } },
      approvalMessage: "Second",
      proposedAt: "2026-04-06T12:01:00Z",
    });

    const result = tracker.takePending();
    expect(result!.approvalMessage).toBe("Second");
    expect(result!.action.domain).toBe("projects");
  });
});
