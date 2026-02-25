import type { Subtask } from "../../types.js";

interface StartReadyTasksOptions {
  action: "status" | "orchestrate" | "plan";
  maxFailures: number;
  getConsecutiveFailures: () => number;
  setConsecutiveFailures: (value: number) => void;
  startJulesTask: (task: Subtask) => Promise<{ id?: string; name?: string }>;
  resolveSessionName: (session: { id?: string; name?: string }) => string | undefined;
  extractSessionId: (session: { id?: string; name?: string }) => string | undefined;
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

  const readyTasks = subtasks.filter((task) => task.status === "PENDING" && task.is_independent);
  for (const task of readyTasks) {
    try {
      const session = await options.startJulesTask(task);
      task.status = "RUNNING";
      task.session_name = options.resolveSessionName(session);
      task.session_id = options.extractSessionId(session);
      reportText += `🚀 **Started Jules Session** for task \`${task.id}\`: [${session.id}](${session.id})\n`;
      options.setConsecutiveFailures(0);
    } catch (error: unknown) {
      const currentFails = options.getConsecutiveFailures() + 1;
      options.setConsecutiveFailures(currentFails);
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Error starting task ${task.id}: ${message} (Consecutive failures: ${currentFails}/${options.maxFailures})`);
      if (currentFails >= options.maxFailures) {
        throw new Error(`CRITICAL: Emergency stop triggered after ${currentFails} consecutive task creation failures.`);
      }
    }
  }

  return { subtasks, reportText };
};
