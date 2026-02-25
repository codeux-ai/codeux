import * as path from "path";
import type { CiIntelligenceSettings, Subtask } from "../../types.js";
import type { InstructionTemplateId } from "../../instructions/catalog.js";

interface ProtocolStepOptions {
  subtasksDir: string;
  featureBranch: string;
  githubMode: "REMOTE" | "LOCAL";
  ciIntelligence: CiIntelligenceSettings;
  enableMergeProtocol: boolean;
  enableActionRequiredProtocol: boolean;
  isActionRequiredState: (state?: string) => boolean;
  renderInstruction: (templateId: InstructionTemplateId, variables: Record<string, unknown>) => Promise<string>;
}

export interface ProtocolStepResult {
  instructions: string;
  awaitingMerge: Subtask[];
  actionRequiredTasks: Subtask[];
}

const buildFeatureCiWaitLine = (settings: CiIntelligenceSettings): string => {
  if (!settings.enabled || !settings.waitForCiBeforeFeatureMerge) {
    return "";
  }
  return "- Wait for CI checks before merging into the feature branch.\n";
};

const buildFeatureCommentsLine = (settings: CiIntelligenceSettings): string => {
  if (!settings.enabled || !settings.resolveAllCommentsBeforeFeatureMerge) {
    return "";
  }
  return "- Resolve all PR comments before merging into the feature branch.\n";
};

export const runProtocolStep = async (subtasks: Subtask[], options: ProtocolStepOptions): Promise<ProtocolStepResult> => {
  const awaitingMerge = subtasks.filter((task) => task.status === "COMPLETED" && !task.is_merged);
  const actionRequiredTasks = subtasks.filter(
    (task) => task.status === "BLOCKED" && options.isActionRequiredState(task.session_state)
  );

  let instructions = "";

  if (options.enableMergeProtocol && awaitingMerge.length > 0) {
    instructions += await options.renderInstruction("mergeHeader", {});

    for (const task of awaitingMerge) {
      instructions += await options.renderInstruction("mergeTask", {
        task_id: task.id,
        git_manager_skill: options.githubMode === "REMOTE" ? "`git_manager_remote`" : "`git_manager_local`",
        feature_branch: options.featureBranch,
        subtask_file: path.join(options.subtasksDir, `${task.id}.md`),
        feature_ci_wait_line: buildFeatureCiWaitLine(options.ciIntelligence),
        feature_comments_line: buildFeatureCommentsLine(options.ciIntelligence),
      });
      instructions += "\n";
    }
  }

  if (options.enableActionRequiredProtocol && actionRequiredTasks.length > 0) {
    instructions += await options.renderInstruction("actionRequiredHeader", {});

    for (const task of actionRequiredTasks) {
      instructions += await options.renderInstruction("actionRequiredTask", {
        task_id: task.id,
        session_state: task.session_state || "UNKNOWN",
      });
      instructions += "\n";
    }
  }

  return { instructions, awaitingMerge, actionRequiredTasks };
};
