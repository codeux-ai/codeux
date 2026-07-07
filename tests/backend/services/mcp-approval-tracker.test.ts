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

const createApprovalForPayload = (payload: Record<string, unknown>, message = "Requires approval.") => ({
  action: { domain: "settings", action: "patch_system_setting", payload },
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
    const result = tracker.takePending("req1", approval.action);

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
    expect(tracker.takePending("req-expected", approval.action)).toEqual(approval);
  });

  it("should clear pending approval after take", () => {
    const tracker = new McpApprovalTracker();
    tracker.setPending("req3", createApproval());

    expect(tracker.takePending("req3", createApproval().action)).not.toBeNull();
    expect(tracker.takePending("req3", createApproval().action)).toBeNull();
  });

  it("should reject duplicate approval attempts after the first take", () => {
    const tracker = new McpApprovalTracker();
    const approval = createApproval("Approve once.");
    tracker.setPending("req-duplicate", approval);

    expect(tracker.takePending("req-duplicate", approval.action)).toEqual(approval);
    expect(tracker.takePending("req-duplicate", approval.action)).toBeNull();
  });

  it("should expire pending approvals after five minutes", () => {
    vi.useFakeTimers();
    const tracker = new McpApprovalTracker();
    tracker.setPending("req-expired", createApproval());

    vi.advanceTimersByTime((5 * 60 * 1000) + 1);

    expect(tracker.takePending("req-expired", createApproval().action)).toBeNull();
  });

  it("should ignore malformed approval correlation ids without clearing valid state", () => {
    const tracker = new McpApprovalTracker();
    const approval = createApproval("Valid approval.");
    tracker.setPending("req-valid", approval);

    tracker.setPending("" as unknown as string, createApproval("Malformed approval."));
    tracker.setPending("../req-valid", createApproval("Path-like approval."));
    tracker.setPending("ghp_123456789012345678901234567890123456", createApproval("Token-shaped approval."));

    expect(tracker.takePending({ value: "req-valid" } as unknown as string)).toBeNull();
    expect(tracker.takePending(" " as unknown as string)).toBeNull();
    expect(tracker.takePending("../req-valid")).toBeNull();
    expect(tracker.takePending("ghp_123456789012345678901234567890123456")).toBeNull();
    expect(tracker.takePending("req-valid", approval.action)).toEqual(approval);
  });

  it("should reject mismatched token-like approval ids without consuming valid approvals", () => {
    const tracker = new McpApprovalTracker();
    const approval = createApproval("Valid approval.");
    tracker.setPending("mcp-42", approval);

    expect(tracker.takePending("mcp-42\nAuthorization: Bearer fixture-token")).toBeNull();
    expect(tracker.takePending("mcp-42/../other")).toBeNull();
    expect(tracker.takePending("mcp-42", approval.action)).toEqual(approval);
  });

  it("should overwrite previous pending with latest for same id and fingerprint", () => {
    const tracker = new McpApprovalTracker();
    const first = {
      action: { domain: "sprints", action: "delete", payload: { id: "s1" } },
      approvalMessage: "First",
      proposedAt: "2026-04-06T12:00:00Z",
    };
    const second = {
      action: { domain: "sprints", action: "delete", payload: { id: "s1" } },
      approvalMessage: "Second",
      proposedAt: "2026-04-06T12:01:00Z",
    };
    tracker.setPending("req4", first);
    tracker.setPending("req4", second);

    const result = tracker.takePending("req4", second.action);
    expect(result!.approvalMessage).toBe("Second");
    expect(result!.action.domain).toBe("sprints");
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

    const resultB = tracker.takePending("req-B", { domain: "projects", action: "delete", payload: { id: "p1" } });
    expect(resultB!.approvalMessage).toBe("Message B");

    const resultA = tracker.takePending("req-A", { domain: "sprints", action: "delete", payload: { id: "s1" } });
    expect(resultA!.approvalMessage).toBe("Message A");

    expect(tracker.takePending("req-A")).toBeNull();
    expect(tracker.takePending("req-B")).toBeNull();
  });

  it("rejects payload substitution without consuming the valid pending approval", () => {
    const tracker = new McpApprovalTracker();
    const approval = createApprovalForPayload({ path: "defaults.automationLevel", value: "SEMI_AUTO" });
    tracker.setPending("req-substitution", approval);

    expect(tracker.takePending("req-substitution", {
      domain: "settings",
      action: "patch_system_setting",
      payload: { path: "defaults.automationLevel", value: "MANUAL" },
    })).toBeNull();

    expect(tracker.takePending("req-substitution", approval.action)).toEqual(approval);
  });

  it("treats array order as meaningful in approval fingerprints", () => {
    const tracker = new McpApprovalTracker();
    const approval = createApprovalForPayload({ path: "agents.labels", value: ["review", "qa"] });
    tracker.setPending("req-array", approval);

    expect(tracker.takePending("req-array", {
      domain: "settings",
      action: "patch_system_setting",
      payload: { path: "agents.labels", value: ["qa", "review"] },
    })).toBeNull();

    expect(tracker.takePending("req-array", approval.action)).toEqual(approval);
  });

  it("distinguishes missing and null payload fields", () => {
    const tracker = new McpApprovalTracker();
    const approval = createApprovalForPayload({ projectId: "proj-1", path: "defaults.model", value: null });
    tracker.setPending("req-null", approval);

    expect(tracker.takePending("req-null", {
      domain: "settings",
      action: "patch_system_setting",
      payload: { projectId: "proj-1", path: "defaults.model" },
    })).toBeNull();

    expect(tracker.takePending("req-null", approval.action)).toEqual(approval);
  });

  it("does not choose between concurrent pending approvals on the same correlation id without an exact action", () => {
    const tracker = new McpApprovalTracker();
    const first = createApprovalForPayload({ path: "defaults.automationLevel", value: "SEMI_AUTO" }, "First");
    const second = createApprovalForPayload({ path: "defaults.automationLevel", value: "MANUAL" }, "Second");

    tracker.setPending("req-concurrent", first);
    tracker.setPending("req-concurrent", second);

    expect(tracker.takePending("req-concurrent")).toBeNull();
    expect(tracker.takePending("req-concurrent", second.action)).toEqual(second);
    expect(tracker.takePending("req-concurrent", first.action)).toEqual(first);
  });

  it("rejects overlong correlation ids without clearing valid pending approvals", () => {
    const tracker = new McpApprovalTracker();
    const approval = createApproval("Valid approval.");
    const overlongCorrelationId = `req-${"x".repeat(128)}`;

    tracker.setPending("req-valid-length", approval);
    tracker.setPending(overlongCorrelationId, createApproval("Overlong approval."));

    expect(tracker.takePending(overlongCorrelationId, approval.action)).toBeNull();
    expect(tracker.takePending("req-valid-length", approval.action)).toEqual(approval);
  });
});
