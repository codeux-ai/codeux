import type { ManageCodeUxArgs, ManagementResponseEnvelope, SearchSkillsArgs } from "../../contracts/internal-management-types.js";
import type { SkillRecord, SkillSearchResult, SkillSourceType, SkillStorageKind } from "../../contracts/skill-types.js";
import type { SkillService } from "../../services/skill-service.js";
import {
  parseOptionalBoolean,
  parseOptionalEnumStrict,
  parseOptionalNullableString,
  parseOptionalNumber,
  parseOptionalString,
  parseRequiredString,
} from "./payload-parsers.js";

const STORAGE_KINDS = ["project", "shared"] as const satisfies readonly SkillStorageKind[];
const SOURCE_TYPES = ["manual", "imported", "generated"] as const satisfies readonly SkillSourceType[];

const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 500;
const DEFAULT_SEARCH_LIMIT = 10;
const MAX_SEARCH_LIMIT = 20;

export class SkillActions {
  constructor(private readonly skillService: SkillService) {}

  async handleSkillAction(args: ManageCodeUxArgs): Promise<ManagementResponseEnvelope> {
    const payload = args.payload || {};

    switch (args.action) {
      case "authoring_prompt":
        return this.authoringPrompt();
      case "list_storages":
        return this.listStorages(payload);
      case "get_storage":
        return this.getStorage(payload);
      case "create_storage":
        return this.createStorage(payload);
      case "update_storage":
        return this.updateStorage(payload);
      case "delete_storage":
        return this.deleteStorage(args, payload);
      case "reset_storage":
        return this.resetStorage(args, payload);
      case "list_agent_storages":
        return this.listAgentStorages(payload);
      case "attach_storage":
        return this.attachStorage(payload);
      case "detach_storage":
        return this.detachStorage(payload);
      case "list_skills":
        return this.listSkills(payload);
      case "get_skill":
        return this.getSkill(payload);
      case "create_skill":
      case "import_markdown":
        return this.writeSkillFromMarkdown(payload);
      case "update_skill":
        return this.writeSkillFromMarkdown(payload, true);
      case "delete_skill":
        return this.deleteSkill(args, payload);
      case "export_markdown":
        return this.exportMarkdown(payload);
      default:
        throw new Error(`Unknown skills action: ${args.action}`);
    }
  }

  async handleSearchSkills(
    args: SearchSkillsArgs,
    authenticatedAgentPresetId: string | null = null,
  ): Promise<ManagementResponseEnvelope> {
    const payload = args as unknown as Record<string, unknown>;
    const projectId = parseRequiredString(payload, "projectId");
    const query = parseRequiredString(payload, "query");
    const limit = normalizeLimit(args.limit, DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT);
    const minSimilarity = normalizeSimilarity(args.minSimilarity);
    const searchQuery = {
      projectId,
      query,
      agentPresetId: normalizeOptionalString(args.agentPresetId),
      storageId: normalizeOptionalString(args.storageId),
      limit,
      minSimilarity,
    };
    const results = authenticatedAgentPresetId
      ? await this.skillService.searchForAgent(searchQuery, authenticatedAgentPresetId)
      : await this.skillService.search(searchQuery);

    return {
      result: {
        results: results.map(formatSearchResult),
      },
    };
  }

  private authoringPrompt(): ManagementResponseEnvelope {
    return {
      result: {
        prompt: SKILL_AUTHORING_PROMPT,
      },
    };
  }

  private listStorages(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const projectId = parseRequiredString(payload, "projectId");
    return { result: { storages: this.skillService.listStorages(projectId) } };
  }

  private getStorage(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const projectId = parseRequiredString(payload, "projectId");
    const storageId = parseRequiredString(payload, "storageId");
    const storage = this.skillService.getStorage(projectId, storageId);
    if (!storage) {
      throw new Error(`Skill storage not found: ${storageId}`);
    }
    return { result: { storage } };
  }

  private createStorage(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const projectId = parseRequiredString(payload, "projectId");
    const storage = this.skillService.createStorage(projectId, {
      name: parseRequiredString(payload, "name"),
      description: parseOptionalString(payload, "description"),
      storageKind: parseOptionalEnumStrict<SkillStorageKind>(payload, "storageKind", STORAGE_KINDS),
    });
    return { result: { storage } };
  }

  private updateStorage(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const projectId = parseRequiredString(payload, "projectId");
    const storageId = parseRequiredString(payload, "storageId");
    const storage = this.skillService.updateStorage(projectId, storageId, {
      name: parseOptionalString(payload, "name"),
      description: parseOptionalString(payload, "description"),
      storageKind: parseOptionalEnumStrict<SkillStorageKind>(payload, "storageKind", STORAGE_KINDS),
    });
    return { result: { storage } };
  }

  private deleteStorage(args: ManageCodeUxArgs, payload: Record<string, unknown>): ManagementResponseEnvelope {
    const projectId = parseRequiredString(payload, "projectId");
    const storageId = parseRequiredString(payload, "storageId");
    if (args.approval?.confirmed !== true) {
      return {
        approvalRequired: true,
        approvalMessage: `Deleting skill storage ${storageId} removes its skills, embeddings, and agent attachments. Call again with approval.confirmed true after human approval.`,
      };
    }
    this.skillService.deleteStorage(projectId, storageId);
    return { result: { success: true } };
  }

  private async resetStorage(args: ManageCodeUxArgs, payload: Record<string, unknown>): Promise<ManagementResponseEnvelope> {
    const projectId = parseRequiredString(payload, "projectId");
    const storageId = parseRequiredString(payload, "storageId");
    if (args.approval?.confirmed !== true) {
      return {
        approvalRequired: true,
        approvalMessage: `Resetting skill storage ${storageId} deletes all skills and embeddings in that storage while keeping the storage and attachments. Call again with approval.confirmed true after human approval.`,
      };
    }
    const deletedSkills = await this.skillService.resetStorage(projectId, storageId);
    return { result: { success: true, deletedSkills } };
  }

  private listAgentStorages(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const projectId = parseRequiredString(payload, "projectId");
    const agentPresetId = parseRequiredString(payload, "agentPresetId");
    const attachments = this.skillService.listAttachmentsForAgent(projectId, agentPresetId);
    const attachedStorageIds = new Set(attachments.map((attachment) => attachment.storageId));
    return {
      result: {
        attachments,
        storages: this.skillService.listStorages(projectId).filter((storage) => attachedStorageIds.has(storage.id)),
      },
    };
  }

  private attachStorage(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const projectId = parseRequiredString(payload, "projectId");
    const agentPresetId = parseRequiredString(payload, "agentPresetId");
    const storageId = parseRequiredString(payload, "storageId");
    this.skillService.attachStorageToAgent(projectId, agentPresetId, storageId);
    return { result: { success: true } };
  }

  private detachStorage(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const projectId = parseRequiredString(payload, "projectId");
    const agentPresetId = parseRequiredString(payload, "agentPresetId");
    const storageId = parseRequiredString(payload, "storageId");
    this.skillService.detachStorageFromAgent(projectId, agentPresetId, storageId);
    return { result: { success: true } };
  }

  private listSkills(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const projectId = parseRequiredString(payload, "projectId");
    const storageId = parseRequiredString(payload, "storageId");
    const limit = normalizeLimit(parseOptionalNumber(payload, "limit"), DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
    const skills = this.skillService.listByStorage(projectId, storageId, limit).map(formatSkillSummary);
    return { result: { skills } };
  }

  private getSkill(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const projectId = parseRequiredString(payload, "projectId");
    const skillId = parseRequiredString(payload, "skillId");
    const skill = this.skillService.getSkill(projectId, skillId);
    if (!skill) {
      throw new Error(`Skill not found: ${skillId}`);
    }
    const includeContent = parseOptionalBoolean(payload, "includeContent") === true;
    return { result: { skill: includeContent ? skill : formatSkillSummary(skill) } };
  }

  private async writeSkillFromMarkdown(payload: Record<string, unknown>, requireSkillId = false): Promise<ManagementResponseEnvelope> {
    const projectId = parseRequiredString(payload, "projectId");
    const storageId = parseRequiredString(payload, "storageId");
    const skillId = requireSkillId ? parseRequiredString(payload, "skillId") : parseOptionalString(payload, "skillId");
    const markdown = parseRequiredString(payload, "markdown");
    const skill = await this.skillService.writeSkillFromMarkdown(projectId, storageId, markdown, {
      skillId,
      sourceType: parseOptionalEnumStrict<SkillSourceType>(payload, "sourceType", SOURCE_TYPES),
      sourceRef: parseOptionalNullableString(payload, "sourceRef"),
    });
    return { result: { skill: formatSkillSummary(skill) } };
  }

  private async deleteSkill(args: ManageCodeUxArgs, payload: Record<string, unknown>): Promise<ManagementResponseEnvelope> {
    const projectId = parseRequiredString(payload, "projectId");
    const skillId = parseRequiredString(payload, "skillId");
    if (args.approval?.confirmed !== true) {
      return {
        approvalRequired: true,
        approvalMessage: `Deleting skill ${skillId} removes its stored markdown and embeddings. Call again with approval.confirmed true after human approval.`,
      };
    }
    await this.skillService.deleteSkill(projectId, skillId);
    return { result: { success: true } };
  }

  private exportMarkdown(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const projectId = parseRequiredString(payload, "projectId");
    const skillId = parseRequiredString(payload, "skillId");
    return { result: { markdown: this.skillService.renderSkillToMarkdown(projectId, skillId) } };
  }
}

function normalizeLimit(value: number | undefined, defaultValue: number, maxValue: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return defaultValue;
  }
  return Math.min(Math.floor(value), maxValue);
}

function normalizeSimilarity(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : undefined;
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function formatSkillSummary(skill: SkillRecord): Record<string, unknown> {
  return {
    id: skill.id,
    projectId: skill.projectId,
    storageId: skill.storageId,
    name: skill.name,
    description: skill.description,
    sourceType: skill.sourceType,
    sourceRef: skill.sourceRef,
    tags: skill.tags,
    appliesTo: skill.appliesTo,
    version: skill.version,
    contentHash: skill.contentHash,
    createdAt: skill.createdAt,
    updatedAt: skill.updatedAt,
    summary: summarizeMarkdown(skill.contentMarkdown),
  };
}

function formatSearchResult(result: SkillSearchResult): Record<string, unknown> {
  return {
    similarity: result.similarity,
    skill: formatSkillSummary(result.skill),
  };
}

function summarizeMarkdown(markdown: string): string {
  const normalized = markdown.replace(/\s+/g, " ").trim();
  if (normalized.length <= 240) {
    return normalized;
  }
  return `${normalized.slice(0, 237).trimEnd()}...`;
}

const SKILL_AUTHORING_PROMPT = `You are authoring a persistent Code UX skill.

Purpose:
- A skill is durable operational guidance that agents can retrieve later through search_skills.
- Store reusable procedures, review checklists, domain conventions, troubleshooting playbooks, or project-specific engineering rules.
- Do not write skill files into the project workspace. Save them to persistent Code UX skill storage through manage_skills.

Markdown format:
\`\`\`md
---
title: Short Skill Name
description: One sentence describing when to use this skill.
tags: ["review", "testing", "backend"]
appliesTo: ["src/services", "tests/backend"]
version: 1.0.0
---

Write the actual skill instructions here.

Use concise headings, concrete steps, validation commands, known pitfalls, and examples when they help future agents act correctly.
\`\`\`

Frontmatter fields:
- title: Required by convention. Used as the persistent skill name. If omitted, Code UX stores "Untitled skill".
- description: Optional concise retrieval hint.
- tags: Optional list of searchable labels.
- appliesTo: Optional list of paths, modules, subsystems, or agent roles the skill applies to.
- version: Optional skill version string.

Authoring guidance:
- Keep instructions durable. Avoid one-off task status, temporary branch names, secrets, credentials, or private customer names.
- Prefer specific procedures over broad advice.
- Include verification commands only when they are stable for this repository or subsystem.
- Keep the body focused enough that search_skills can return a useful summary.

Saving workflow:
1. Find or create a storage with manage_skills list_storages or create_storage.
2. Save the markdown with manage_skills import_markdown or create_skill using projectId, storageId, and markdown.
3. Attach the storage to an agent with manage_skills attach_storage when that agent should retrieve the skill.
4. Use search_skills with projectId and optional agentPresetId to verify retrieval.

Updating workflow:
1. Export the current markdown with manage_skills export_markdown using projectId and skillId.
2. Edit the markdown content in the tool payload, not as a workspace file.
3. Save it with manage_skills update_skill or import_markdown with skillId, projectId, storageId, and markdown.`;
