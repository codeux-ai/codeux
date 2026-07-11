import { SkillRepository } from "../repositories/skill-repository.js";
import {
  buildPersistentSkillStorageContainerPath,
} from "../infrastructure/providers/cli/workspace-manager.js";
import { bufferToFloat32, cosineSimilarity, float32ToBuffer } from "./embedding-vector-utils.js";
import { parseSkillMarkdown, renderSkillMarkdown } from "./skill-markdown-parser.js";
import { createLogger, type Logger } from "../shared/logging/logger.js";
import { buildPersistentSkillStorageInstruction } from "./persistent-skill-context.js";
import { ValidationError } from "../repositories/repository-utils.js";
import { SkillStorageVersionControlService } from "./skill-storage-version-control-service.js";
import { KnowledgeIngestionService } from "./knowledge-ingestion-service.js";
import type {
  CreateSkillStorageInput,
  SkillRecord,
  SkillSearchQuery,
  SkillSearchResult,
  SkillSourceType,
  SkillStorageRecord,
  UpdateSkillStorageInput,
  AgentSkillStorageAttachment,
} from "../contracts/skill-types.js";

export interface SkillEmbeddingProvider {
  isLoaded(): boolean;
  getLoadedModelId(): string | null;
  embed(text: string): Promise<Float32Array>;
}

export interface WriteSkillMarkdownOptions {
  skillId?: string;
  sourceType?: SkillSourceType;
  sourceRef?: string | null;
}

export interface PersistentSkillStorageRuntimeMount {
  storageId: string;
  storageName: string;
  hostPath: string;
  containerPath: string;
  revision: string;
}

export interface PersistentSkillStorageRuntime {
  projectId: string;
  agentPresetId: string;
  mounts: PersistentSkillStorageRuntimeMount[];
  instructionMarkdown: string;
}

const MAX_SEARCH_CANDIDATES = 10000;
const MAX_SKILL_BODY_CHUNKS = 64;

export class SkillService {
  constructor(
    private readonly skillRepository: SkillRepository,
    private readonly embeddingService: SkillEmbeddingProvider,
    private readonly logger: Logger = createLogger({ bindings: { component: "SkillService" } }),
    private readonly versionControl: SkillStorageVersionControlService = new SkillStorageVersionControlService(),
  ) {}

  createStorage(projectId: string, input: CreateSkillStorageInput): SkillStorageRecord {
    return this.skillRepository.createStorage(projectId, input);
  }

  listStorages(projectId: string): SkillStorageRecord[] {
    return this.skillRepository.listStorages(projectId);
  }

  getStorage(projectId: string, storageId: string): SkillStorageRecord | null {
    return this.skillRepository.getStorage(projectId, storageId);
  }

  updateStorage(projectId: string, storageId: string, input: UpdateSkillStorageInput): SkillStorageRecord {
    return this.skillRepository.updateStorage(projectId, storageId, input);
  }

  deleteStorage(projectId: string, storageId: string): void {
    this.skillRepository.deleteStorage(projectId, storageId);
  }

  attachStorageToAgent(projectId: string, agentPresetId: string, storageId: string): void {
    this.skillRepository.attachStorageToAgent(projectId, agentPresetId, storageId);
  }

  detachStorageFromAgent(projectId: string, agentPresetId: string, storageId: string): void {
    this.skillRepository.detachStorageFromAgent(projectId, agentPresetId, storageId);
  }

  listAttachmentsForAgent(projectId: string, agentPresetId: string): AgentSkillStorageAttachment[] {
    return this.skillRepository.listAttachmentsForAgent(projectId, agentPresetId);
  }

  async resolvePersistentSkillStorageRuntime(args: {
    projectId: string;
    agentPresetId: string;
    enabled: boolean;
  }): Promise<PersistentSkillStorageRuntime | null> {
    if (!args.enabled || !args.projectId.trim() || !args.agentPresetId.trim()) {
      return null;
    }

    const attachments = this.skillRepository
      .listStoragesForAgent(args.projectId, args.agentPresetId)
      .filter((storage) => Boolean(storage.id.trim()));
    if (attachments.length === 0) {
      return null;
    }

    const mounts: PersistentSkillStorageRuntimeMount[] = [];
    for (const storage of attachments) {
      const skills = this.skillRepository.listSkills(args.projectId, storage.id, MAX_SEARCH_CANDIDATES);
      const snapshot = await this.versionControl.synchronize(args.projectId, storage, skills);
      const hostPath = snapshot.repositoryPath;
      mounts.push({
        storageId: storage.id,
        storageName: storage.name,
        hostPath,
        containerPath: buildPersistentSkillStorageContainerPath(storage.id),
        revision: snapshot.revision,
      });
    }

    return {
      projectId: args.projectId,
      agentPresetId: args.agentPresetId,
      mounts,
      instructionMarkdown: buildPersistentSkillStorageInstruction(args.projectId, args.agentPresetId, mounts),
    };
  }

  async writeSkillFromMarkdown(
    projectId: string,
    storageId: string,
    markdown: string,
    options: WriteSkillMarkdownOptions = {},
  ): Promise<SkillRecord> {
    const currentSkill = options.skillId ? this.requireSkill(projectId, options.skillId) : null;
    const parsed = parseSkillMarkdown(markdown);
    const name = parsed.title || "Untitled skill";
    if (currentSkill && currentSkill.storageId !== storageId) {
      throw new Error(
        `Skill ${currentSkill.id} belongs to storage ${currentSkill.storageId}; moving skills between storages is not supported by writeSkillFromMarkdown`,
      );
    }
    const input = {
      name,
      description: parsed.description,
      contentMarkdown: parsed.bodyMarkdown,
      sourceType: options.sourceType ?? currentSkill?.sourceType ?? "manual",
      sourceRef: options.sourceRef === undefined ? currentSkill?.sourceRef ?? null : options.sourceRef,
      tags: parsed.tags,
      appliesTo: parsed.appliesTo,
      version: parsed.version,
    };

    const skill = options.skillId
      ? this.skillRepository.updateSkill(projectId, options.skillId, input)
      : this.skillRepository.createSkill(projectId, storageId, input);

    await this.embedSkillIfAvailable(skill);
    const persisted = this.skillRepository.getSkill(projectId, skill.id) ?? skill;
    await this.synchronizeStorage(projectId, storageId, options.skillId ? `skill: update ${persisted.name}` : `skill: add ${persisted.name}`);
    return persisted;
  }

  renderSkillToMarkdown(projectId: string, skillId: string): string {
    const skill = this.requireSkill(projectId, skillId);
    return renderSkillMarkdown(skill);
  }

  getSkill(projectId: string, skillId: string): SkillRecord | null {
    return this.skillRepository.getSkill(projectId, skillId);
  }

  listByStorage(projectId: string, storageId: string, limit?: number): SkillRecord[] {
    return this.skillRepository.listSkills(projectId, storageId, limit);
  }

  listByAgent(projectId: string, agentPresetId: string, limit = 200): SkillRecord[] {
    const storages = this.skillRepository.listStoragesForAgent(projectId, agentPresetId);
    const results: SkillRecord[] = [];
    for (const storage of storages) {
      if (results.length >= limit) {
        break;
      }
      results.push(...this.skillRepository.listSkills(projectId, storage.id, limit - results.length));
    }
    return results;
  }

  listByProject(projectId: string, limit = 1000): SkillRecord[] {
    const results: SkillRecord[] = [];
    for (const storage of this.skillRepository.listStorages(projectId)) {
      if (results.length >= limit) break;
      results.push(...this.skillRepository.listSkills(projectId, storage.id, limit - results.length));
    }
    return results;
  }

  async deleteSkill(projectId: string, skillId: string): Promise<void> {
    const skill = this.requireSkill(projectId, skillId);
    this.skillRepository.deleteSkill(projectId, skillId);
    await this.synchronizeStorage(projectId, skill.storageId, `skill: delete ${skill.name}`);
  }

  async resetStorage(projectId: string, storageId: string): Promise<number> {
    const skills = this.skillRepository.listSkills(projectId, storageId, MAX_SEARCH_CANDIDATES);
    for (const skill of skills) {
      this.skillRepository.deleteSkill(projectId, skill.id);
    }
    await this.synchronizeStorage(projectId, storageId, "skill: reset storage");
    return skills.length;
  }

  private async synchronizeStorage(projectId: string, storageId: string, commitMessage: string): Promise<void> {
    const storage = this.skillRepository.getStorage(projectId, storageId);
    if (!storage) {
      return;
    }
    const skills = this.skillRepository.listSkills(projectId, storageId, MAX_SEARCH_CANDIDATES);
    await this.versionControl.synchronize(projectId, storage, skills, commitMessage);
  }

  async search(query: SkillSearchQuery): Promise<SkillSearchResult[]> {
    return this.searchStorages(query, this.resolveSearchStorageIds(query));
  }

  async searchForAgent(query: SkillSearchQuery, authenticatedAgentPresetId: string): Promise<SkillSearchResult[]> {
    const requestedAgentPresetId = query.agentPresetId?.trim();
    if (requestedAgentPresetId && requestedAgentPresetId !== authenticatedAgentPresetId) {
      throw new ValidationError("agentPresetId must match the authenticated MCP agent");
    }

    const attachedStorageIds = this.skillRepository
      .listStoragesForAgent(query.projectId, authenticatedAgentPresetId)
      .map((storage) => storage.id);
    const requestedStorageId = query.storageId?.trim();
    if (requestedStorageId && !attachedStorageIds.includes(requestedStorageId)) {
      throw new ValidationError(`Skill storage is not attached to the authenticated MCP agent: ${requestedStorageId}`);
    }

    return this.searchStorages(query, requestedStorageId ? [requestedStorageId] : attachedStorageIds);
  }

  private async searchStorages(query: SkillSearchQuery, storageIds: string[]): Promise<SkillSearchResult[]> {
    if (storageIds.length === 0) {
      return [];
    }
    const limit = Math.max(1, query.limit ?? 20);
    const minSimilarity = query.minSimilarity ?? 0.3;
    const skills = storageIds
      .flatMap((storageId) => this.skillRepository.listSkills(query.projectId, storageId, MAX_SEARCH_CANDIDATES))
      .slice(0, MAX_SEARCH_CANDIDATES);
    const lexicalScores = new Map(skills.map((skill) => [skill.id, computeSkillLexicalScore(skill, query.query)]));
    const vectorScores = new Map<string, number>();
    const modelId = this.embeddingService.getLoadedModelId();

    if (modelId && query.query.trim()) {
      try {
        const queryEmbedding = await this.embeddingService.embed(query.query);
        const candidates = this.skillRepository.loadEmbeddingsForStorages(
          query.projectId,
          storageIds,
          modelId,
          MAX_SEARCH_CANDIDATES,
        );
        for (const candidate of candidates) {
          if (candidate.embeddingDimension !== queryEmbedding.length) continue;
          const similarity = cosineSimilarity(
            queryEmbedding,
            bufferToFloat32(candidate.embeddingBlob, candidate.embeddingDimension),
          );
          vectorScores.set(candidate.skillId, Math.max(vectorScores.get(candidate.skillId) ?? -1, similarity));
        }
      } catch (error) {
        this.logger.warn(`Skill semantic search unavailable; using lexical fallback: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const semanticAvailable = vectorScores.size > 0;
    return skills
      .map((skill) => {
        const lexical = lexicalScores.get(skill.id) ?? 0;
        const vector = vectorScores.get(skill.id);
        const similarity = vector === undefined
          ? lexical
          : vector * 0.82 + lexical * 0.18;
        return { skill, similarity, lexical, vector };
      })
      .filter((result) => result.similarity >= minSimilarity && (result.similarity > 0 || result.lexical > 0))
      .sort((a, b) => b.similarity - a.similarity || b.lexical - a.lexical || a.skill.id.localeCompare(b.skill.id))
      .slice(0, limit)
      .map(({ skill, similarity }) => ({ skill, similarity: semanticAvailable ? similarity : Math.min(1, similarity) }));
  }

  private resolveSearchStorageIds(query: SkillSearchQuery): string[] {
    if (query.storageId) {
      const storage = this.skillRepository.getStorage(query.projectId, query.storageId);
      return storage ? [storage.id] : [];
    }
    if (query.agentPresetId) {
      return this.skillRepository.listStoragesForAgent(query.projectId, query.agentPresetId).map((storage) => storage.id);
    }
    return this.skillRepository.listStorages(query.projectId).map((storage) => storage.id);
  }

  private requireSkill(projectId: string, skillId: string): SkillRecord {
    const skill = this.skillRepository.getSkill(projectId, skillId);
    if (!skill) {
      throw new Error(`Skill not found: ${skillId}`);
    }
    return skill;
  }

  private async embedSkillIfAvailable(skill: SkillRecord): Promise<void> {
    if (!this.embeddingService.isLoaded()) {
      this.skillRepository.deleteEmbeddingsForSkill(skill.projectId, skill.id);
      return;
    }
    const modelId = this.embeddingService.getLoadedModelId();
    if (!modelId) {
      return;
    }

    try {
      this.skillRepository.deleteEmbeddingsForSkill(skill.projectId, skill.id);
      const descriptor = [
        skill.name,
        skill.description,
        skill.tags.length > 0 ? `Tags: ${skill.tags.join(", ")}` : "",
        skill.appliesTo.length > 0 ? `Applies to: ${skill.appliesTo.join(", ")}` : "",
      ].filter(Boolean).join("\n");
      const chunks = new KnowledgeIngestionService(this.logger)
        .chunkText(skill.contentMarkdown)
        .slice(0, MAX_SKILL_BODY_CHUNKS);
      const embeddingInputs = [descriptor || skill.name, ...chunks.map((chunk) => chunk.content)];
      for (const [chunkIndex, input] of embeddingInputs.entries()) {
        const embedding = await this.embeddingService.embed(input);
        this.skillRepository.saveEmbedding(
          skill.projectId,
          skill.id,
          modelId,
          embedding.length,
          float32ToBuffer(embedding),
          chunkIndex,
        );
      }
    } catch (error) {
      this.logger.warn(`Failed to embed skill ${skill.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

}

function computeSkillLexicalScore(skill: SkillRecord, query: string): number {
  const terms = query.toLowerCase().match(/[a-z0-9_./-]{2,}/g) ?? [];
  if (terms.length === 0) return 0;
  const descriptor = `${skill.name} ${skill.description} ${skill.tags.join(" ")} ${skill.appliesTo.join(" ")}`.toLowerCase();
  const body = skill.contentMarkdown.toLowerCase();
  let matched = 0;
  let descriptorMatches = 0;
  for (const term of new Set(terms)) {
    if (descriptor.includes(term) || body.includes(term)) matched++;
    if (descriptor.includes(term)) descriptorMatches++;
  }
  const uniqueTermCount = new Set(terms).size;
  return Math.min(1, matched / uniqueTermCount * 0.75 + descriptorMatches / uniqueTermCount * 0.25);
}
