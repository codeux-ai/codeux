import type { CiIntelligenceSettings } from "../../../contracts/app-types.js";
import type { MergeFeedbackResult } from "../ci/main-merge-gate.js";
import type { SprintOrchestratorDependencies } from "../../../sprint/sprint-orchestrator.js";
import { transitionSprintRun } from "./sprint-run-transitions.js";
import { buildConflictSummaryMarkdown } from "./conflict-summary-utils.js";

export function resolveMainMergeConflictAttentionItems(
  projectAttentionService: {
    listActiveProjectItems: (projectId: string) => Array<{
      id: string;
      sprintRunId: string | null;
      attentionType: string;
      summaryMarkdown: string;
      payload: Record<string, unknown> | null;
    }>;
    resolveItem: (itemId: string, input?: {
      status?: "resolved" | "dismissed" | "expired";
      reason?: string;
      resolutionSummaryMarkdown?: string;
      workerEndpointId?: string | null;
      payloadPatch?: Record<string, unknown> | null;
    }) => unknown;
  },
  projectId: string,
  sprintRunId: string,
): void {
  const activeItems = projectAttentionService.listActiveProjectItems(projectId);
  for (const item of activeItems) {
    if (item.sprintRunId !== sprintRunId) {
      continue;
    }
    if (!isMainMergeAttentionItem(item)) {
      continue;
    }

    projectAttentionService.resolveItem(item.id, {
      status: "resolved",
      reason: "main_merge_conflict_cleared",
      resolutionSummaryMarkdown: [
        item.summaryMarkdown.trim(),
        "",
        "Resolved automatically because the main branch merge conflict no longer exists.",
      ].filter(Boolean).join("\n"),
    });
  }
}

export function collectActiveMainMergeAttentionItems(
  projectAttentionService: {
    listActiveProjectItems: (projectId: string) => Array<{
      id: string;
      sprintRunId: string | null;
      attentionType: string;
      ownerType?: string;
      status?: string;
      summaryMarkdown: string;
      payload: Record<string, unknown> | null;
    }>;
  },
  projectId: string,
  sprintRunId: string,
): Array<{
  id: string;
  sprintRunId: string | null;
  attentionType: string;
  summaryMarkdown: string;
  payload: Record<string, unknown> | null;
}> {
  return projectAttentionService.listActiveProjectItems(projectId).filter((item) => (
    item.sprintRunId === sprintRunId && isMainMergeAttentionItem(item)
  ));
}

export function isMainMergeAttentionItem(item: {
  attentionType: string;
  payload: Record<string, unknown> | null;
}): boolean {
  const payload = item.payload || {};
  const isMainMergeConflict = item.attentionType === "merge_conflict" && payload.mergeStage === "main";
  const isMainMergeConflictHandoff = (
    (item.attentionType === "human_escalation_required" || item.attentionType === "dashboard_reply_required")
    && payload.sourceAttentionType === "merge_conflict"
    && payload.mergeStage === "main"
  );
  return isMainMergeConflict || isMainMergeConflictHandoff;
}

export function pauseSprintRunForMainMergeBlocker(args: {
  executionRepository: Pick<SprintOrchestratorDependencies["executionRepository"], "updateSprintRun" | "appendSprintRunEvent">;
  sprintRunId: string;
  sprintNumber: number;
  mergeFeedback: MergeFeedbackResult;
  attentionItems: Array<{ id: string; attentionType: string }>;
}): void {
  transitionSprintRun(
    args.executionRepository,
    args.sprintRunId,
    "paused",
    "sprint_paused",
    {
      reason: "main_merge_blocked",
      sprintNumber: args.sprintNumber,
      mainMergeState: args.mergeFeedback.state,
      prNumber: args.mergeFeedback.prNumber,
      prUrl: args.mergeFeedback.prUrl,
      hasMergeConflict: args.mergeFeedback.hasMergeConflict,
      attentionItemIds: args.attentionItems.map((item) => item.id),
      attentionTypes: args.attentionItems.map((item) => item.attentionType),
    },
    `sprint-paused:${args.sprintRunId}:main-merge-blocked:${args.mergeFeedback.state}:${args.mergeFeedback.prNumber || "none"}`
  );
}

export function shouldKeepWatchLoopAliveForMainMerge(
  mode: CiIntelligenceSettings["mainBranchAutoMergeMode"],
  mergeFeedback: MergeFeedbackResult,
): boolean {
  if (mode !== "WHEN_GREEN" && mode !== "ALWAYS") {
    return false;
  }

  return (
    mergeFeedback.state === "missing_pr"
    || mergeFeedback.state === "pending_checks"
    || mergeFeedback.state === "ready_for_merge"
    || mergeFeedback.state === "automerge_scheduled"
    || mergeFeedback.state === "automerge_failed"
  );
}

export function shouldPauseForMainMergeBlocker(
  mergeFeedback: MergeFeedbackResult,
  attentionItems: Array<{ id: string }>,
): boolean {
  return (
    attentionItems.length > 0
    || mergeFeedback.state === "merge_conflict"
    || mergeFeedback.state === "failed_checks"
    || mergeFeedback.state === "review_blocked"
  );
}

export function buildMainMergeConflictSummary(args: {
  repoPath: string;
  featureBranch: string;
  defaultBranch: string;
  prNumber: number | null;
  prUrl: string | null;
  mergedTaskContexts: Array<{
    taskKey: string;
    taskTitle: string;
    taskPrompt: string;
    workerBranch: string | null;
    prUrl: string | null;
  }>;
}): string {
  return buildConflictSummaryMarkdown({
    repoPath: args.repoPath,
    workingDir: `cd ${args.repoPath}`,
    conflictingBranches: {
      source: args.featureBranch,
      target: args.defaultBranch,
    },
    prInfo: {
      number: args.prNumber,
      url: args.prUrl,
    },
    mergedTaskContexts: args.mergedTaskContexts,
    isMainMerge: true,
  });
}
