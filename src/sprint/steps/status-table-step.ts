import type { Subtask } from "../../types.js";

const resolveStatusIcon = (task: Subtask): string => {
  if (task.status === "COMPLETED") return task.is_merged ? "✅" : "🤝";
  if (task.status === "RUNNING") return "⏳";
  if (task.status === "BLOCKED") return "🚫";
  if (task.status === "FAILED") return "❌";
  return "💤";
};

export const runStatusTableStep = (subtasks: Subtask[]): string => {
  let table = "#### Task Status:\n";

  for (const task of subtasks) {
    const mergeInfo = task.status === "COMPLETED" && !task.is_merged ? " **(Awaiting Merge)**" : "";
    table += `- ${resolveStatusIcon(task)} **${task.id}**: \`${task.status}\`${mergeInfo} - ${task.title}\n`;
  }

  return table;
};
