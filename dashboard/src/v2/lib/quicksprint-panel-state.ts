import type { QuicksprintTemplateRecord } from "../../../../src/contracts/quicksprint-types.js";
import type { AgentPreset } from "../types.js";

export type BuiltinPurposeOption = {
  value: string;
  label: string;
  description?: string;
};

export function getBuiltinTemplates(templates: QuicksprintTemplateRecord[]): QuicksprintTemplateRecord[] {
  return templates.filter((t) => t.isBuiltIn);
}

export function getCustomTemplates(templates: QuicksprintTemplateRecord[]): QuicksprintTemplateRecord[] {
  return templates.filter((t) => !t.isBuiltIn);
}

export function getBuiltinPurposeOptions(builtinTemplates: QuicksprintTemplateRecord[]): BuiltinPurposeOption[] {
  const purposes = new Map<string, BuiltinPurposeOption>();
  for (const template of builtinTemplates) {
    const value = template.purpose || "general";
    if (purposes.has(value)) {
      continue;
    }
    purposes.set(value, {
      value,
      label: template.purposeLabel || "General",
      description: template.purposeDescription,
    });
  }
  return Array.from(purposes.values());
}

export function getActiveBuiltinPurpose(options: BuiltinPurposeOption[], selectedValue: string): BuiltinPurposeOption | null {
  return options.find((option) => option.value === selectedValue) || options[0] || null;
}

export function getVisibleBuiltinTemplates(
  builtinTemplates: QuicksprintTemplateRecord[],
  activePurpose: BuiltinPurposeOption | null
): QuicksprintTemplateRecord[] {
  if (!activePurpose) {
    return builtinTemplates;
  }
  return builtinTemplates.filter((template) => (template.purpose || "general") === activePurpose.value);
}

export function getCombinedPrompt(
  selectedTemplate: QuicksprintTemplateRecord | null,
  agentPresets: AgentPreset[],
  additionalPrompt: string,
  taskCount: number
): string {
  if (!selectedTemplate) return "";
  const parts: string[] = [];

  const effectiveAgentPresetId = selectedTemplate.agentPresetId;
  if (effectiveAgentPresetId) {
    const agent = agentPresets.find((p) => p.id === effectiveAgentPresetId);
    if (agent?.instructionMarkdown) {
      parts.push(`## Agent Context\n\nYou are operating as the "${agent.name}" agent. Follow these agent-specific instructions:\n\n${agent.instructionMarkdown}\n\n---`);
    }
  }

  if (selectedTemplate.agentInstructionMarkdown) {
    parts.push(selectedTemplate.agentInstructionMarkdown);
  }

  if (additionalPrompt.trim()) {
    parts.push(`## Additional Instructions\n\n${additionalPrompt.trim()}`);
  }

  parts.push(`Produce exactly ${taskCount} subtasks.`);

  return parts.join("\n\n");
}
