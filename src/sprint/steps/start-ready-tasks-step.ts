import type { Subtask } from "../../contracts/app-types.js";
import type { Logger } from "../../shared/logging/logger.js";

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
  getProviderForTask: (task: Subtask) => string | null;
  getProviderSettings: (provider: string) => { maxConcurrentTasks?: number };
  getRunningCounts: () => Record<string, number>;
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
  const readyTasks = subtasks.filter((task) => task.status === "PENDING");

  for (const task of readyTasks) {
    if (options.shouldSkipTask?.(task)) {
      options.logger.info("Skipping task due to active quota cooldown", { taskId: task.id });
      continue;
    }

    const provider = options.getProviderForTask(task);
    if (provider) {
      const providerSettings = options.getProviderSettings(provider);
      const limit = providerSettings.maxConcurrentTasks ?? 0;
      if (limit > 0) {
        const currentCount = currentRunningCounts[provider] || 0;
        if (currentCount >= limit) {
          continue;
        }
      }
    }

    try {
      const session = await options.startTask(task);
      if (provider) {
        currentRunningCounts[provider] = (currentRunningCounts[provider] || 0) + 1;
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

  return { subtasks, reportText };
};
