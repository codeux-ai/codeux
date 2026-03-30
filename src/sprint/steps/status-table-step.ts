import type { Subtask } from "../../contracts/app-types.js";

function isMergeSettled(task: Pick<Subtask, "is_merged" | "merge_indicator">): boolean {
  return Boolean(task.is_merged) || task.merge_indicator === "MERGED" || task.merge_indicator === "AUTOMERGE" || task.merge_indicator === "PR_CREATED";
}

const resolveStatusIcon = (task: Subtask): string => {
  if (task.status === "CODING_COMPLETED") return isMergeSettled(task) ? "✅" : "🛠️";
  if (task.status === "COMPLETED") return "✅";
  if (task.status === "RUNNING") return "⏳";
  if (task.status === "BLOCKED") return "🚫";
  if (task.status === "FAILED") return "❌";
  if (task.status === "QUOTA") return "⏸️";
  return "💤";
};

export const runStatusTableStep = (subtasks: Subtask[]): string => {
  let table = "#### Task Status:\n";

  for (const task of subtasks) {
    const mergeInfo = task.status === "CODING_COMPLETED" && !isMergeSettled(task)
      ? " **(Awaiting Merge)**"
      : task.status === "COMPLETED" && task.merge_indicator === "PR_CREATED"
        ? " **(PR Created)**"
        : "";
    const providerInfo = task.provider ? ` [${task.provider}]` : "";
    table += `- ${resolveStatusIcon(task)} **${task.id}**: \`${task.status}\`${mergeInfo}${providerInfo} - ${task.title}\n`;
  }

  return table;
};
