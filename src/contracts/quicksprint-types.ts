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
  taskCount: number;
  submitMode: "plan_only" | "plan_and_start";
  routeOverride?: string;
  modelOverride?: string;
  planningOverrides?: import("./project-management-types.js").PlanningOverrides;
  agentPresetId?: string;
  additionalPrompt?: string;
}
