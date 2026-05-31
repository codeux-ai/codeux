import { describe, expect, it } from "vitest";
import {
  calculateNextCycleState,
  type CycleStateInput,
} from "../../../../../src/domain/sprint/orchestrator/cycle-logic-utils.js";
import type { Subtask } from "../../../../../src/contracts/app-types.js";

describe("cycle-logic-utils", () => {
  describe("calculateNextCycleState", () => {
    it("handles pending tasks with met dependencies", () => {
      const subtasks: Subtask[] = [
        { id: "T1", status: "PENDING", depends_on: [], is_independent: true } as any,
      ];

      const input: CycleStateInput = {
        subtasks,
        retryFailed: false,
        isActionRequiredState: () => false,
        getGuardrailEvaluation: () => ({ allowed: true, action: "WARN_ONLY", count: 0, cap: 2 }),
        getProviderForTask: () => "jules",
        getProviderLimit: () => 10,
        getRunningCounts: () => ({}),
        automationLevel: "FULL_AUTO",
        maxFailures: 5,
        consecutiveFailures: 0,
        shouldSkipTask: () => false,
      };

      const actions = calculateNextCycleState(input);
            expect(actions).toContainEqual({ type: "TRIGGER_WORKER", taskId: "T1", provider: "jules" });
    });

    it("resets failed tasks if retryFailed is true and triggers them", () => {
      const subtasks: Subtask[] = [
        { id: "T1", status: "FAILED", session_state: "FAILED", depends_on: [], is_independent: true } as any,
      ];

      const input: CycleStateInput = {
        subtasks,
        retryFailed: true,
        isActionRequiredState: () => false,
        getGuardrailEvaluation: () => ({ allowed: true, action: "WARN_ONLY", count: 0, cap: 2 }),
        getProviderForTask: () => "jules",
        getProviderLimit: () => 10,
        getRunningCounts: () => ({}),
        automationLevel: "FULL_AUTO",
        maxFailures: 5,
        consecutiveFailures: 0,
        shouldSkipTask: () => false,
      };

      const actions = calculateNextCycleState(input);

      expect(actions).toContainEqual({ type: "RESET_TASK", taskId: "T1", preserveProvider: true });
            expect(actions).toContainEqual({ type: "TRIGGER_WORKER", taskId: "T1", provider: "jules" });
    });

    it("blocks tasks reaching concurrency limit", () => {
      const subtasks: Subtask[] = [
        { id: "T1", status: "PENDING", depends_on: [], is_independent: true } as any,
        { id: "T2", status: "PENDING", depends_on: [], is_independent: true } as any,
      ];

      const input: CycleStateInput = {
        subtasks,
        retryFailed: false,
        isActionRequiredState: () => false,
        getGuardrailEvaluation: () => ({ allowed: true, action: "WARN_ONLY", count: 0, cap: 2 }),
        getProviderForTask: () => "jules",
        getProviderLimit: () => 1, // Only 1 allowed
        getRunningCounts: () => ({}), // Start with 0
        automationLevel: "FULL_AUTO",
        maxFailures: 5,
        consecutiveFailures: 0,
        shouldSkipTask: () => false,
      };

      const actions = calculateNextCycleState(input);

            expect(actions).toContainEqual({ type: "TRIGGER_WORKER", taskId: "T1", provider: "jules" });
      expect(actions).toContainEqual({ type: "BLOCK_TASK", taskId: "T2", owner: "HUMAN", hint: "Provider concurrency cap reached" });
    });

    it("blocks tasks reaching guardrail limits", () => {
      const subtasks: Subtask[] = [
        { id: "T1", record_id: "record1", status: "PENDING", depends_on: [], is_independent: true } as any,
      ];

      const input: CycleStateInput = {
        subtasks,
        retryFailed: false,
        isActionRequiredState: () => false,
        getGuardrailEvaluation: () => ({ allowed: false, action: "STOP_AND_WAIT", count: 2, cap: 2 }),
        getProviderForTask: () => "jules",
        getProviderLimit: () => 10,
        getRunningCounts: () => ({}),
        automationLevel: "SEMI_AUTO",
        maxFailures: 5,
        consecutiveFailures: 0,
        shouldSkipTask: () => false,
      };

      const actions = calculateNextCycleState(input);

            expect(actions).toContainEqual(expect.objectContaining({ type: "BLOCK_TASK", taskId: "T1", owner: "HUMAN" }));
    });

    it("handles circular or unmet dependencies", () => {
      const subtasks: Subtask[] = [
        { id: "T1", status: "PENDING", depends_on: ["T2"] } as any,
        { id: "T2", status: "PENDING", depends_on: ["T1"] } as any,
      ];

      const input: CycleStateInput = {
        subtasks,
        retryFailed: false,
        isActionRequiredState: () => false,
        getGuardrailEvaluation: () => ({ allowed: true, action: "WARN_ONLY", count: 0, cap: 2 }),
        getProviderForTask: () => "jules",
        getProviderLimit: () => 10,
        getRunningCounts: () => ({}),
        automationLevel: "FULL_AUTO",
        maxFailures: 5,
        consecutiveFailures: 0,
        shouldSkipTask: () => false,
      };

      const actions = calculateNextCycleState(input);

      expect(actions).toContainEqual({ type: "UPDATE_STATUS", taskId: "T1", status: "BLOCKED" });
      expect(actions).toContainEqual({ type: "UPDATE_STATUS", taskId: "T2", status: "BLOCKED" });
    });
  });
});
