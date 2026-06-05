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
import { readFile, unlink } from "fs/promises";
import { join } from "path";
import { LEARNINGS_FILENAME, type ParsedMemoryEntry } from "../contracts/memory-types.js";
import { cosineSimilarity, bufferToFloat32, float32ToBuffer } from "./embedding-vector-utils.js";

const VALID_CATEGORIES = new Set<MemoryCategory>([
  "architecture", "codebase", "context", "preferences", "patterns", "decision", "error", "learning",
]);

function parseCategory(header: string): MemoryCategory {
  const name = header.trim().toLowerCase();
  return VALID_CATEGORIES.has(name as MemoryCategory) ? (name as MemoryCategory) : "learning";
}

export function parseLearningsMarkdown(raw: string): ParsedMemoryEntry[] {
  const entries: ParsedMemoryEntry[] = [];
  let currentCategory: MemoryCategory = "learning";

  for (const line of raw.split("\n")) {
    const headerMatch = line.match(/^##\s+Category:\s*(.+)/i);
    if (headerMatch) {
      currentCategory = parseCategory(headerMatch[1]!);
      continue;
    }

    const bulletMatch = line.match(/^[-*]\s+(.+)/);
    if (bulletMatch) {
      const content = bulletMatch[1]!.trim();
      if (content.length > 0) {
        entries.push({ category: currentCategory, content });
      }
    }
  }

  return entries;
}

export interface ReembedProgress {
  active: boolean;
  completed: number;
  total: number;
  projectId: string;
}

export interface EmbeddingMapNode {
  id: string;
  x: number;
  y: number;
}

export interface EmbeddingMapEdge {
  source: string;
  target: string;
  similarity: number;
}

export interface EmbeddingMapResult {
  nodes: EmbeddingMapNode[];
  edges: EmbeddingMapEdge[];
  hasEmbeddings: boolean;
}

export class MemoryService {
  private readonly memoryRepository: MemoryRepository;
  private readonly embeddingService: EmbeddingService;
  private readonly logger: Logger;
  private reembedProgress: ReembedProgress | null = null;

  constructor(
    memoryRepository: MemoryRepository,
    embeddingService: EmbeddingService,
    logger: Logger,
  ) {
    this.memoryRepository = memoryRepository;
    this.embeddingService = embeddingService;
    this.logger = logger;
  }

  async captureMemoriesFromWorktree(
    projectId: string,
    sprintId: string | undefined,
    agentPresetId: string | null,
    worktreePath: string,
    originId: string
  ): Promise<number> {
    const filePath = join(worktreePath, LEARNINGS_FILENAME);
    let raw: string;
    try {
      raw = await readFile(filePath, "utf-8");
    } catch {
      return 0;
    }

    const captured = await this.captureMemoriesFromContent(projectId, sprintId, agentPresetId, raw, originId);
    await unlink(filePath).catch(() => {});
    return captured;
  }

  async captureMemoriesFromContent(
    projectId: string,
    sprintId: string | undefined,
    agentPresetId: string | null,
    raw: string,
    originId: string,
  ): Promise<number> {
    const entries = parseLearningsMarkdown(raw);
    if (entries.length === 0) {
      return 0;
    }

    let captured = 0;
    for (const entry of entries) {
      this.createMemory(projectId, {
        scope: "sprint",
        sprintId,
        agentPresetId,
        content: entry.content,
        category: entry.category,
        strength: 0.6,
        source: {
          type: "auto_capture",
          originType: "worker_learnings_file",
          originId,
        },
      }).catch((err) => {
        this.logger.warn(`Failed to capture worker learning memory for origin ${originId}: ${err instanceof Error ? err.message : String(err)}`);
      });
      captured++;
    }
    return captured;
  }

  async createMemory(projectId: string, input: CreateMemoryInput): Promise<MemoryRecord> {
    const record = this.memoryRepository.createMemory(projectId, input);

    // Async: compute embedding if model is loaded
    if (this.embeddingService.isLoaded()) {
      this.triggerEmbedding(record).catch(error => {
        this.logger.warn(`Failed to embed memory ${record.id}: ${error}`);
      });
    }

    return record;
  }

  async createMemoriesBatch(projectId: string, inputs: import("../contracts/memory-types.js").CreateMemoryInput[]): Promise<import("../contracts/memory-types.js").MemoryRecord[]> {
    return this.memoryRepository.createMemoriesBatch(projectId, inputs);
  }

  async createMemories(projectId: string, inputs: CreateMemoryInput[]): Promise<MemoryRecord[]> {
    const records = this.memoryRepository.createMemories(projectId, inputs);

    // Async: compute embedding if model is loaded
    if (this.embeddingService.isLoaded()) {
      Promise.all(records.map(record =>
        this.triggerEmbedding(record).catch(error => {
          this.logger.warn(`Failed to embed memory ${record.id}: ${error}`);
        })
      )).catch(() => {});
    }

    return records;
  }

  getMemory(memoryId: string): MemoryRecord | null {
    return this.memoryRepository.getMemory(memoryId);
  }

  updateMemory(memoryId: string, input: UpdateMemoryInput): MemoryRecord {
    const record = this.memoryRepository.updateMemory(memoryId, input);

    // Automatically trigger embedding generation whenever a long-term memory is updated
    if (record.scope === "project" && this.embeddingService.isLoaded()) {
      this.triggerEmbedding(record).catch(error => {
        this.logger.warn(`Failed to embed updated memory ${record.id}: ${error}`);
      });
    }

    return record;
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

  /** Short-term memories for a specific agent within a specific sprint. */
  listBySprintAndAgent(projectId: string, sprintId: string, agentPresetId: string, limit?: number): MemoryRecord[] {
    return this.memoryRepository.listBySprintAndAgent(projectId, sprintId, agentPresetId, limit);
  }

  /** Long-term (project-scope) memories for a specific agent. */
  listLongTermByAgent(projectId: string, agentPresetId: string, limit?: number): MemoryRecord[] {
    return this.memoryRepository.listLongTermByAgent(projectId, agentPresetId, limit);
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

    // Fetch full records in batch
    const topIds = topK.map((item) => item.id);
    const memories = this.memoryRepository.getMemories(topIds);

    // Map memories back to ranked results
    const results: MemorySearchResult[] = [];
    const memoryMap = new Map<string, MemoryRecord>();
    for (const memory of memories) {
      memoryMap.set(memory.id, memory);
    }

    for (const item of topK) {
      const memory = memoryMap.get(item.id);
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
    let index = 0;
    const concurrency = 5;

    const worker = async () => {
      while (index < memories.length) {
        const i = index++;
        const memory = memories[i];
        try {
          await this.triggerEmbedding(memory);
          completed++;
          onProgress?.(completed, memories.length);
        } catch (error) {
          this.logger.warn(`Failed to re-embed memory ${memory.id}: ${error}`);
        }
      }
    };

    const workers = Array.from({ length: Math.min(concurrency, memories.length) }, () => worker());
    await Promise.all(workers);

    return completed;
  }

  startReembedProject(projectId: string): void {
    if (!this.embeddingService.isLoaded()) {
      throw new Error("No embedding model loaded");
    }
    if (this.reembedProgress?.active) {
      throw new Error("Re-embedding already in progress");
    }

    const memories = this.memoryRepository.listByProject(projectId, undefined, 10000);
    this.reembedProgress = { active: true, completed: 0, total: memories.length, projectId };

    const run = async () => {
      let completed = 0;
      let index = 0;
      const concurrency = 5;

      const worker = async () => {
        while (index < memories.length) {
          if (!this.reembedProgress?.active) break;
          const i = index++;
          const memory = memories[i];
          try {
            await this.triggerEmbedding(memory);
            completed++;
          } catch (error) {
            this.logger.warn(`Failed to re-embed memory ${memory.id}: ${error}`);
          }
          if (this.reembedProgress) {
            this.reembedProgress.completed = completed;
          }
        }
      };

      const workers = Array.from({ length: Math.min(concurrency, memories.length) }, () => worker());
      await Promise.all(workers);

      if (this.reembedProgress) {
        this.reembedProgress.active = false;
        this.reembedProgress.completed = completed;
      }
    };

    run().catch((error) => {
      this.logger.warn(`Re-embed failed: ${error}`);
      if (this.reembedProgress) {
        this.reembedProgress.active = false;
      }
    });
  }

  getReembedProgress(): ReembedProgress | null {
    return this.reembedProgress;
  }

  countByScope(projectId: string, scope: MemoryScope): number {
    return this.memoryRepository.countByScope(projectId, scope);
  }

  countStaleEmbeddings(projectId: string): number {
    const modelId = this.embeddingService.getLoadedModelId();
    if (!modelId) return 0;
    return this.memoryRepository.countStaleEmbeddings(projectId, modelId);
  }

  getEmbeddingMap(
    projectId: string,
    scope?: MemoryScope,
    sprintId?: string,
    agentPresetId?: string,
    topKPerNode = 3,
  ): EmbeddingMapResult {
    const modelId = this.embeddingService.getLoadedModelId();
    if (!modelId) {
      return { nodes: [], edges: [], hasEmbeddings: false };
    }

    const dimension = this.embeddingService.getDimension();
    if (!dimension) {
      return { nodes: [], edges: [], hasEmbeddings: false };
    }

    const records = this.memoryRepository.loadEmbeddingsForScope(
      projectId, modelId, scope, sprintId, agentPresetId, 1000,
    );

    if (records.length === 0) {
      return { nodes: [], edges: [], hasEmbeddings: false };
    }

    // Deserialize all embedding vectors
    const vectors: Float32Array[] = records.map(
      (r) => bufferToFloat32(r.embeddingBlob, r.embeddingDimension),
    );

    // --- PCA to 2D ---
    const n = vectors.length;
    const dim = vectors[0].length;

    // Compute mean
    const mean = new Float32Array(dim);
    for (let i = 0; i < n; i++) {
      for (let d = 0; d < dim; d++) {
        mean[d] += vectors[i][d];
      }
    }
    for (let d = 0; d < dim; d++) mean[d] /= n;

    // Center vectors
    const centered: Float32Array[] = vectors.map((v) => {
      const c = new Float32Array(dim);
      for (let d = 0; d < dim; d++) c[d] = v[d] - mean[d];
      return c;
    });

    // Power iteration for top-2 principal components
    const pc1 = this.powerIteration(centered, dim, null);
    const pc2 = this.powerIteration(centered, dim, pc1);

    // Project each vector onto PC1 and PC2
    const projections: Array<{ x: number; y: number }> = centered.map((c) => {
      let x = 0, y = 0;
      for (let d = 0; d < dim; d++) {
        x += c[d] * pc1[d];
        y += c[d] * pc2[d];
      }
      return { x, y };
    });

    // Normalize projections to a reasonable coordinate range (±300)
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of projections) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const scale = 300;

    const nodes: EmbeddingMapNode[] = records.map((r, i) => ({
      id: r.id,
      x: ((projections[i].x - minX) / rangeX - 0.5) * 2 * scale,
      y: ((projections[i].y - minY) / rangeY - 0.5) * 2 * scale,
    }));

    // --- Top-K nearest neighbors per node ---
    // For each node, keep only its K strongest connections.
    // This produces a sparse, meaningful graph instead of a near-complete one.
    const topNeighbors: Array<Array<{ j: number; sim: number }>> = Array.from({ length: n }, () => []);

    const insertNeighbor = (list: Array<{ j: number; sim: number }>, neighborId: number, sim: number) => {
      if (list.length < topKPerNode) {
        list.push({ j: neighborId, sim });
        list.sort((a, b) => b.sim - a.sim);
      } else if (sim > list[list.length - 1].sim) {
        list.pop();
        list.push({ j: neighborId, sim });
        list.sort((a, b) => b.sim - a.sim);
      }
    };

    const edgeSet = new Set<string>();
    const edges: EmbeddingMapEdge[] = [];

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const sim = cosineSimilarity(vectors[i], vectors[j]);
        insertNeighbor(topNeighbors[i], j, sim);
        insertNeighbor(topNeighbors[j], i, sim);
      }
    }

    for (let i = 0; i < n; i++) {
      for (const nb of topNeighbors[i]) {
        const lo = Math.min(i, nb.j);
        const hi = Math.max(i, nb.j);
        const key = `${lo}:${hi}`;
        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          edges.push({
            source: records[lo].id,
            target: records[hi].id,
            similarity: Math.round(nb.sim * 1000) / 1000,
          });
        }
      }
    }

    edges.sort((a, b) => b.similarity - a.similarity);

    return { nodes, edges, hasEmbeddings: true };
  }

  /**
   * Power iteration to find a principal component.
   * If `deflect` is provided, deflects the data against it first (for PC2+).
   */
  private powerIteration(
    centered: Float32Array[],
    dim: number,
    deflect: Float32Array | null,
    iterations = 50,
  ): Float32Array {
    const n = centered.length;

    // Optionally deflect data against a previous PC
    let data = centered;
    if (deflect) {
      data = centered.map((c) => {
        let dot = 0;
        for (let d = 0; d < dim; d++) dot += c[d] * deflect[d];
        const r = new Float32Array(dim);
        for (let d = 0; d < dim; d++) r[d] = c[d] - dot * deflect[d];
        return r;
      });
    }

    // Initialize with random-ish vector (first data point or uniform)
    const pc = new Float32Array(dim);
    if (n > 0) {
      for (let d = 0; d < dim; d++) pc[d] = data[0][d];
    } else {
      for (let d = 0; d < dim; d++) pc[d] = 1;
    }

    for (let iter = 0; iter < iterations; iter++) {
      // Multiply by covariance: new_pc = X^T * (X * pc)
      const next = new Float32Array(dim);
      for (let i = 0; i < n; i++) {
        let dot = 0;
        for (let d = 0; d < dim; d++) dot += data[i][d] * pc[d];
        for (let d = 0; d < dim; d++) next[d] += data[i][d] * dot;
      }

      // Normalize
      let norm = 0;
      for (let d = 0; d < dim; d++) norm += next[d] * next[d];
      norm = Math.sqrt(norm);
      if (norm > 0) {
        for (let d = 0; d < dim; d++) pc[d] = next[d] / norm;
      }
    }

    return pc;
  }

  public async triggerEmbedding(record: MemoryRecord): Promise<void> {
    const modelId = this.embeddingService.getLoadedModelId();
    const dimension = this.embeddingService.getDimension();
    if (!modelId || !dimension) return;

    const embedding = await this.embeddingService.embed(record.content);
    const blob = float32ToBuffer(embedding);
    this.memoryRepository.saveEmbedding(record.id, modelId, dimension, blob);
  }
}
