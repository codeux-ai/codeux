import { afterEach, describe, it, expect, vi } from "vitest";
import { McpApprovalTracker } from "../../../src/services/mcp-approval-tracker.js";

afterEach(() => {
  vi.useRealTimers();
});

const createApproval = (message = "Requires approval.") => ({
  action: { domain: "sprints", action: "delete", payload: { sprintId: "s1" } },
  approvalMessage: message,
  proposedAt: "2026-04-06T12:00:00Z",
});

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

  it("should not return an approval for a mismatched correlation id", () => {
    const tracker = new McpApprovalTracker();
    const approval = createApproval();

    tracker.setPending("req-expected", approval);

    expect(tracker.takePending("req-other")).toBeNull();
    expect(tracker.takePending("req-expected")).toEqual(approval);
  });

  it("should clear pending approval after take", () => {
    const tracker = new McpApprovalTracker();
    tracker.setPending("req3", createApproval());

    expect(tracker.takePending("req3")).not.toBeNull();
    expect(tracker.takePending("req3")).toBeNull();
  });

  it("should reject duplicate approval attempts after the first take", () => {
    const tracker = new McpApprovalTracker();
    const approval = createApproval("Approve once.");
    tracker.setPending("req-duplicate", approval);

    expect(tracker.takePending("req-duplicate")).toEqual(approval);
    expect(tracker.takePending("req-duplicate")).toBeNull();
  });

  it("should expire pending approvals after five minutes", () => {
    vi.useFakeTimers();
    const tracker = new McpApprovalTracker();
    tracker.setPending("req-expired", createApproval());

    vi.advanceTimersByTime((5 * 60 * 1000) + 1);

    expect(tracker.takePending("req-expired")).toBeNull();
  });

  it("should ignore malformed approval correlation ids without clearing valid state", () => {
    const tracker = new McpApprovalTracker();
    const approval = createApproval("Valid approval.");
    tracker.setPending("req-valid", approval);

    tracker.setPending("" as unknown as string, createApproval("Malformed approval."));

    expect(tracker.takePending({ value: "req-valid" } as unknown as string)).toBeNull();
    expect(tracker.takePending(" " as unknown as string)).toBeNull();
    expect(tracker.takePending("req-valid")).toEqual(approval);
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
