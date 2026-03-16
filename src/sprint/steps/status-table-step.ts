import type { Subtask } from "../../contracts/app-types.js";

const resolveStatusIcon = (task: Subtask): string => {
  if (task.status === "COMPLETED") return task.is_merged ? "✅" : "🤝";
  if (task.status === "RUNNING") return "⏳";
  if (task.status === "BLOCKED") return "🚫";
  if (task.status === "FAILED") return "❌";
  if (task.status === "QUOTA") return "⏸️";
  return "💤";
};

export const runStatusTableStep = (subtasks: Subtask[]): string => {
  let table = "#### Task Status:\n";

  for (const task of subtasks) {
    const mergeInfo = task.status === "COMPLETED" && !task.is_merged ? " **(Awaiting Merge)**" : "";
    const providerInfo = task.provider ? ` [${task.provider}]` : "";
    table += `- ${resolveStatusIcon(task)} **${task.id}**: \`${task.status}\`${mergeInfo}${providerInfo} - ${task.title}\n`;
  }

  return table;
};
