import { describe, expect, it } from "vitest";
import {
  resolveMainMergeCardCiStatus,
  resolveSprintCardCiStatus,
  resolveTaskCardCiStatus,
} from "../../../../src/domain/sprint/card-ci-status.js";

const gateEvent = (payload: unknown, createdAt = "2026-07-13T10:00:00.000Z") => ({ createdAt, payload });

describe("card CI status", () => {
  it("treats a durable task CI indicator without newer detail as pending", () => {
    expect(resolveTaskCardCiStatus({ mergeIndicator: "CI" })).toBe("pending");
    expect(resolveTaskCardCiStatus({
      mergeIndicator: "CI",
      latestGateEvent: gateEvent({ state: "waiting_for_pr" }),
    })).toBe("pending");
  });

  it("maps persisted waiting checks to running", () => {
    expect(resolveTaskCardCiStatus({
      mergeIndicator: "CI",
      latestGateEvent: gateEvent({ state: "waiting_checks", hasPendingChecks: true }),
    })).toBe("running");
  });

  it("gives task failures precedence over pending or running evidence", () => {
    expect(resolveTaskCardCiStatus({
      mergeIndicator: "CI",
      latestGateEvent: gateEvent({ state: "waiting_checks", hasFailedChecks: true }),
    })).toBe("failed");
    expect(resolveTaskCardCiStatus({
      mergeIndicator: "CI",
      latestGateEvent: gateEvent({ state: "blocked" }),
    })).toBe("failed");
    expect(resolveTaskCardCiStatus({ mergeIndicator: "CI", hasActiveFailure: true })).toBe("failed");
  });

  it("uses failure-before-running-before-pending sprint precedence", () => {
    expect(resolveSprintCardCiStatus({
      taskStatuses: ["pending", "failed", "running"],
      latestMainMergeGateEvent: gateEvent({ state: "pending_checks" }),
    })).toBe("failed");
    expect(resolveSprintCardCiStatus({ taskStatuses: ["pending", "running"] })).toBe("running");
    expect(resolveSprintCardCiStatus({ taskStatuses: ["pending"] })).toBe("pending");
  });

  it("keeps actual main-merge check failures failed", () => {
    expect(resolveMainMergeCardCiStatus(gateEvent({ state: "failed_checks", hasFailedChecks: false }))).toBe("failed");
    expect(resolveMainMergeCardCiStatus(gateEvent({ state: "ready_for_merge", hasFailedChecks: true }))).toBe("failed");
    expect(resolveMainMergeCardCiStatus(gateEvent({ state: "review_blocked", hasFailedChecks: true }))).toBe("failed");
  });

  it("does not present review-only main-merge blockers as failed CI", () => {
    const reviewBlocked = gateEvent({ state: "review_blocked", hasFailedChecks: false });

    expect(resolveMainMergeCardCiStatus(reviewBlocked)).toBeNull();
    expect(resolveMainMergeCardCiStatus(reviewBlocked, true)).toBe("failed");
  });

  it("maps main-merge pending checks without retaining settled history", () => {
    expect(resolveMainMergeCardCiStatus(gateEvent({ state: "pending_checks", hasPendingChecks: true }))).toBe("running");
    expect(resolveMainMergeCardCiStatus(gateEvent({ state: "missing_pr" }))).toBe("pending");
    expect(resolveMainMergeCardCiStatus(gateEvent({ state: "merged" }))).toBeNull();
  });

  it("ignores malformed payloads and clears task CI after a settlement detail", () => {
    expect(resolveTaskCardCiStatus({
      mergeIndicator: "CI",
      latestGateEvent: gateEvent("not-an-object"),
    })).toBe("pending");
    expect(resolveMainMergeCardCiStatus(gateEvent(["not", "an", "object"]))).toBeNull();
    expect(resolveTaskCardCiStatus({
      mergeIndicator: "CI",
      latestGateEvent: gateEvent({ state: "merge_confirmed" }),
    })).toBeNull();
    expect(resolveTaskCardCiStatus({
      status: "completed",
      mergeIndicator: "MERGED",
      latestGateEvent: gateEvent({ state: "waiting_checks", hasPendingChecks: true }),
    })).toBeNull();
    expect(resolveTaskCardCiStatus({
      status: "coding_completed",
      mergeIndicator: null,
      latestGateEvent: gateEvent({ state: "waiting_checks", hasPendingChecks: true }),
    })).toBeNull();
  });
});
