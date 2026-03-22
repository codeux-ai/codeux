import type {
  MemoryRecord,
  MemoryScope,
  MemoryCategory,
  CreateMemoryInput,
  UpdateMemoryInput,
  MemorySearchQuery,
  MemorySearchResult,
  EmbeddingModelId,
} from "../contracts/memory-types.js";
import { MemoryRepository } from "../repositories/memory-repository.js";
import { EmbeddingService } from "./embedding-service.js";
import type { Logger } from "../shared/logging/logger.js";

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

function bufferToFloat32(buf: Buffer, dimension: number): Float32Array {
  const arr = new Float32Array(dimension);
  for (let i = 0; i < dimension; i++) {
    arr[i] = buf.readFloatLE(i * 4);
  }
  return arr;
}

function float32ToBuffer(arr: Float32Array): Buffer {
  const buf = Buffer.alloc(arr.length * 4);
  for (let i = 0; i < arr.length; i++) {
    buf.writeFloatLE(arr[i], i * 4);
  }
  return buf;
}

export class MemoryService {
  private readonly memoryRepository: MemoryRepository;
  private readonly embeddingService: EmbeddingService;
  private readonly logger: Logger;

  constructor(
    memoryRepository: MemoryRepository,
    embeddingService: EmbeddingService,
    logger: Logger,
  ) {
    this.memoryRepository = memoryRepository;
    this.embeddingService = embeddingService;
    this.logger = logger;
  }

  async createMemory(projectId: string, input: CreateMemoryInput): Promise<MemoryRecord> {
    const record = this.memoryRepository.createMemory(projectId, input);

    // Async: compute embedding if model is loaded
    if (this.embeddingService.isLoaded()) {
      try {
        await this.embedMemory(record);
      } catch (error) {
        this.logger.warn(`Failed to embed memory ${record.id}: ${error}`);
      }
    }

    return this.memoryRepository.getMemory(record.id) ?? record;
  }

  getMemory(memoryId: string): MemoryRecord | null {
    return this.memoryRepository.getMemory(memoryId);
  }

  updateMemory(memoryId: string, input: UpdateMemoryInput): MemoryRecord {
    return this.memoryRepository.updateMemory(memoryId, input);
  }

  deleteMemory(memoryId: string): void {
    this.memoryRepository.deleteMemory(memoryId);
  }

  listByProject(projectId: string, scope?: MemoryScope, limit?: number): MemoryRecord[] {
    return this.memoryRepository.listByProject(projectId, scope, limit);
  }

  listBySprint(projectId: string, sprintId: string, limit?: number): MemoryRecord[] {
    return this.memoryRepository.listBySprint(projectId, sprintId, limit);
  }

  listByAgent(projectId: string, agentPresetId: string, limit?: number): MemoryRecord[] {
    return this.memoryRepository.listByAgent(projectId, agentPresetId, limit);
  }

  async search(query: MemorySearchQuery): Promise<MemorySearchResult[]> {
    const modelId = this.embeddingService.getLoadedModelId();
    if (!modelId) {
      return [];
    }

    const dimension = this.embeddingService.getDimension();
    if (!dimension) {
      return [];
    }

    // Embed query
    const queryEmbedding = await this.embeddingService.embed(query.query);

    // Load candidate embeddings
    const candidates = this.memoryRepository.loadEmbeddingsForScope(
      query.projectId,
      modelId,
      query.scope,
      query.sprintId,
      query.agentPresetId,
    );

    // Compute similarities
    const scored: Array<{ id: string; similarity: number }> = [];
    const minSim = query.minSimilarity ?? 0.3;

    for (const candidate of candidates) {
      const vec = bufferToFloat32(candidate.embeddingBlob, candidate.embeddingDimension);
      const sim = cosineSimilarity(queryEmbedding, vec);
      if (sim >= minSim) {
        scored.push({ id: candidate.id, similarity: sim });
      }
    }

    // Sort by similarity descending
    scored.sort((a, b) => b.similarity - a.similarity);
    const limit = query.limit ?? 20;
    const topK = scored.slice(0, limit);

    // Fetch full records
    const results: MemorySearchResult[] = [];
    for (const item of topK) {
      const memory = this.memoryRepository.getMemory(item.id);
      if (memory) {
        results.push({ memory, similarity: item.similarity });
      }
    }

    return results;
  }

  async reembedProject(
    projectId: string,
    onProgress?: (completed: number, total: number) => void,
  ): Promise<number> {
    if (!this.embeddingService.isLoaded()) {
      throw new Error("No embedding model loaded");
    }

    const memories = this.memoryRepository.listByProject(projectId, undefined, 10000);
    let completed = 0;

    for (const memory of memories) {
      try {
        await this.embedMemory(memory);
        completed++;
        onProgress?.(completed, memories.length);
      } catch (error) {
        this.logger.warn(`Failed to re-embed memory ${memory.id}: ${error}`);
      }
    }

    return completed;
  }

  countByScope(projectId: string, scope: MemoryScope): number {
    return this.memoryRepository.countByScope(projectId, scope);
  }

  private async embedMemory(record: MemoryRecord): Promise<void> {
    const modelId = this.embeddingService.getLoadedModelId();
    const dimension = this.embeddingService.getDimension();
    if (!modelId || !dimension) return;

    const embedding = await this.embeddingService.embed(record.content);
    const blob = float32ToBuffer(embedding);
    this.memoryRepository.saveEmbedding(record.id, modelId, dimension, blob);
  }
}
