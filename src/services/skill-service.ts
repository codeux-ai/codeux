import { SkillRepository } from "../repositories/skill-repository.js";
import * as fs from "fs/promises";
import {
  buildPersistentSkillStorageContainerPath,
  buildPersistentSkillStorageHostPath,
} from "../infrastructure/providers/cli/workspace-manager.js";
import { bufferToFloat32, cosineSimilarity, float32ToBuffer } from "./embedding-vector-utils.js";
import { parseSkillMarkdown, renderSkillMarkdown } from "./skill-markdown-parser.js";
import { createLogger, type Logger } from "../shared/logging/logger.js";
import { buildPersistentSkillStorageInstruction } from "./persistent-skill-context.js";
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
}

export interface PersistentSkillStorageRuntime {
  projectId: string;
  agentPresetId: string;
  mounts: PersistentSkillStorageRuntimeMount[];
  instructionMarkdown: string;
}

const MAX_SEARCH_CANDIDATES = 10000;

export class SkillService {
  constructor(
    private readonly skillRepository: SkillRepository,
    private readonly embeddingService: SkillEmbeddingProvider,
    private readonly logger: Logger = createLogger({ bindings: { component: "SkillService" } }),
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
      const hostPath = buildPersistentSkillStorageHostPath(args.projectId, args.agentPresetId, storage.id);
      await fs.mkdir(hostPath, { recursive: true, mode: 0o700 });
      mounts.push({
        storageId: storage.id,
        storageName: storage.name,
        hostPath,
        containerPath: buildPersistentSkillStorageContainerPath(storage.id),
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
    return this.skillRepository.getSkill(projectId, skill.id) ?? skill;
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

  async deleteSkill(projectId: string, skillId: string): Promise<void> {
    this.skillRepository.deleteSkill(projectId, skillId);
  }

  async resetStorage(projectId: string, storageId: string): Promise<number> {
    const skills = this.skillRepository.listSkills(projectId, storageId, MAX_SEARCH_CANDIDATES);
    for (const skill of skills) {
      this.skillRepository.deleteSkill(projectId, skill.id);
    }
    return skills.length;
  }

  async search(query: SkillSearchQuery): Promise<SkillSearchResult[]> {
    const modelId = this.embeddingService.getLoadedModelId();
    if (!modelId) {
      return [];
    }

    const storageIds = this.resolveSearchStorageIds(query);
    if (storageIds.length === 0) {
      return [];
    }

    const queryEmbedding = await this.embeddingService.embed(query.query);
    const dimension = queryEmbedding.length;
    const candidates = this.skillRepository.loadEmbeddingsForStorages(
      query.projectId,
      storageIds,
      modelId,
      MAX_SEARCH_CANDIDATES,
    );

    const limit = Math.max(1, query.limit ?? 20);
    const minSimilarity = query.minSimilarity ?? 0.3;
    const topK: Array<{ skillId: string; similarity: number }> = [];

    for (const candidate of candidates) {
      if (candidate.embeddingDimension !== dimension) {
        continue;
      }
      const similarity = cosineSimilarity(queryEmbedding, bufferToFloat32(candidate.embeddingBlob, candidate.embeddingDimension));
      if (similarity < minSimilarity) {
        continue;
      }
      const next = { skillId: candidate.skillId, similarity };
      if (topK.length < limit) {
        topK.push(next);
        topK.sort(compareRankedSkill);
        continue;
      }
      const last = topK[topK.length - 1]!;
      if (compareRankedSkill(next, last) < 0) {
        topK.pop();
        topK.push(next);
        topK.sort(compareRankedSkill);
      }
    }

    const skills = this.skillRepository.getSkills(query.projectId, topK.map((item) => item.skillId));
    const skillMap = new Map(skills.map((skill) => [skill.id, skill]));
    const results: SkillSearchResult[] = [];
    for (const item of topK) {
      const skill = skillMap.get(item.skillId);
      if (skill) {
        results.push({ skill, similarity: item.similarity });
      }
    }
    return results;
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
      const embedding = await this.embeddingService.embed(renderSkillMarkdown(skill));
      this.skillRepository.saveEmbedding(skill.projectId, skill.id, modelId, embedding.length, float32ToBuffer(embedding));
    } catch (error) {
      this.logger.warn(`Failed to embed skill ${skill.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

}

function compareRankedSkill(a: { skillId: string; similarity: number }, b: { skillId: string; similarity: number }): number {
  return b.similarity - a.similarity || a.skillId.localeCompare(b.skillId);
}
