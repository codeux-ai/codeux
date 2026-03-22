import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryService } from "../../../src/services/memory-service.js";
import type {
  MemoryRecord,
  CreateMemoryInput,
  UpdateMemoryInput,
  EmbeddingModelId,
} from "../../../src/contracts/memory-types.js";

function makeMemoryRecord(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: "mem-1",
    projectId: "proj-1",
    scope: "sprint",
    sprintId: "sprint-1",
    agentPresetId: null,
    content: "Some important memory content",
    category: "context",
    strength: 1,
    source: { type: "auto_capture" },
    embeddingModel: null,
    embeddingDimension: null,
    embeddingBlob: null,
    promotedFromId: null,
    promotionReason: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeFloat32Buffer(values: number[]): Buffer {
  const arr = new Float32Array(values);
  const buf = Buffer.alloc(arr.length * 4);
  for (let i = 0; i < arr.length; i++) {
    buf.writeFloatLE(arr[i], i * 4);
  }
  return buf;
}

describe("MemoryService", () => {
  const mockRepo = {
    createMemory: vi.fn(),
    getMemory: vi.fn(),
    updateMemory: vi.fn(),
    deleteMemory: vi.fn(),
    listByProject: vi.fn(),
    listBySprint: vi.fn(),
    listByAgent: vi.fn(),
    loadEmbeddingsForScope: vi.fn(),
    saveEmbedding: vi.fn(),
    countByScope: vi.fn(),
  };

  const mockEmbeddingService = {
    isLoaded: vi.fn(),
    getLoadedModelId: vi.fn(),
    getDimension: vi.fn(),
    embed: vi.fn(),
  };

  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };

  let service: MemoryService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new MemoryService(
      mockRepo as any,
      mockEmbeddingService as any,
      mockLogger as any,
    );
  });

  describe("createMemory", () => {
    const input: CreateMemoryInput = {
      scope: "sprint",
      sprintId: "sprint-1",
      content: "New memory content",
      category: "context",
    };

    it("creates via repository and triggers async embedding when model is loaded", async () => {
      const created = makeMemoryRecord({ id: "mem-new" });
      const updated = makeMemoryRecord({ id: "mem-new", embeddingModel: "bge-small-en-v1.5" });

      mockRepo.createMemory.mockReturnValue(created);
      mockEmbeddingService.isLoaded.mockReturnValue(true);
      mockEmbeddingService.getLoadedModelId.mockReturnValue("bge-small-en-v1.5" as EmbeddingModelId);
      mockEmbeddingService.getDimension.mockReturnValue(384);
      mockEmbeddingService.embed.mockResolvedValue(new Float32Array(384));
      mockRepo.getMemory.mockReturnValue(updated);

      const result = await service.createMemory("proj-1", input);

      expect(mockRepo.createMemory).toHaveBeenCalledWith("proj-1", input);
      expect(mockEmbeddingService.embed).toHaveBeenCalledWith(created.content);
      expect(mockRepo.saveEmbedding).toHaveBeenCalledWith(
        "mem-new",
        "bge-small-en-v1.5",
        384,
        expect.any(Buffer),
      );
      expect(result).toEqual(updated);
    });

    it("works without model loaded (no embedding)", async () => {
      const created = makeMemoryRecord({ id: "mem-no-emb" });
      mockRepo.createMemory.mockReturnValue(created);
      mockEmbeddingService.isLoaded.mockReturnValue(false);
      mockRepo.getMemory.mockReturnValue(created);

      const result = await service.createMemory("proj-1", input);

      expect(mockRepo.createMemory).toHaveBeenCalledWith("proj-1", input);
      expect(mockEmbeddingService.embed).not.toHaveBeenCalled();
      expect(mockRepo.saveEmbedding).not.toHaveBeenCalled();
      expect(result).toEqual(created);
    });

    it("logs warning and returns record when embedding fails", async () => {
      const created = makeMemoryRecord({ id: "mem-fail" });
      mockRepo.createMemory.mockReturnValue(created);
      mockEmbeddingService.isLoaded.mockReturnValue(true);
      mockEmbeddingService.getLoadedModelId.mockReturnValue("bge-small-en-v1.5");
      mockEmbeddingService.getDimension.mockReturnValue(384);
      mockEmbeddingService.embed.mockRejectedValue(new Error("embed failed"));
      mockRepo.getMemory.mockReturnValue(created);

      const result = await service.createMemory("proj-1", input);

      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining("Failed to embed memory mem-fail"));
      expect(result).toEqual(created);
    });
  });

  describe("getMemory", () => {
    it("passes through to repository", () => {
      const record = makeMemoryRecord();
      mockRepo.getMemory.mockReturnValue(record);

      expect(service.getMemory("mem-1")).toEqual(record);
      expect(mockRepo.getMemory).toHaveBeenCalledWith("mem-1");
    });

    it("returns null when not found", () => {
      mockRepo.getMemory.mockReturnValue(null);

      expect(service.getMemory("nonexistent")).toBeNull();
    });
  });

  describe("updateMemory", () => {
    it("passes through to repository", () => {
      const updated = makeMemoryRecord({ content: "updated" });
      const input: UpdateMemoryInput = { content: "updated" };
      mockRepo.updateMemory.mockReturnValue(updated);

      expect(service.updateMemory("mem-1", input)).toEqual(updated);
      expect(mockRepo.updateMemory).toHaveBeenCalledWith("mem-1", input);
    });
  });

  describe("deleteMemory", () => {
    it("passes through to repository", () => {
      service.deleteMemory("mem-1");
      expect(mockRepo.deleteMemory).toHaveBeenCalledWith("mem-1");
    });
  });

  describe("listByProject", () => {
    it("passes through to repository with all arguments", () => {
      const records = [makeMemoryRecord()];
      mockRepo.listByProject.mockReturnValue(records);

      expect(service.listByProject("proj-1", "sprint", 10)).toEqual(records);
      expect(mockRepo.listByProject).toHaveBeenCalledWith("proj-1", "sprint", 10);
    });
  });

  describe("listBySprint", () => {
    it("passes through to repository", () => {
      const records = [makeMemoryRecord()];
      mockRepo.listBySprint.mockReturnValue(records);

      expect(service.listBySprint("proj-1", "sprint-1", 5)).toEqual(records);
      expect(mockRepo.listBySprint).toHaveBeenCalledWith("proj-1", "sprint-1", 5);
    });
  });

  describe("listByAgent", () => {
    it("passes through to repository", () => {
      const records = [makeMemoryRecord({ agentPresetId: "agent-1" })];
      mockRepo.listByAgent.mockReturnValue(records);

      expect(service.listByAgent("proj-1", "agent-1", 5)).toEqual(records);
      expect(mockRepo.listByAgent).toHaveBeenCalledWith("proj-1", "agent-1", 5);
    });
  });

  describe("search", () => {
    it("embeds query, loads embeddings, computes cosine similarity, and returns ranked results", async () => {
      const dim = 3;
      // Query vector [1, 0, 0]
      const queryVec = new Float32Array([1, 0, 0]);
      // Candidate A: [1, 0, 0] -> similarity 1.0
      // Candidate B: [0, 1, 0] -> similarity 0.0
      // Candidate C: [0.7, 0.7, 0] -> similarity ~0.707
      const blobA = makeFloat32Buffer([1, 0, 0]);
      const blobB = makeFloat32Buffer([0, 1, 0]);
      const blobC = makeFloat32Buffer([0.7, 0.7, 0]);

      mockEmbeddingService.getLoadedModelId.mockReturnValue("bge-small-en-v1.5");
      mockEmbeddingService.getDimension.mockReturnValue(dim);
      mockEmbeddingService.embed.mockResolvedValue(queryVec);
      mockRepo.loadEmbeddingsForScope.mockReturnValue([
        { id: "mem-a", embeddingBlob: blobA, embeddingDimension: dim },
        { id: "mem-b", embeddingBlob: blobB, embeddingDimension: dim },
        { id: "mem-c", embeddingBlob: blobC, embeddingDimension: dim },
      ]);

      const memA = makeMemoryRecord({ id: "mem-a", content: "exact match" });
      const memC = makeMemoryRecord({ id: "mem-c", content: "partial match" });
      mockRepo.getMemory.mockImplementation((id: string) => {
        if (id === "mem-a") return memA;
        if (id === "mem-c") return memC;
        return null;
      });

      const results = await service.search({
        projectId: "proj-1",
        query: "test query",
        minSimilarity: 0.3,
      });

      expect(mockEmbeddingService.embed).toHaveBeenCalledWith("test query");
      expect(mockRepo.loadEmbeddingsForScope).toHaveBeenCalledWith(
        "proj-1",
        "bge-small-en-v1.5",
        undefined,
        undefined,
        undefined,
      );

      // Should return 2 results (mem-b has sim 0.0 which is below 0.3)
      expect(results).toHaveLength(2);
      // Ranked by similarity descending: mem-a (1.0) then mem-c (~0.707)
      expect(results[0].memory.id).toBe("mem-a");
      expect(results[0].similarity).toBeCloseTo(1.0);
      expect(results[1].memory.id).toBe("mem-c");
      expect(results[1].similarity).toBeGreaterThan(0.3);
    });

    it("returns empty when model not loaded", async () => {
      mockEmbeddingService.getLoadedModelId.mockReturnValue(null);

      const results = await service.search({
        projectId: "proj-1",
        query: "anything",
      });

      expect(results).toEqual([]);
      expect(mockEmbeddingService.embed).not.toHaveBeenCalled();
    });

    it("returns empty when dimension is not available", async () => {
      mockEmbeddingService.getLoadedModelId.mockReturnValue("bge-small-en-v1.5");
      mockEmbeddingService.getDimension.mockReturnValue(null);

      const results = await service.search({
        projectId: "proj-1",
        query: "anything",
      });

      expect(results).toEqual([]);
      expect(mockEmbeddingService.embed).not.toHaveBeenCalled();
    });
  });

  describe("reembedProject", () => {
    it("re-embeds all memories for a project and reports progress", async () => {
      const memories = [
        makeMemoryRecord({ id: "mem-1", content: "content 1" }),
        makeMemoryRecord({ id: "mem-2", content: "content 2" }),
      ];

      mockEmbeddingService.isLoaded.mockReturnValue(true);
      mockEmbeddingService.getLoadedModelId.mockReturnValue("bge-small-en-v1.5");
      mockEmbeddingService.getDimension.mockReturnValue(384);
      mockEmbeddingService.embed.mockResolvedValue(new Float32Array(384));
      mockRepo.listByProject.mockReturnValue(memories);

      const onProgress = vi.fn();
      const completed = await service.reembedProject("proj-1", onProgress);

      expect(completed).toBe(2);
      expect(mockRepo.listByProject).toHaveBeenCalledWith("proj-1", undefined, 10000);
      expect(mockEmbeddingService.embed).toHaveBeenCalledTimes(2);
      expect(mockRepo.saveEmbedding).toHaveBeenCalledTimes(2);
      expect(onProgress).toHaveBeenCalledWith(1, 2);
      expect(onProgress).toHaveBeenCalledWith(2, 2);
    });

    it("throws when model not loaded", async () => {
      mockEmbeddingService.isLoaded.mockReturnValue(false);

      await expect(service.reembedProject("proj-1")).rejects.toThrow("No embedding model loaded");
    });

    it("continues on individual embed failures and logs warnings", async () => {
      const memories = [
        makeMemoryRecord({ id: "mem-ok", content: "good" }),
        makeMemoryRecord({ id: "mem-fail", content: "bad" }),
      ];

      mockEmbeddingService.isLoaded.mockReturnValue(true);
      mockEmbeddingService.getLoadedModelId.mockReturnValue("bge-small-en-v1.5");
      mockEmbeddingService.getDimension.mockReturnValue(384);
      mockEmbeddingService.embed
        .mockResolvedValueOnce(new Float32Array(384))
        .mockRejectedValueOnce(new Error("embed error"));
      mockRepo.listByProject.mockReturnValue(memories);

      const completed = await service.reembedProject("proj-1");

      expect(completed).toBe(1);
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining("Failed to re-embed memory mem-fail"));
    });
  });
});
