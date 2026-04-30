import { describe, it, expect } from "vitest";
import { decideFinalizationTransition } from "../../../src/domain/sprint/orchestrator/watch-loop-finalization-policy.js";
import type { WatchLoopDecision } from "../../../src/domain/sprint/orchestrator/watch-loop-policies.js";

describe("decideFinalizationTransition", () => {
  it("should map failed state", () => {
    const decision: WatchLoopDecision = {
      status: "continue",
      terminalState: "failed",
      failedTaskCount: 2,
    };
    const result = decideFinalizationTransition(decision);
    expect(result).toEqual({
      type: "failed",
      failedTaskCount: 2,
    });
  });

  it("should map paused state awaiting_merge", () => {
    const decision: WatchLoopDecision = {
      status: "continue",
      terminalState: "paused",
      pauseReason: "awaiting_merge",
      pausePayload: {
        awaitingMergeCount: 3,
      },
    };
    const result = decideFinalizationTransition(decision);
    expect(result).toEqual({
      type: "paused_awaiting_merge",
      awaitingMergeCount: 3,
    });
  });

  it("should map cancelled state empty", () => {
    const decision: WatchLoopDecision = {
      status: "continue",
      terminalState: "cancelled",
      pauseReason: "empty",
    };
    const result = decideFinalizationTransition(decision);
    expect(result).toEqual({
      type: "cancelled_empty",
    });
  });

  it("should map paused state manual_attention", () => {
    const decision: WatchLoopDecision = {
      status: "continue",
      terminalState: "paused",
      pauseReason: "manual_attention",
      pausePayload: {
        runningTaskIds: ["task-1"],
        readyTaskIds: ["task-2"],
        blockedTaskIds: ["task-3"],
      },
    };
    const result = decideFinalizationTransition(decision);
    expect(result).toEqual({
      type: "paused_manual_attention",
      runningTaskIds: ["task-1"],
      readyTaskIds: ["task-2"],
      blockedTaskIds: ["task-3"],
    });
  });

  it("should return a safe fallback for unknown pause reason", () => {
    const decision: WatchLoopDecision = {
      status: "continue",
      terminalState: "paused",
      pauseReason: "main_merge_blocked",
    };
    const result = decideFinalizationTransition(decision);
    expect(result).toEqual({
      type: "unhandled",
    });
  });

  it("should map completed state", () => {
    const decision: WatchLoopDecision = {
      status: "continue",
      terminalState: "completed",
      completedTaskCount: 5,
    };
    const result = decideFinalizationTransition(decision);
    expect(result).toEqual({
      type: "completed",
      completedTaskCount: 5,
    });
  });
});
