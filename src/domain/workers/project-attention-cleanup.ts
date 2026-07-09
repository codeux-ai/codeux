import type { ProjectAttentionItemRecord } from "../../contracts/project-attention-types.js";
import type { ProjectAttentionService } from "./project-attention-service.js";

type TransientMergeAttentionService = Pick<ProjectAttentionService, "listActiveProjectItems" | "resolveItem">;
type TransientSourceAttentionType = "merge_conflict" | "ci_fix_required" | "manual_attention";

const DEFAULT_TRANSIENT_SOURCE_ATTENTION_TYPES: readonly TransientSourceAttentionType[] = [
  "merge_conflict",
  "ci_fix_required",
];

export function isTransientMergeAttentionHandoff(
  item: ProjectAttentionItemRecord,
  sourceAttentionTypes: readonly TransientSourceAttentionType[] = DEFAULT_TRANSIENT_SOURCE_ATTENTION_TYPES,
): boolean {
  if (
    item.attentionType !== "human_escalation_required"
    && item.attentionType !== "dashboard_reply_required"
  ) {
    return false;
  }

  const sourceAttentionType = item.payload?.sourceAttentionType;
  return sourceAttentionTypes.some((candidate) => candidate === sourceAttentionType);
}

export function resolveTransientMergeAttentionHandoffs(
  service: TransientMergeAttentionService,
  projectId: string,
  sprintRunId: string,
  reason: string,
  sourceAttentionTypes: readonly TransientSourceAttentionType[] = DEFAULT_TRANSIENT_SOURCE_ATTENTION_TYPES,
): number {
  let resolved = 0;
  const activeItems = service.listActiveProjectItems(projectId);
  for (const item of activeItems) {
    if (item.sprintRunId !== sprintRunId || !isTransientMergeAttentionHandoff(item, sourceAttentionTypes)) {
      continue;
    }
    service.resolveItem(item.id, { status: "resolved", reason });
    resolved += 1;
  }
  return resolved;
}
