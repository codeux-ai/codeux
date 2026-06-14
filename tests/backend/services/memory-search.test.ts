import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryService } from "../../../src/services/memory-service.js";
import { MemoryRepository } from "../../../src/repositories/memory-repository.js";
import { EmbeddingService } from "../../../src/services/embedding-service.js";
import { Logger } from "../../../src/shared/logging/logger.js";
import {
  EmbeddingModelId,
  MemoryRecord,
  EmbeddingRecord,
  MemorySearchQuery
} from "../../../src/contracts/memory-types.js";
import { float32ToBuffer } from "../../../src/services/embedding-vector-utils.js";

describe("MemoryService - search", () => {
  let memoryService: MemoryService;
  let mockMemoryRepository: vi.Mocked<Partial<MemoryRepository>>;
  let mockEmbeddingService: vi.Mocked<Partial<EmbeddingService>>;
  let mockLogger: vi.Mocked<Partial<Logger>>;

  const mockModelId = "minilm-l6-v2" as EmbeddingModelId;
  const mockDimension = 3; // Use a small dimension for testing
  const projectId = "proj-1";

  beforeEach(() => {
    mockMemoryRepository = {
      loadEmbeddingsForScope: vi.fn(),
      getMemories: vi.fn(),
    };

    mockEmbeddingService = {
      getLoadedModelId: vi.fn().mockReturnValue(mockModelId),
      getDimension: vi.fn().mockReturnValue(mockDimension),
      embed: vi.fn().mockImplementation(async () => new Float32Array([1, 0, 0])),
    };

    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    memoryService = new MemoryService(
      mockMemoryRepository as any,
      mockEmbeddingService as any,
      mockLogger as any,
    );
  });

  it("should return empty array when no embedding model is loaded", async () => {
    mockEmbeddingService.getLoadedModelId?.mockReturnValue(null);

    const result = await memoryService.search({ query: "test", projectId });
    expect(result).toEqual([]);
    expect(mockEmbeddingService.embed).not.toHaveBeenCalled();
  });

  it("should return empty array when embedding dimension is unknown", async () => {
    mockEmbeddingService.getDimension?.mockReturnValue(0);

    const result = await memoryService.search({ query: "test", projectId });
    expect(result).toEqual([]);
    expect(mockEmbeddingService.embed).not.toHaveBeenCalled();
  });

  it("should skip candidate embeddings whose dimension does not match the model dimension", async () => {
    // 3D vector -> expected to match model dimension
    const validCandidate: EmbeddingRecord = {
      id: "mem-1",
      embeddingDimension: 3,
      embeddingBlob: float32ToBuffer(new Float32Array([0.9, 0, 0])),
    };

    // 2D vector -> dimension mismatch, should be skipped
    const invalidCandidate: EmbeddingRecord = {
      id: "mem-2",
      embeddingDimension: 2,
      embeddingBlob: float32ToBuffer(new Float32Array([0.9, 0])),
    };

    mockMemoryRepository.loadEmbeddingsForScope?.mockReturnValue([
      validCandidate,
      invalidCandidate,
    ]);

    const mem1Record: MemoryRecord = {
      id: "mem-1",
      projectId,
      content: "Valid memory",
      category: "learning",
      strength: 0.5,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    mockMemoryRepository.getMemories?.mockReturnValue([mem1Record]);

    const result = await memoryService.search({
      query: "test",
      projectId,
      minSimilarity: 0.1,
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.memory.id).toBe("mem-1");
    // Invalid candidate should not have triggered a lookup
    expect(mockMemoryRepository.getMemories).toHaveBeenCalledWith(["mem-1"]);
  });

  it("should enforce limit and sort by descending similarity", async () => {
    // query is [1, 0, 0].
    // vec1 = [1, 0, 0] -> sim = 1.0
    // vec2 = [0, 1, 0] -> sim = 0.0
    // vec3 = [0.8, 0.6, 0] -> sim = 0.8
    // vec4 = [0.6, 0.8, 0] -> sim = 0.6

    mockMemoryRepository.loadEmbeddingsForScope?.mockReturnValue([
      { id: "mem-2", embeddingDimension: 3, embeddingBlob: float32ToBuffer(new Float32Array([0, 1, 0])) },
      { id: "mem-3", embeddingDimension: 3, embeddingBlob: float32ToBuffer(new Float32Array([0.8, 0.6, 0])) },
      { id: "mem-4", embeddingDimension: 3, embeddingBlob: float32ToBuffer(new Float32Array([0.6, 0.8, 0])) },
      { id: "mem-1", embeddingDimension: 3, embeddingBlob: float32ToBuffer(new Float32Array([1, 0, 0])) },
    ]);

    mockMemoryRepository.getMemories?.mockImplementation((ids: string[]) => {
      // Return records unordered, memory service should restore ordering via topK mapping
      const records: Record<string, MemoryRecord> = {
        "mem-1": { id: "mem-1", content: "c1" } as any,
        "mem-2": { id: "mem-2", content: "c2" } as any,
        "mem-3": { id: "mem-3", content: "c3" } as any,
        "mem-4": { id: "mem-4", content: "c4" } as any,
      };
      return ids.map(id => records[id]!);
    });

    const result = await memoryService.search({
      query: "test",
      projectId,
      minSimilarity: 0.1, // includes 1, 3, 4
      limit: 2, // only top 2: mem-1 (1.0), mem-3 (0.8)
    });

    expect(result).toHaveLength(2);
    // Highest similarity first
    expect(result[0]?.memory.id).toBe("mem-1");
    expect(result[0]?.similarity).toBeCloseTo(1.0);

    expect(result[1]?.memory.id).toBe("mem-3");
    expect(result[1]?.similarity).toBeCloseTo(0.8);

    // getMemories should have been called with the batch of top K ids
    expect(mockMemoryRepository.getMemories).toHaveBeenCalledWith(["mem-1", "mem-3"]);
  });

  it("should preserve caller-specified parameters to loadEmbeddingsForScope", async () => {
    mockMemoryRepository.loadEmbeddingsForScope?.mockReturnValue([]);
    mockMemoryRepository.getMemories?.mockReturnValue([]);

    await memoryService.search({
      query: "test query",
      projectId,
      scope: "agent",
      sprintId: "sprint-123",
      agentPresetId: "agent-abc",
    });

    expect(mockMemoryRepository.loadEmbeddingsForScope).toHaveBeenCalledWith(
      projectId,
      mockModelId,
      "agent",
      "sprint-123",
      "agent-abc"
    );
  });
});
