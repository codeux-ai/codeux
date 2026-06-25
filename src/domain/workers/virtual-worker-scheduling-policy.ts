import type { DashboardSettings, WorkerExecutionMode } from "../../contracts/app-types.js";
import type { ProjectAttentionItemRecord } from "../../contracts/project-attention-types.js";

export function isOrchestratorHandledClarificationItem(summaryMarkdown: string): boolean {
  return summaryMarkdown.includes("Clarification cooldown active")
    || summaryMarkdown.includes("already answered automatically")
    || summaryMarkdown.includes("Resume instruction already sent");
}

export function resolveWorkerExecutionMode(settings: DashboardSettings): WorkerExecutionMode {
  return settings.workers.executionMode;
}

export function projectNeedsVirtualWorker(hasActiveCycle: boolean, nextItem: ProjectAttentionItemRecord | null): boolean {
  if (hasActiveCycle) {
    return false;
  }
  return nextItem !== null;
}

export function peekNextWorkerAttention(
  items: ProjectAttentionItemRecord[],
  resolveSettings: (projectId: string, sprintId?: string | null) => DashboardSettings
): ProjectAttentionItemRecord | null {
  return items.find((item) => {
    if (item.ownerType !== "worker") {
      return false;
    }
    if (item.status !== "open" && !(item.status === "claimed" && !item.assignedWorkerEndpointId)) {
      return false;
    }

    if (isOrchestratorHandledClarificationItem(item.summaryMarkdown)) {
      return false;
    }

    const settings = resolveSettings(item.projectId, item.sprintId);

    if (item.attentionType === "merge_required") {
      return false;
    }

    if (item.attentionType === "merge_conflict") {
      return settings.ciIntelligence.resolveMergeConflicts;
    }

    if (item.attentionType === "ci_fix_required") {
      return settings.ciIntelligence.waitForJulesCiAutofix;
    }

    if (item.attentionType === "action_required") {
      return settings.automationInterventions.autoAnswerClarification || settings.automationInterventions.autoApprovePlan;
    }

    return true;
  }) || null;
}
