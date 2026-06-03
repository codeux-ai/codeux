import type { AgentAvatarConfig, AgentMemoryConfig } from "../contracts/agent-preset-types.js";

export interface ParsedAgentMarkdown {
  description?: string;
  instructionMarkdown: string;
  avatarConfig?: AgentAvatarConfig;
  providerConfigId?: string | null;
  model?: string | null;
  memoryTemplateOverrideEnabled?: boolean;
  memoryTemplateMarkdown?: string;
  memoryConfig?: AgentMemoryConfig;
}

const FRONTMATTER_REGEX = /^---\s*json\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/i;

export function parseAgentMarkdown(rawMarkdown: string): ParsedAgentMarkdown {
  const match = rawMarkdown.match(FRONTMATTER_REGEX);
  if (!match) {
    return { instructionMarkdown: rawMarkdown };
  }

  const [, jsonBlock, body] = match;
  let parsedMetadata: any = {};
  try {
    parsedMetadata = JSON.parse(jsonBlock || "{}");
  } catch {
    // Graceful fallback to empty metadata if JSON is malformed
    parsedMetadata = {};
  }

  return {
    instructionMarkdown: body !== undefined ? body : "",
    description: typeof parsedMetadata.description === "string" ? parsedMetadata.description : undefined,
    avatarConfig: parsedMetadata.avatarConfig,
    providerConfigId: typeof parsedMetadata.providerConfigId === "string" ? parsedMetadata.providerConfigId : undefined,
    model: typeof parsedMetadata.model === "string" ? parsedMetadata.model : undefined,
    memoryTemplateOverrideEnabled: parsedMetadata.memoryTemplateOverrideEnabled,
    memoryTemplateMarkdown: parsedMetadata.memoryTemplateMarkdown,
    memoryConfig: parsedMetadata.memoryConfig,
  };
}

export function formatAgentMarkdown(input: ParsedAgentMarkdown): string {
  const hasAvatarConfig = input.avatarConfig !== undefined;
  const hasDescription = input.description !== undefined;
  const hasProviderConfigId = input.providerConfigId !== undefined && input.providerConfigId !== null;
  const hasModel = input.model !== undefined && input.model !== null;
  const hasMemoryTemplateOverrideEnabled = input.memoryTemplateOverrideEnabled !== undefined;
  const hasMemoryTemplateMarkdown = input.memoryTemplateMarkdown !== undefined;
  const hasMemoryConfig = input.memoryConfig !== undefined && input.memoryConfig !== null;

  if (!hasAvatarConfig && !hasDescription && !hasProviderConfigId && !hasModel && !hasMemoryTemplateOverrideEnabled && !hasMemoryTemplateMarkdown && !hasMemoryConfig) {
    return input.instructionMarkdown;
  }

  const metadata: any = {};
  if (hasDescription) {
    metadata.description = input.description;
  }
  if (hasAvatarConfig) {
    metadata.avatarConfig = input.avatarConfig;
  }
  if (hasProviderConfigId) {
    metadata.providerConfigId = input.providerConfigId;
  }
  if (hasModel) {
    metadata.model = input.model;
  }
  if (hasMemoryTemplateOverrideEnabled) {
    metadata.memoryTemplateOverrideEnabled = input.memoryTemplateOverrideEnabled;
  }
  if (hasMemoryTemplateMarkdown) {
    metadata.memoryTemplateMarkdown = input.memoryTemplateMarkdown;
  }
  if (hasMemoryConfig) {
    metadata.memoryConfig = input.memoryConfig;
  }

  const jsonFrontmatter = JSON.stringify(metadata, null, 2);
  return `---json\n${jsonFrontmatter}\n---\n${input.instructionMarkdown}`;
}
