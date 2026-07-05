import { describe, expect, it } from "vitest";
import {
  mapSessionStateToTaskRunState,
  mapTaskRunStateToDispatchStatus,
  mapTaskRunStateToPlanningStatus,
  mergeDispatchStatus,
  resolveDispatchErrorMessage,
} from "../../../../../src/domain/sprint/session-sync/session-state-mapping.js";

const isActionRequiredState = (state?: string): boolean => {
  return state === "AWAITING_PLAN_APPROVAL" || state === "AWAITING_USER_FEEDBACK" || state === "PAUSED";
};

describe("session state mapping", () => {
  it("maps cancelled provider sessions to failed task runs and cancelled dispatches", () => {
    expect(mapSessionStateToTaskRunState("CANCELLED", isActionRequiredState)).toBe("FAILED");
    expect(mapTaskRunStateToDispatchStatus("FAILED", "CANCELLED")).toBe("cancelled");
    expect(resolveDispatchErrorMessage("stale error", "FAILED", "CANCELLED")).toBeNull();
  });

  it("maps quota and rate-limited provider sessions to quota task runs and dispatches", () => {
    expect(mapSessionStateToTaskRunState("QUOTA", isActionRequiredState)).toBe("QUOTA");
    expect(mapSessionStateToTaskRunState("RATE_LIMITED", isActionRequiredState)).toBe("QUOTA");
    expect(mapTaskRunStateToDispatchStatus("QUOTA", "QUOTA")).toBe("quota");
    expect(mapTaskRunStateToDispatchStatus("QUOTA", "RATE_LIMITED")).toBe("quota");
  });

  it("maps action-required states to blocked until a submitted user reply is pending", () => {
    expect(mapSessionStateToTaskRunState("AWAITING_USER_FEEDBACK", isActionRequiredState)).toBe("BLOCKED");
    expect(mapSessionStateToTaskRunState("AWAITING_USER_FEEDBACK", isActionRequiredState, true)).toBe("RUNNING");
    expect(mapTaskRunStateToDispatchStatus("BLOCKED", "AWAITING_USER_FEEDBACK")).toBe("blocked");
  });

  it("preserves cancel-requested dispatch status while the provider session is still running", () => {
    expect(mergeDispatchStatus("cancel_requested", "RUNNING", "RUNNING")).toBe("cancel_requested");
    expect(mergeDispatchStatus("cancel_requested", "COMPLETED", "COMPLETED")).toBe("completed");
  });

  it("resolves dispatch error messages for failed, blocked, quota, and healthy states", () => {
    expect(resolveDispatchErrorMessage(null, "FAILED", "FAILED")).toBe("Provider session FAILED");
    expect(resolveDispatchErrorMessage(null, "FAILED", undefined)).toBe("Provider session FAILED");
    expect(resolveDispatchErrorMessage(null, "BLOCKED", "AWAITING_PLAN_APPROVAL")).toBe(
      "Provider session requires attention: AWAITING_PLAN_APPROVAL",
    );
    expect(resolveDispatchErrorMessage("existing quota cooldown", "QUOTA", "QUOTA")).toBe("existing quota cooldown");
    expect(resolveDispatchErrorMessage(null, "QUOTA", undefined)).toBe("Provider session QUOTA");
    expect(resolveDispatchErrorMessage("old error", "RUNNING", "RUNNING")).toBeNull();
  });

  it("preserves existing planning status semantics", () => {
    expect(mapTaskRunStateToPlanningStatus("COMPLETED")).toBe("coding_completed");
    expect(mapTaskRunStateToPlanningStatus("RUNNING")).toBe("in_progress");
    expect(mapTaskRunStateToPlanningStatus("FAILED")).toBe("pending");
    expect(mapTaskRunStateToPlanningStatus("BLOCKED")).toBe("pending");
    expect(mapTaskRunStateToPlanningStatus("QUOTA")).toBe("pending");
  });
});
