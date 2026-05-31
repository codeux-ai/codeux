import type { Subtask } from "../../../contracts/app-types.js";
import { isCompletedTaskSettled } from "../task-merge-state.js";
import type { AutomationLevel } from "../../../contracts/app-types.js";
import { resolveCiEscalationOwner } from "../ci/feature-pr/ci-autofix-policy.js";
import type { GuardrailEvaluation } from "../../../services/guardrail-service.js";

export type CycleTransitionAction =
  | { type: "UPDATE_STATUS"; taskId: string; status: Subtask["status"]; reason?: string }
  | { type: "TRIGGER_WORKER"; taskId: string; provider: string }
  | { type: "BLOCK_TASK"; taskId: string; owner: string; hint: string }
  | { type: "RESET_TASK"; taskId: string; preserveProvider?: boolean };

export interface CycleStateInput {
  subtasks: Subtask[];
  retryFailed: boolean;
  isActionRequiredState: (state?: string) => boolean;
  getGuardrailEvaluation: (taskId: string) => GuardrailEvaluation | null;
  getProviderForTask: (task: Subtask) => string | null;
  getProviderLimit: (provider: string) => number;
  getRunningCounts: () => Record<string, number>;
  automationLevel: AutomationLevel;
  maxFailures: number;
  consecutiveFailures: number;
  shouldSkipTask: (task: Subtask) => boolean;
}

export function calculateNextCycleState(input: CycleStateInput): CycleTransitionAction[] {
  const actions: CycleTransitionAction[] = [];
  const { subtasks, retryFailed, isActionRequiredState, automationLevel, maxFailures, consecutiveFailures, shouldSkipTask } = input;

  const areDependenciesMet = (task: Subtask): boolean => {
    return task.depends_on.every((depId) => {
      const dep = subtasks.find((candidate) => candidate.id === depId);
      return dep ? isCompletedTaskSettled(dep) : false;
    });
  };

  const pendingTasks: Subtask[] = [];
  const currentRunningCounts = { ...input.getRunningCounts() };

  // Phase 1: Status Derivation
  for (const task of subtasks) {
    if (task.session_state === "QUOTA" || task.session_state === "RATE_LIMITED" || task.status === "QUOTA") {
      if (task.status !== "QUOTA") {
        actions.push({ type: "UPDATE_STATUS", taskId: task.id, status: "QUOTA" });
      }
      continue;
    }

    if (task.session_state === "BLOCKED") {
      if (task.status !== "BLOCKED") {
        actions.push({ type: "UPDATE_STATUS", taskId: task.id, status: "BLOCKED" });
      }
      continue;
    }

    if (task.session_state === "FAILED" && retryFailed) {
      actions.push({ type: "RESET_TASK", taskId: task.id, preserveProvider: true });
      const nextStatus = areDependenciesMet(task) ? "PENDING" : "BLOCKED";
      actions.push({ type: "UPDATE_STATUS", taskId: task.id, status: nextStatus });
      if (nextStatus === "PENDING") {
        // Assume it changes to PENDING for subsequent scheduling logic
        pendingTasks.push({ ...task, status: "PENDING" });
      }
      continue;
    }

    if (task.session_state && isActionRequiredState(task.session_state)) {
      if (task.status !== "BLOCKED") {
        actions.push({ type: "UPDATE_STATUS", taskId: task.id, status: "BLOCKED" });
      }
      continue;
    }

    if (task.status === "RUNNING" || task.status === "CODING_COMPLETED" || task.status === "COMPLETED" || task.status === "FAILED") {
      continue;
    }

    if (!task.is_independent && task.depends_on.length === 0) {
      if (task.status !== "BLOCKED") {
        actions.push({ type: "UPDATE_STATUS", taskId: task.id, status: "BLOCKED" });
      }
      continue;
    }

    const newStatus = areDependenciesMet(task) ? "PENDING" : "BLOCKED";
    if (task.status !== newStatus) {
      actions.push({ type: "UPDATE_STATUS", taskId: task.id, status: newStatus });
    }

    if (newStatus === "PENDING" || task.status === "PENDING") {
      pendingTasks.push(task);
    }
  }

  // Phase 2: Scheduling / Triggering
  if (consecutiveFailures >= maxFailures) {
    return actions; // Emergency stop, no new tasks
  }

  for (const task of pendingTasks) {
    if (shouldSkipTask(task)) {
      continue;
    }

    const evaluation = input.getGuardrailEvaluation(task.record_id || "");

    let blocked = false;
    let owner = "HUMAN";
    let interventionHint = "";

    if (evaluation && !evaluation.allowed) {
      if (evaluation.action === "WARN_ONLY") {
        // Do nothing, just warn
      } else {
        blocked = true;
        owner = evaluation.action === "STOP_AND_WAIT" ? "HUMAN" : resolveCiEscalationOwner(automationLevel);
        interventionHint = evaluation.blockedByTotalCeiling
          ? `Per-task invocation ceiling reached for task ${task.id} (${evaluation.reason ?? ""}).`
          : `Coding guardrail reached for task ${task.id}: ${evaluation.count}/${evaluation.cap} coding attempts.`;
      }
    }

    if (blocked) {
      actions.push({
        type: "BLOCK_TASK",
        taskId: task.id,
        owner,
        hint: interventionHint,
      });
      continue;
    }

    const provider = input.getProviderForTask(task);
    if (provider) {
      const limit = input.getProviderLimit(provider);
      if (limit > 0) {
        const currentCount = currentRunningCounts[provider] || 0;
        if (currentCount >= limit) {
          actions.push({
            type: "BLOCK_TASK",
            taskId: task.id,
            owner: "HUMAN",
            hint: `Provider concurrency cap reached`,
          });
          continue;
        }
      }
    }

    // Task is cleared to start
    actions.push({
      type: "TRIGGER_WORKER",
      taskId: task.id,
      provider: provider || "jules",
    });

    if (provider) {
      currentRunningCounts[provider] = (currentRunningCounts[provider] || 0) + 1;
    }
  }

  return actions;
}
