import type { ProjectAttentionOwnerType, ProjectAttentionSeverity, ProjectAttentionType } from "../../../contracts/project-attention-types.js";

export function buildTaskAttentionPayload(params: {
  projectId: string;
  sprintId: string;
  sprintRunId: string;
  taskId?: string;
  attentionType: ProjectAttentionType;
  severity: ProjectAttentionSeverity;
  ownerType: ProjectAttentionOwnerType;
  title: string;
  summaryMarkdown: string;
  payload?: Record<string, unknown>;
}) {
  return {
    projectId: params.projectId,
    sprintId: params.sprintId,
    sprintRunId: params.sprintRunId,
    ...(params.taskId ? { taskId: params.taskId } : {}),
    attentionType: params.attentionType,
    severity: params.severity,
    ownerType: params.ownerType,
    title: params.title,
    summaryMarkdown: params.summaryMarkdown,
    ...(params.payload ? { payload: params.payload } : {}),
  };
}
