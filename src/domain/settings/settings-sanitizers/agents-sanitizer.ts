import type { ProjectSettings } from "../../../contracts/settings-scope-types.js";
import { readBoolean, readString } from "../../../shared/config/value-readers.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../repositories/settings-defaults.js";
import { type InstructionTemplateId, INSTRUCTION_TEMPLATE_IDS, DEFAULT_INSTRUCTION_TEMPLATES } from "../../../instructions/instruction-template-catalog.js";

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function cloneInstructionTemplates(
  templates: Record<InstructionTemplateId, string>,
): Record<InstructionTemplateId, string> {
  return { ...templates };
}

export function cloneQualityAssuranceSettings(
  settings: ProjectSettings["agents"]["qualityAssurance"],
): ProjectSettings["agents"]["qualityAssurance"] {
  return {
    enabled: settings.enabled,
    maxTaskReviewRuns: settings.maxTaskReviewRuns,
    taskCompletion: { ...settings.taskCompletion },
    sprintCompletion: { ...settings.sprintCompletion },
    completedTaskWithoutPr: { ...settings.completedTaskWithoutPr },
  };
}

export function sanitizeInstructionTemplates(value: unknown): Record<InstructionTemplateId, string> {
  const input = toRecord(value);
  const result = { ...DEFAULT_INSTRUCTION_TEMPLATES };

  for (const id of INSTRUCTION_TEMPLATE_IDS) {
    if (typeof input[id] === "string" && input[id].trim().length > 0) {
      result[id] = input[id].trim();
    }
  }

  return result;
}

export function sanitizeQualityAssuranceTriggerSettings(
  value: unknown,
  defaults: ProjectSettings["agents"]["qualityAssurance"]["taskCompletion"],
): ProjectSettings["agents"]["qualityAssurance"]["taskCompletion"] {
  const input = toRecord(value);

  return {
    enabled: typeof input.enabled === "boolean"
      ? input.enabled
      : defaults.enabled,
    agentPresetId: typeof input.agentPresetId === "string" && input.agentPresetId.trim().length > 0
      ? input.agentPresetId.trim()
      : defaults.agentPresetId,
  };
}

export function sanitizeQualityAssuranceSettings(
  value: unknown,
): ProjectSettings["agents"]["qualityAssurance"] {
  const input = toRecord(value);
  const defaults = DEFAULT_DASHBOARD_SETTINGS.agents.qualityAssurance;

  return {
    enabled: typeof input.enabled === "boolean"
      ? input.enabled
      : defaults.enabled,
    maxTaskReviewRuns: typeof input.maxTaskReviewRuns === "number" && Number.isFinite(input.maxTaskReviewRuns)
      ? Math.max(1, Math.min(10, Math.round(input.maxTaskReviewRuns)))
      : defaults.maxTaskReviewRuns,
    taskCompletion: sanitizeQualityAssuranceTriggerSettings(input.taskCompletion, defaults.taskCompletion),
    sprintCompletion: sanitizeQualityAssuranceTriggerSettings(input.sprintCompletion, defaults.sprintCompletion),
    completedTaskWithoutPr: sanitizeQualityAssuranceTriggerSettings(input.completedTaskWithoutPr, defaults.completedTaskWithoutPr),
  };
}
