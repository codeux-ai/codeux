import type { Subtask } from "../../../contracts/app-types.js";
import type { ProjectAttentionItemRecord } from "../../../contracts/project-attention-types.js";
export {
  isMainMergeAttentionItem,
  partitionSubtasksByStatus,
} from "../task-transition-state.js";
import { evaluateSprintTransitionState } from "../task-transition-state.js";

export function evaluateSprintRunState(params: {
  subtasks: Subtask[];
  manualMergeTasks: Subtask[];
  workerEscalatedMergeConflictTasks: Subtask[];
  activeProjectAttentionItems: ProjectAttentionItemRecord[];
  sprintRunId: string;
  githubMode?: "REMOTE" | "LOCAL";
  localCliPushedTaskIds?: ReadonlySet<string>;
  localCliSettledTaskIds?: ReadonlySet<string>;
}) {
  return evaluateSprintTransitionState(params);
}
