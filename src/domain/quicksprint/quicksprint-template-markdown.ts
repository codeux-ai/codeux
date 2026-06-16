import type { QuicksprintTemplateRecord } from "../../contracts/quicksprint-types.js";

type TemplateMetadata = Partial<Omit<QuicksprintTemplateRecord, "agentInstructionMarkdown">> & {
  agentInstructionMarkdown?: string;
};

export interface ParsedQuicksprintTemplateMarkdown {
  metadata: TemplateMetadata;
  agentInstructionMarkdown: string;
}

const FRONTMATTER_REGEX = /^---\s*json\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/i;

export function parseQuicksprintTemplateMarkdown(rawContent: string): ParsedQuicksprintTemplateMarkdown {
  const frontmatterMatch = rawContent.match(FRONTMATTER_REGEX);
  if (frontmatterMatch) {
    const [, jsonBlock, body] = frontmatterMatch;
    const metadata = parseMetadata(jsonBlock || "{}");
    const bodyMarkdown = typeof body === "string" ? body.trim() : "";
    return {
      metadata,
      agentInstructionMarkdown: bodyMarkdown || normalizeMarkdown(metadata.agentInstructionMarkdown),
    };
  }

  return {
    metadata: {},
    agentInstructionMarkdown: rawContent.trim(),
  };
}

export function formatQuicksprintTemplateMarkdown(template: QuicksprintTemplateRecord): string {
  const metadata: TemplateMetadata = {
    id: template.id,
    name: template.name,
    description: template.description,
    icon: template.icon,
    category: template.category,
    defaultTaskCount: template.defaultTaskCount,
  };

  if (template.categoryColor !== undefined) metadata.categoryColor = template.categoryColor;
  if (template.agentPresetId !== undefined) metadata.agentPresetId = template.agentPresetId;
  if (template.purpose !== undefined) metadata.purpose = template.purpose;
  if (template.purposeLabel !== undefined) metadata.purposeLabel = template.purposeLabel;
  if (template.purposeDescription !== undefined) metadata.purposeDescription = template.purposeDescription;
  if (template.createdAt) metadata.createdAt = template.createdAt;
  if (template.updatedAt) metadata.updatedAt = template.updatedAt;

  return `---json\n${JSON.stringify(metadata, null, 2)}\n---\n${template.agentInstructionMarkdown.trim()}\n`;
}

function parseMetadata(rawJson: string): TemplateMetadata {
  try {
    const parsed = JSON.parse(rawJson || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as TemplateMetadata
      : {};
  } catch {
    return {};
  }
}

function normalizeMarkdown(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
