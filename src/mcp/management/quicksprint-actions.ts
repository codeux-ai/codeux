import type { ManageCodeUxArgs, ManagementResponseEnvelope } from "../../contracts/internal-management-types.js";
import type {
  CreateQuicksprintTemplateInput,
  QuicksprintExecutionInput,
  UpdateQuicksprintTemplateInput,
} from "../../contracts/quicksprint-types.js";
import type { QuicksprintService } from "../../services/quicksprint-service.js";

function readString(payload: Record<string, unknown>, key: string): string | undefined {
  return typeof payload[key] === "string" ? payload[key].trim() : undefined;
}

function readRequiredString(payload: Record<string, unknown>, key: string): string {
  const value = readString(payload, key);
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
}

function parsePositiveInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(1, Math.floor(value));
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return Math.max(1, Math.floor(parsed));
    }
  }
  return undefined;
}

function readPositiveInteger(payload: Record<string, unknown>, key: string, fallback: number): number {
  return parsePositiveInteger(payload[key]) ?? fallback;
}

function readSubmitMode(value: unknown, fallback: QuicksprintExecutionInput["submitMode"]): QuicksprintExecutionInput["submitMode"] {
  return value === "plan_only" || value === "plan_and_start" ? value : fallback;
}

function normalizeCreateTemplateInput(payload: Record<string, unknown>): CreateQuicksprintTemplateInput {
  const input: CreateQuicksprintTemplateInput = {
    name: readRequiredString(payload, "name"),
    description: readRequiredString(payload, "description"),
    icon: readRequiredString(payload, "icon"),
    category: readRequiredString(payload, "category"),
    agentInstructionMarkdown: readRequiredString(payload, "agentInstructionMarkdown"),
  };
  const categoryColor = readString(payload, "categoryColor");
  const agentPresetId = readString(payload, "agentPresetId");

  if (categoryColor) input.categoryColor = categoryColor;
  if ("defaultTaskCount" in payload) {
    input.defaultTaskCount = readPositiveInteger(payload, "defaultTaskCount", 5);
  }
  if (agentPresetId) input.agentPresetId = agentPresetId;
  return input;
}

function normalizeUpdateTemplateInput(payload: Record<string, unknown>): UpdateQuicksprintTemplateInput {
  const input: UpdateQuicksprintTemplateInput = {};
  const stringFields = ["name", "description", "icon", "category", "categoryColor", "agentInstructionMarkdown", "agentPresetId"] as const;
  for (const field of stringFields) {
    if (field in payload) {
      const value = readString(payload, field);
      if (value) {
        input[field] = value;
      }
    }
  }
  const defaultTaskCount = readPositiveInteger(payload, "defaultTaskCount", 0);
  if (defaultTaskCount > 0) {
    input.defaultTaskCount = defaultTaskCount;
  }
  return input;
}

function normalizeExecutionInput(payload: Record<string, unknown>, fallbackSubmitMode: QuicksprintExecutionInput["submitMode"]): QuicksprintExecutionInput {
  const input: QuicksprintExecutionInput = {
    templateId: readRequiredString(payload, "templateId"),
    taskCount: readPositiveInteger(payload, "taskCount", 5),
    submitMode: readSubmitMode(payload.submitMode, fallbackSubmitMode),
  };
  const routeOverride = readString(payload, "routeOverride");
  const modelOverride = readString(payload, "modelOverride");
  const agentPresetId = readString(payload, "agentPresetId");
  const additionalPrompt = readString(payload, "additionalPrompt");

  if (routeOverride) input.routeOverride = routeOverride;
  if (modelOverride) input.modelOverride = modelOverride;
  if (agentPresetId) input.agentPresetId = agentPresetId;
  if (additionalPrompt) input.additionalPrompt = additionalPrompt;
  if (typeof payload.planningOverrides === "object" && payload.planningOverrides !== null) {
    input.planningOverrides = payload.planningOverrides as QuicksprintExecutionInput["planningOverrides"];
  }
  return input;
}

export class QuicksprintActions {
  constructor(private readonly quicksprintService: QuicksprintService) {}

  async handleQuicksprintAction(args: ManageCodeUxArgs): Promise<ManagementResponseEnvelope> {
    const payload = args.payload || {};

    switch (args.action) {
      case "list_templates": {
        const projectId = readRequiredString(payload, "projectId");
        const templates = await this.quicksprintService.listTemplates(projectId);
        return { result: { templates } };
      }
      case "get_template": {
        const projectId = readRequiredString(payload, "projectId");
        const templateId = readRequiredString(payload, "templateId");
        const template = await this.quicksprintService.getTemplate(projectId, templateId);
        if (!template) {
          throw new Error(`Template not found: ${templateId}`);
        }
        return { result: { template } };
      }
      case "create_template": {
        const projectId = readRequiredString(payload, "projectId");
        const template = await this.quicksprintService.createCustomTemplate(projectId, normalizeCreateTemplateInput(payload));
        return { result: { template } };
      }
      case "update_template": {
        const projectId = readRequiredString(payload, "projectId");
        const templateId = readRequiredString(payload, "templateId");
        const template = await this.quicksprintService.updateCustomTemplate(projectId, templateId, normalizeUpdateTemplateInput(payload));
        return { result: { template } };
      }
      case "delete_template": {
        const projectId = readRequiredString(payload, "projectId");
        const templateId = readRequiredString(payload, "templateId");
        if (args.approval?.confirmed !== true) {
          return {
            approvalRequired: true,
            approvalMessage: `Deleting quicksprint template '${templateId}' requires explicit human confirmation. Ask the user to confirm, then call this exact action again with approval.confirmed set to true.`,
          };
        }
        await this.quicksprintService.deleteCustomTemplate(projectId, templateId);
        return { result: { status: "success", deletedTemplateId: templateId } };
      }
      case "execute":
      case "start": {
        const projectId = readRequiredString(payload, "projectId");
        const fallbackSubmitMode = args.action === "start" ? "plan_and_start" : "plan_only";
        const sprint = await this.quicksprintService.executeQuicksprint(projectId, normalizeExecutionInput(payload, fallbackSubmitMode));
        return { result: { status: "success", sprint } };
      }
      default:
        throw new Error(`Unknown quicksprint action: ${args.action}`);
    }
  }
}
