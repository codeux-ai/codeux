import { describe, expect, test } from "vitest";
import { resolveTaskDropStatus } from "../../../dashboard/src/v2/lib/tasks/task-board-actions.js";
import type { TaskStatus } from "../../../dashboard/src/v2/types.js";

describe("resolveTaskDropStatus", () => {
  test.each([
    ["pending", "pending"],
    ["in_progress", "in_progress"],
    ["coding_completed", "in_progress"],
    ["QA_REVIEW_FAILED", "in_progress"],
    ["completed", "completed"],
  ] satisfies Array<[TaskStatus, TaskStatus]>)(
    "returns null for same-lane drops from %s to %s",
    (currentStatus, targetLane) => {
      expect(resolveTaskDropStatus(currentStatus, targetLane)).toBeNull();
    }
  );

  test.each([
    ["pending", "in_progress", "in_progress"],
    ["pending", "completed", "completed"],
    ["in_progress", "pending", "pending"],
    ["in_progress", "completed", "completed"],
    ["coding_completed", "pending", "pending"],
    ["coding_completed", "completed", "completed"],
    ["QA_REVIEW_FAILED", "pending", "pending"],
    ["QA_REVIEW_FAILED", "completed", "completed"],
    ["completed", "pending", "pending"],
    ["completed", "in_progress", "in_progress"],
  ] satisfies Array<[TaskStatus, TaskStatus, TaskStatus]>)(
    "resolves cross-lane drop from %s to %s as %s",
    (currentStatus, targetLane, expectedStatus) => {
      expect(resolveTaskDropStatus(currentStatus, targetLane)).toBe(expectedStatus);
    }
  );

  test.each([
    "pending",
    "in_progress",
    "coding_completed",
    "QA_REVIEW_FAILED",
    "completed",
  ] satisfies TaskStatus[])("covers %s as a current status", (currentStatus) => {
    const targetLane = currentStatus === "completed" ? "pending" : "completed";
    expect(resolveTaskDropStatus(currentStatus, targetLane)).not.toBe(currentStatus);
  });
});
