import type { DashboardSettings, WorkerExecutionMode } from "../../contracts/app-types.js";
import type { ProjectAttentionItemRecord, ProjectAttentionType } from "../../contracts/project-attention-types.js";

export type VirtualWorkerScheduleDecision =
  | { shouldSchedule: true; reason: "virtual_worker_work_available" }
  | {
      shouldSchedule: false;
      reason:
        | "active_cycle"
        | "already_scheduled"
        | "workers_not_virtual"
        | "manager_clarification_pending"
        | "no_actionable_work"
    };

export interface VirtualWorkerProjectSchedulingState {
  executionMode: WorkerExecutionMode;
  hasActiveCycle: boolean;
  isAlreadyScheduled: boolean;
  nextAttentionItem: ProjectAttentionItemRecord | null;
  hasPendingDispatch: boolean;
  hasPendingManagerClarification?: boolean;
}

export type VirtualWorkerAttentionRoute =
  | "skip_orchestrator_handled"
  | "merge_conflict"
  | "ci_fix"
  | "action_required"
  | "escalate_to_human";

export interface VirtualWorkerAttentionClaimPolicy {
  claimReason: string;
}

export function isProjectManagerOwnedClarificationItem(
  item: Pick<ProjectAttentionItemRecord, "attentionType" | "payload">,
): boolean {
  return item.attentionType === "worker_clarification"
    || item.payload?.type === "worker_clarification";
}

export function isOrchestratorHandledClarificationItem(summaryMarkdown: string): boolean {
  return summaryMarkdown.includes("Clarification cooldown active")
    || summaryMarkdown.includes("already answered automatically")
    || summaryMarkdown.includes("Resume instruction already sent");
}

export function resolveWorkerExecutionMode(settings: DashboardSettings): WorkerExecutionMode {
  return settings.workers.executionMode;
}

export function decideVirtualWorkerProjectScheduling(
  state: VirtualWorkerProjectSchedulingState,
): VirtualWorkerScheduleDecision {
  if (state.hasActiveCycle) {
    return { shouldSchedule: false, reason: "active_cycle" };
  }
  if (state.isAlreadyScheduled) {
    return { shouldSchedule: false, reason: "already_scheduled" };
  }
  if (state.executionMode !== "VIRTUAL") {
    return { shouldSchedule: false, reason: "workers_not_virtual" };
  }
  if (!state.nextAttentionItem && state.hasPendingManagerClarification) {
    return { shouldSchedule: false, reason: "manager_clarification_pending" };
  }
  if (!state.nextAttentionItem && !state.hasPendingDispatch) {
    return { shouldSchedule: false, reason: "no_actionable_work" };
  }
  return { shouldSchedule: true, reason: "virtual_worker_work_available" };
}

export function projectNeedsVirtualWorker(
  hasActiveCycle: boolean,
  nextItem: ProjectAttentionItemRecord | null,
  executionMode: WorkerExecutionMode = "VIRTUAL",
  hasPendingDispatch = false,
  isAlreadyScheduled = false,
  hasPendingManagerClarification = false,
): boolean {
  return decideVirtualWorkerProjectScheduling({
    executionMode,
    hasActiveCycle,
    isAlreadyScheduled,
    nextAttentionItem: nextItem,
    hasPendingDispatch,
    hasPendingManagerClarification,
  }).shouldSchedule;
}

export function peekNextWorkerAttention(
  items: ProjectAttentionItemRecord[],
  resolveSettings: (projectId: string, sprintId?: string | null) => DashboardSettings
): ProjectAttentionItemRecord | null {
  const pendingManagerClarifications = items.filter((item) => (
    isProjectManagerOwnedClarificationItem(item)
    && item.payload?.status === "pending"
  ));

  return items.find((item) => {
    if (item.ownerType !== "worker") {
      return false;
    }
    if (item.status !== "open" && !(item.status === "claimed" && !item.assignedWorkerEndpointId)) {
      return false;
    }

    if (isProjectManagerOwnedClarificationItem(item)) {
      return false;
    }

    if (pendingManagerClarifications.some((clarification) => (
      (Boolean(item.taskId) && clarification.taskId === item.taskId)
      || (Boolean(item.dispatchId) && clarification.dispatchId === item.dispatchId)
    ))) {
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
      return true;
    }

    if (item.attentionType === "action_required") {
      return settings.automationInterventions.autoAnswerClarification || settings.automationInterventions.autoApprovePlan;
    }

    return true;
  }) || null;
}

export function computeReconciliationCandidates(
  activeAttentionProjects: string[],
  pendingDispatchProjects: string[],
  activeCycles: string[]
): string[] {
  return Array.from(new Set([
    ...activeAttentionProjects,
    ...pendingDispatchProjects,
    ...activeCycles
  ]));
}

export function resolveVirtualWorkerAttentionRoute(
  item: Pick<ProjectAttentionItemRecord, "attentionType" | "summaryMarkdown" | "payload">,
): VirtualWorkerAttentionRoute {
  if (isProjectManagerOwnedClarificationItem(item)) {
    return "skip_orchestrator_handled";
  }
  if (isOrchestratorHandledClarificationItem(item.summaryMarkdown)) {
    return "skip_orchestrator_handled";
  }

  const routeByAttentionType: Partial<Record<ProjectAttentionType, VirtualWorkerAttentionRoute>> = {
    merge_conflict: "merge_conflict",
    merge_required: "merge_conflict",
    ci_fix_required: "ci_fix",
    action_required: "action_required",
  };

  return routeByAttentionType[item.attentionType] || "escalate_to_human";
}

export function planVirtualWorkerAttentionClaim(
  item: Pick<ProjectAttentionItemRecord, "status">,
  reason: string,
): VirtualWorkerAttentionClaimPolicy {
  return {
    claimReason: item.status === "claimed"
      ? `virtual_worker_reclaimed:${reason}`
      : `virtual_worker_claimed:${reason}`,
  };
}
