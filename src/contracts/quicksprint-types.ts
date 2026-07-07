import type { PlanSprintOptions, SprintRecord } from "./project-management-types.js";

export interface QuicksprintTemplateRecord {
  id: string;
  projectId: string | null;
  name: string;
  description: string;
  icon: string;
  category: string;
  categoryColor?: string;
  agentInstructionMarkdown: string;
  defaultTaskCount: number;
  isBuiltIn: boolean;
  agentPresetId?: string;
  purpose?: string;
  purposeLabel?: string;
  purposeDescription?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateQuicksprintTemplateInput {
  name: string;
  description: string;
  icon: string;
  category: string;
  categoryColor?: string;
  agentInstructionMarkdown: string;
  defaultTaskCount?: number;
  agentPresetId?: string;
}

export interface UpdateQuicksprintTemplateInput {
  name?: string;
  description?: string;
  icon?: string;
  category?: string;
  categoryColor?: string;
  agentInstructionMarkdown?: string;
  defaultTaskCount?: number;
  agentPresetId?: string;
}

export interface QuicksprintExecutionInput {
  templateId: string;
  /** Ignored when noTaskLimit is set; kept required for backward compatibility. */
  taskCount: number;
  noTaskLimit?: boolean;
  submitMode: "plan_only" | "plan_and_start";
  clientRequestId?: string;
  routeOverride?: string;
  modelOverride?: string;
  planningOverrides?: import("./project-management-types.js").PlanningOverrides;
  agentPresetId?: string;
  additionalPrompt?: string;
}

export interface DetachedQuicksprintLaunchInput extends QuicksprintExecutionInput {
  clientRequestId?: string;
}

export interface DetachedQuicksprintPlanningRequest {
  projectId: string;
  sprintId: string;
  templateId: string;
  submitMode: QuicksprintExecutionInput["submitMode"];
  clientRequestId: string;
  planOptions: PlanSprintOptions;
}

export interface DetachedQuicksprintLaunchResult {
  sprint: SprintRecord;
  planningRequest: DetachedQuicksprintPlanningRequest;
  planningPromise: Promise<unknown>;
}
