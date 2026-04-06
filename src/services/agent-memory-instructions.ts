export function resolveAgentMemoryInstructions(
  agent: { memoryTemplateOverrideEnabled?: boolean; memoryTemplateMarkdown?: string },
  defaultInstruction?: string
): string {
  if (agent.memoryTemplateOverrideEnabled && agent.memoryTemplateMarkdown?.trim()) {
    return agent.memoryTemplateMarkdown.trim();
  }
  return defaultInstruction?.trim() || "";
}
