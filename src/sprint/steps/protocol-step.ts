import type { CiIntelligenceSettings, Subtask } from "../../contracts/app-types.js";
import type { InstructionTemplateId } from "../../instructions/instruction-template-catalog.js";
import { isCompletedTaskAwaitingMerge } from "../../domain/sprint/task-merge-state.js";

interface ProtocolStepOptions {
  featureBranch: string;
  githubMode: "REMOTE" | "LOCAL";
  ciIntelligence: CiIntelligenceSettings;
  enableMergeProtocol: boolean;
  enableActionRequiredProtocol: boolean;
  isActionRequiredState: (state?: string) => boolean;
  renderInstruction: (templateId: InstructionTemplateId, variables: Record<string, unknown>) => Promise<string>;
  isWorkerEscalatedMergeConflictTask?: (task: Subtask) => boolean;
  onTaskEvent?: (args: {
    task: Subtask;
    eventType: string;
    sourceEventKey?: string;
    payload: Record<string, unknown>;
  }) => void;
}

export interface ProtocolStepResult {
  instructions: string;
  awaitingMerge: Subtask[];
  manualMergeTasks: Subtask[];
  workerEscalatedMergeConflictTasks: Subtask[];
  actionRequiredTasks: Subtask[];
  agentInterventionTasks: Subtask[];
  humanInterventionTasks: Subtask[];
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
  const awaitingMerge = subtasks.filter((task) => isCompletedTaskAwaitingMerge(task));
  const workerEscalatedMergeConflictTasks = awaitingMerge.filter((task) => options.isWorkerEscalatedMergeConflictTask?.(task) === true);
  const manualMergeTasks = awaitingMerge.filter((task) => !workerEscalatedMergeConflictTasks.includes(task));
  const actionRequiredTasks = subtasks.filter(
    (task) => task.status === "BLOCKED" && (options.isActionRequiredState(task.session_state) || !!task.intervention_owner)
  );
  const agentInterventionTasks = actionRequiredTasks.filter((task) => task.intervention_owner === "AGENT");
  const humanInterventionTasks = actionRequiredTasks.filter((task) => task.intervention_owner !== "AGENT");

  let instructions = "";

  if (options.enableMergeProtocol && manualMergeTasks.length > 0) {
    instructions += await options.renderInstruction("mergeHeader", {});

    for (const task of manualMergeTasks) {
      options.onTaskEvent?.({
        task,
        eventType: "protocol_merge_required",
        sourceEventKey: `protocol:merge-required:${task.id}:${task.merge_indicator || "pending"}`,
        payload: {
          featureBranch: options.featureBranch,
          provider: task.provider || "jules",
          mergeIndicator: task.merge_indicator || null,
        },
      });
      instructions += await options.renderInstruction("mergeTask", {
        task_id: task.id,
        git_manager_skill: options.githubMode === "REMOTE" ? "`git_manager_remote`" : "`git_manager_local`",
        feature_branch: options.featureBranch,
        provider: task.provider || "jules",
        task_reference: typeof task.record_id === "string" ? `Sprint OS task ${task.record_id}` : `Sprint OS task ${task.id}`,
        feature_ci_wait_line: buildFeatureCiWaitLine(options.ciIntelligence),
        feature_comments_line: buildFeatureCommentsLine(options.ciIntelligence),
      });
      instructions += "\n";
    }
  }

  if (options.enableActionRequiredProtocol && agentInterventionTasks.length > 0) {
    instructions += await options.renderInstruction("actionRequiredAgentHeader", {});

    for (const task of agentInterventionTasks) {
      options.onTaskEvent?.({
        task,
        eventType: "protocol_action_required",
        sourceEventKey: `protocol:action-required:${task.id}:agent:${task.session_state || "unknown"}`,
        payload: {
          owner: "AGENT",
          sessionState: task.session_state || "UNKNOWN",
          provider: task.provider || "jules",
          interventionHint: task.intervention_hint || null,
        },
      });
      const interventionHintLine = typeof task.intervention_hint === "string" && task.intervention_hint.trim().length > 0
        ? `- Context: ${task.intervention_hint.trim()}\n`
        : "";
      instructions += await options.renderInstruction("actionRequiredAgentTask", {
        task_id: task.id,
        session_state: task.session_state || "UNKNOWN",
        provider: task.provider || "jules",
        intervention_hint_line: interventionHintLine,
      });
      instructions += "\n";
    }
  }

  if (options.enableActionRequiredProtocol && humanInterventionTasks.length > 0) {
    instructions += await options.renderInstruction("actionRequiredHumanHeader", {});

    for (const task of humanInterventionTasks) {
      options.onTaskEvent?.({
        task,
        eventType: "protocol_action_required",
        sourceEventKey: `protocol:action-required:${task.id}:human:${task.session_state || "unknown"}`,
        payload: {
          owner: task.intervention_owner || "HUMAN",
          sessionState: task.session_state || "UNKNOWN",
          provider: task.provider || "jules",
          interventionHint: task.intervention_hint || null,
        },
      });
      const interventionHintLine = typeof task.intervention_hint === "string" && task.intervention_hint.trim().length > 0
        ? `- Context: ${task.intervention_hint.trim()}\n`
        : "";
      instructions += await options.renderInstruction("actionRequiredHumanTask", {
        task_id: task.id,
        session_state: task.session_state || "UNKNOWN",
        provider: task.provider || "jules",
        intervention_hint_line: interventionHintLine,
      });
      instructions += "\n";
    }
  }

  return {
    instructions,
    awaitingMerge,
    manualMergeTasks,
    workerEscalatedMergeConflictTasks,
    actionRequiredTasks,
    agentInterventionTasks,
    humanInterventionTasks,
  };
};
