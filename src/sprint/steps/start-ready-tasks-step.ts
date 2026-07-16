import type { Subtask } from "../../contracts/app-types.js";
import type { Logger } from "../../shared/logging/logger.js";
import { getTaskDispatchDeferral } from "../../services/sprint-task-dispatch-service.js";

const PROVIDER_CAP_LOG_INTERVAL_MS = 10_000;
const MAX_PROVIDER_CAP_LOG_STATE_ENTRIES = 2_048;

export type ProviderCapLogState = Map<string, { loggedAt: number }>;

const providerCapLogState = new WeakMap<Logger, ProviderCapLogState>();

const evictOldestProviderCapLogEntry = (state: ProviderCapLogState): void => {
  if (state.size < MAX_PROVIDER_CAP_LOG_STATE_ENTRIES) return;

  let oldestKey: string | undefined;
  let oldestLoggedAt = Number.POSITIVE_INFINITY;
  for (const [key, entry] of state) {
    if (entry.loggedAt < oldestLoggedAt) {
      oldestKey = key;
      oldestLoggedAt = entry.loggedAt;
    }
  }
  if (oldestKey) state.delete(oldestKey);
};

const shouldLogProviderCapBlock = (
  logger: Logger,
  externalState: ProviderCapLogState | undefined,
  scope: string | undefined,
  provider: string,
): boolean => {
  let state = externalState ?? providerCapLogState.get(logger);
  if (!state) {
    state = new Map();
    providerCapLogState.set(logger, state);
  }
  const key = scope ? `${scope}:${provider}` : provider;
  const now = Date.now();
  const previous = state.get(key);
  if (
    previous
    && now >= previous.loggedAt
    && now - previous.loggedAt < PROVIDER_CAP_LOG_INTERVAL_MS
  ) {
    return false;
  }
  if (!previous) evictOldestProviderCapLogEntry(state);
  state.set(key, { loggedAt: now });
  return true;
};

interface StartReadyTasksOptions {
  action: "status" | "orchestrate" | "plan";
  maxFailures: number;
  getConsecutiveFailures: () => number;
  setConsecutiveFailures: (value: number) => void;
  startTask: (task: Subtask) => Promise<{ id?: string; name?: string; provider?: string; runtimeLabel?: string }>;
  resolveSessionName: (session: { id?: string; name?: string }) => string | undefined;
  extractSessionId: (session: { id?: string; name?: string }) => string | undefined;
  logger: Logger;
  shouldSkipTask?: (task: Subtask) => boolean;
  /** Returns true if the task is blocked by a guardrail and should be skipped this cycle. */
  applyTaskCodingGuardrail?: (task: Subtask) => boolean;
  getProviderForTask: (task: Subtask) => string | null;
  getProviderSettings: (provider: string) => { maxConcurrentTasks?: number };
  getRunningCounts: () => Record<string, number>;
  /** Effective immediately available slots after adaptive/global admission policy. */
  getAvailableProviderCapacity?: (provider: string) => Promise<number | null>;
  /** Long-lived, bounded throttle state shared across orchestration cycles. */
  providerCapLogState?: ProviderCapLogState;
  /** Isolates throttle windows for concurrent sprint runs that use the same provider. */
  providerCapLogScope?: string;
}

export const runStartReadyTasksStep = async (
  subtasks: Subtask[],
  options: StartReadyTasksOptions
): Promise<{ subtasks: Subtask[]; reportText: string }> => {
  let reportText = "";

  if (options.action !== "orchestrate") {
    return { subtasks, reportText };
  }

  if (options.getConsecutiveFailures() >= options.maxFailures) {
    throw new Error(
      `CRITICAL: Emergency stop active. ${options.getConsecutiveFailures()} consecutive task creation failures detected. Please check configuration and run again to reset.`
    );
  }

  const currentRunningCounts = options.getRunningCounts();
  const remainingAdmissionCapacity = new Map<string, number | null>();
  const readyTasks = subtasks.filter((task) => task.status === "PENDING");
  const providerCapBlocks = new Map<string, {
    count: number;
    limit?: number;
    currentCount?: number;
    source: "pre_dispatch" | "dispatch";
    taskIds: string[];
  }>();

  const recordProviderCapBlock = (input: {
    taskId: string;
    provider?: string;
    limit?: number;
    currentCount?: number;
    source: "pre_dispatch" | "dispatch";
  }): void => {
    const key = input.provider || "unknown";
    const current = providerCapBlocks.get(key) || {
      count: 0,
      limit: input.limit,
      currentCount: input.currentCount,
      source: input.source,
      taskIds: [],
    };
    current.count += 1;
    current.limit = input.limit ?? current.limit;
    current.currentCount = input.currentCount ?? current.currentCount;
    current.source = current.source === "dispatch" || input.source === "dispatch" ? "dispatch" : "pre_dispatch";
    if (current.taskIds.length < 8) {
      current.taskIds.push(input.taskId);
    }
    providerCapBlocks.set(key, current);
  };

  for (const task of readyTasks) {
    if (options.shouldSkipTask?.(task)) {
      options.logger.info("Skipping task due to active quota cooldown", { taskId: task.id });
      continue;
    }

    if (options.applyTaskCodingGuardrail?.(task)) {
      continue;
    }

    const provider = options.getProviderForTask(task);
    if (provider) {
      const providerSettings = options.getProviderSettings(provider);
      const limit = providerSettings.maxConcurrentTasks ?? 0;
      const runningCount = currentRunningCounts[provider] || 0;
      let availableCapacity = remainingAdmissionCapacity.get(provider);
      if (availableCapacity === undefined && options.getAvailableProviderCapacity) {
        availableCapacity = await options.getAvailableProviderCapacity(provider);
        remainingAdmissionCapacity.set(provider, availableCapacity);
      }
      if (availableCapacity !== undefined && availableCapacity !== null && availableCapacity <= 0) {
        task.status = "PENDING";
        recordProviderCapBlock({
          taskId: task.id,
          provider,
          limit: runningCount,
          currentCount: runningCount,
          source: "pre_dispatch",
        });
        continue;
      }
      if (limit > 0 && runningCount >= limit) {
        task.status = "PENDING";
        recordProviderCapBlock({
          taskId: task.id,
          provider,
          limit,
          currentCount: runningCount,
          source: "pre_dispatch",
        });
        continue;
      }
    }

    try {
      const session = await options.startTask(task);
      if (provider) {
        currentRunningCounts[provider] = (currentRunningCounts[provider] || 0) + 1;
        const availableCapacity = remainingAdmissionCapacity.get(provider);
        if (availableCapacity !== undefined && availableCapacity !== null) {
          remainingAdmissionCapacity.set(provider, Math.max(0, availableCapacity - 1));
        }
      }
      task.status = "RUNNING";
      task.session_name = options.resolveSessionName(session);
      task.session_id = options.extractSessionId(session);
      if (session.provider === "jules" || session.provider === "gemini" || session.provider === "codex" || session.provider === "claude-code") {
        task.provider = session.provider;
      }
      const providerLabel = session.runtimeLabel || (session.provider ? String(session.provider).toUpperCase() : "JULES");
      reportText += `🚀 **Started ${providerLabel} Session** for task \`${task.id}\`: [${session.id}](${session.id})\n`;
      options.setConsecutiveFailures(0);
    } catch (error: unknown) {
      const deferral = getTaskDispatchDeferral(error);
      if (deferral) {
        const deferredProvider = deferral.provider || provider || undefined;
        const providerSettings = deferredProvider ? options.getProviderSettings(deferredProvider) : {};
        const runningCount = deferredProvider ? currentRunningCounts[deferredProvider] : undefined;

        task.status = "PENDING";
        recordProviderCapBlock({
          taskId: task.id,
          provider: deferredProvider,
          limit: deferral.limit ?? providerSettings.maxConcurrentTasks,
          currentCount: deferral.currentCount ?? runningCount,
          source: "dispatch",
        });
        continue;
      }
      const currentFails = options.getConsecutiveFailures() + 1;
      options.setConsecutiveFailures(currentFails);
      const message = error instanceof Error ? error.message : String(error);
      options.logger.error("Error starting task", {
        taskId: task.id,
        error: message,
        consecutiveFailures: currentFails,
        maxFailures: options.maxFailures,
      });
      if (currentFails >= options.maxFailures) {
        throw new Error(`CRITICAL: Emergency stop triggered after ${currentFails} consecutive task creation failures.`);
      }
    }
  }

  for (const [provider, block] of providerCapBlocks) {
    if (!shouldLogProviderCapBlock(
      options.logger,
      options.providerCapLogState,
      options.providerCapLogScope,
      provider,
    )) continue;
    options.logger.info("Provider concurrency cap deferred ready tasks", {
      provider,
      limit: block.limit,
      currentCount: block.currentCount,
      blockedTaskCount: block.count,
      sampleTaskIds: block.taskIds,
      source: block.source,
    });
  }

  return { subtasks, reportText };
};
