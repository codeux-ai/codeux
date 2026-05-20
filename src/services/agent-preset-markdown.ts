import type { AgentAvatarConfig } from "../contracts/agent-preset-types.js";

export interface ParsedAgentMarkdown {
  description?: string;
  instructionMarkdown: string;
  avatarConfig?: AgentAvatarConfig;
  memoryTemplateOverrideEnabled?: boolean;
  memoryTemplateMarkdown?: string;
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
    memoryTemplateOverrideEnabled: parsedMetadata.memoryTemplateOverrideEnabled,
    memoryTemplateMarkdown: parsedMetadata.memoryTemplateMarkdown,
  };
}

export function formatAgentMarkdown(input: ParsedAgentMarkdown): string {
  const hasAvatarConfig = input.avatarConfig !== undefined;
  const hasDescription = input.description !== undefined;
  const hasMemoryTemplateOverrideEnabled = input.memoryTemplateOverrideEnabled !== undefined;
  const hasMemoryTemplateMarkdown = input.memoryTemplateMarkdown !== undefined;

  if (!hasAvatarConfig && !hasDescription && !hasMemoryTemplateOverrideEnabled && !hasMemoryTemplateMarkdown) {
    return input.instructionMarkdown;
  }

  const metadata: any = {};
  if (hasDescription) {
    metadata.description = input.description;
  }
  if (hasAvatarConfig) {
    metadata.avatarConfig = input.avatarConfig;
  }
  if (hasMemoryTemplateOverrideEnabled) {
    metadata.memoryTemplateOverrideEnabled = input.memoryTemplateOverrideEnabled;
  }
  if (hasMemoryTemplateMarkdown) {
    metadata.memoryTemplateMarkdown = input.memoryTemplateMarkdown;
  }

  const jsonFrontmatter = JSON.stringify(metadata, null, 2);
  return `---json\n${jsonFrontmatter}\n---\n${input.instructionMarkdown}`;
}
