import type { DashboardSettings, ProviderId } from "../../contracts/app-types.js";
import type { WorkerTaskDispatchClaim } from "../../contracts/execution-types.js";
import type { ProjectAttentionItemRecord } from "../../contracts/project-attention-types.js";
import {
  isOrchestratorHandledClarificationItem,
  planVirtualWorkerAttentionClaim,
  resolveVirtualWorkerAttentionRoute,
  type VirtualWorkerAttentionRoute,
} from "./virtual-worker-scheduling-policy.js";

export type VirtualWorkerCycleAction =
  | { type: "NO_WORKER_NEEDED" }
  | { type: "ORCHESTRATOR_HANDLED_CLARIFICATION" }
  | { type: "PROVIDER_CONCURRENCY_UNAVAILABLE" }
  | {
      type: "DISPATCH_READY",
      dispatchClaim: WorkerTaskDispatchClaim,
      cycleSettings: DashboardSettings,
      cycleProviderType: ProviderId
    }
  | {
      type: "HANDLE_ATTENTION",
      attentionItem: ProjectAttentionItemRecord,
      claimReason: string,
      attentionRoute: Exclude<VirtualWorkerAttentionRoute, "skip_orchestrator_handled">,
      cycleSettings: DashboardSettings,
      cycleProviderType: ProviderId
    };

export interface PlanVirtualWorkerCycleArgs {
  projectId: string;
  cycleReason: string;
  attentionItem: ProjectAttentionItemRecord | null;
  dispatchClaim: WorkerTaskDispatchClaim | null;
  isProviderConcurrencyAvailable: (providerId: ProviderId, limit: number) => Promise<boolean>;
  resolveSettings: (projectId: string, sprintId?: string | null) => DashboardSettings;
  resolveAttentionProviderCapacity?: (
    item: ProjectAttentionItemRecord,
    route: Exclude<VirtualWorkerAttentionRoute, "skip_orchestrator_handled">,
    settings: DashboardSettings,
  ) => Promise<{ provider: ProviderId; limit: number }>;
}

export async function planVirtualWorkerCycle(args: PlanVirtualWorkerCycleArgs): Promise<VirtualWorkerCycleAction> {
  if (!args.attentionItem && !args.dispatchClaim) {
    return { type: "NO_WORKER_NEEDED" };
  }

  if (args.attentionItem && isOrchestratorHandledClarificationItem(args.attentionItem.summaryMarkdown)) {
    return { type: "ORCHESTRATOR_HANDLED_CLARIFICATION" };
  }

  const attentionRoute = args.attentionItem
    ? resolveVirtualWorkerAttentionRoute(args.attentionItem)
    : null;
  if (attentionRoute === "skip_orchestrator_handled") {
    return { type: "ORCHESTRATOR_HANDLED_CLARIFICATION" };
  }

  // Determine which item is driving the settings scope. Repair attention takes
  // precedence over queued coding work so a failed CI gate cannot accidentally
  // relaunch the original task while its repair is waiting.
  const sprintId = args.dispatchClaim?.sprint.id || args.attentionItem?.sprintId;
  const cycleSettings = args.resolveSettings(args.projectId, sprintId);
  const providerConfigId = cycleSettings.workers.virtualWorkerProvider;
  const providerSettings = cycleSettings.aiProvider.providers[providerConfigId];
  let cycleProviderType = providerSettings?.provider || "codex";
  let limit = cycleSettings.workers.maxConcurrency;

  if (args.attentionItem && attentionRoute && args.resolveAttentionProviderCapacity) {
    const capacity = await args.resolveAttentionProviderCapacity(
      args.attentionItem,
      attentionRoute,
      cycleSettings,
    );
    cycleProviderType = capacity.provider;
    limit = capacity.limit;
  }

  if (!(await args.isProviderConcurrencyAvailable(cycleProviderType, limit))) {
    return { type: "PROVIDER_CONCURRENCY_UNAVAILABLE" };
  }

  if (args.attentionItem && attentionRoute) {
    return {
      type: "HANDLE_ATTENTION",
      attentionItem: args.attentionItem,
      claimReason: planVirtualWorkerAttentionClaim(args.attentionItem, args.cycleReason).claimReason,
      attentionRoute,
      cycleSettings,
      cycleProviderType
    };
  }

  if (args.dispatchClaim) {
    return {
      type: "DISPATCH_READY",
      dispatchClaim: args.dispatchClaim,
      cycleSettings,
      cycleProviderType
    };
  }

  return { type: "NO_WORKER_NEEDED" };
}
