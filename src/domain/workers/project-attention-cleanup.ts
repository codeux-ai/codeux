import type { ProjectAttentionItemRecord } from "../../contracts/project-attention-types.js";
import type { ProjectAttentionService } from "./project-attention-service.js";

type TransientMergeAttentionService = Pick<ProjectAttentionService, "listActiveProjectItems" | "resolveItem">;

export function isTransientMergeAttentionHandoff(item: ProjectAttentionItemRecord): boolean {
  if (
    item.attentionType !== "human_escalation_required"
    && item.attentionType !== "dashboard_reply_required"
  ) {
    return false;
  }

  const sourceAttentionType = item.payload?.sourceAttentionType;
  return sourceAttentionType === "merge_conflict" || sourceAttentionType === "ci_fix_required";
}

export function resolveTransientMergeAttentionHandoffs(
  service: TransientMergeAttentionService,
  projectId: string,
  sprintRunId: string,
  reason: string,
): number {
  let resolved = 0;
  const activeItems = service.listActiveProjectItems(projectId);
  for (const item of activeItems) {
    if (item.sprintRunId !== sprintRunId || !isTransientMergeAttentionHandoff(item)) {
      continue;
    }
    service.resolveItem(item.id, { status: "resolved", reason });
    resolved += 1;
  }
  return resolved;
}
