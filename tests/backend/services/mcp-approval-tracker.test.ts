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

    tracker.setPending("req1", approval);
    const result = tracker.takePending("req1");

    expect(result).toEqual(approval);
  });

  it("should return null when no pending approval exists", () => {
    const tracker = new McpApprovalTracker();
    expect(tracker.takePending("req2")).toBeNull();
  });

  it("should clear pending approval after take", () => {
    const tracker = new McpApprovalTracker();
    tracker.setPending("req3", {
      action: { domain: "projects", action: "delete", payload: { id: "p1" } },
      approvalMessage: "Requires approval.",
      proposedAt: "2026-04-06T12:00:00Z",
    });

    expect(tracker.takePending("req3")).not.toBeNull();
    expect(tracker.takePending("req3")).toBeNull();
  });

  it("should overwrite previous pending with latest for same id", () => {
    const tracker = new McpApprovalTracker();
    tracker.setPending("req4", {
      action: { domain: "sprints", action: "delete", payload: { id: "s1" } },
      approvalMessage: "First",
      proposedAt: "2026-04-06T12:00:00Z",
    });
    tracker.setPending("req4", {
      action: { domain: "projects", action: "delete", payload: { id: "p1" } },
      approvalMessage: "Second",
      proposedAt: "2026-04-06T12:01:00Z",
    });

    const result = tracker.takePending("req4");
    expect(result!.approvalMessage).toBe("Second");
    expect(result!.action.domain).toBe("projects");
  });

  it("should handle concurrent approval requests and resolve deterministically", () => {
    const tracker = new McpApprovalTracker();

    tracker.setPending("req-A", {
      action: { domain: "sprints", action: "delete", payload: { id: "s1" } },
      approvalMessage: "Message A",
      proposedAt: "2026-04-06T12:00:00Z",
    });

    tracker.setPending("req-B", {
      action: { domain: "projects", action: "delete", payload: { id: "p1" } },
      approvalMessage: "Message B",
      proposedAt: "2026-04-06T12:01:00Z",
    });

    const resultB = tracker.takePending("req-B");
    expect(resultB!.approvalMessage).toBe("Message B");

    const resultA = tracker.takePending("req-A");
    expect(resultA!.approvalMessage).toBe("Message A");

    expect(tracker.takePending("req-A")).toBeNull();
    expect(tracker.takePending("req-B")).toBeNull();
  });
});
