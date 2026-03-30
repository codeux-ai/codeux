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
    getMemories: vi.fn(),
    updateMemory: vi.fn(),
    deleteMemory: vi.fn(),
    listByProject: vi.fn(),
    listBySprint: vi.fn(),
    listByAgent: vi.fn(),
    loadEmbeddingsForScope: vi.fn(),
    saveEmbedding: vi.fn(),
    countByScope: vi.fn(),
    countStaleEmbeddings: vi.fn(),
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

      mockRepo.createMemory.mockReturnValue(created);
      mockEmbeddingService.isLoaded.mockReturnValue(true);
      mockEmbeddingService.getLoadedModelId.mockReturnValue("bge-small-en-v1.5" as EmbeddingModelId);
      mockEmbeddingService.getDimension.mockReturnValue(384);
      mockEmbeddingService.embed.mockResolvedValue(new Float32Array(384));

      const result = await service.createMemory("proj-1", input);

      expect(mockRepo.createMemory).toHaveBeenCalledWith("proj-1", input);
      expect(mockEmbeddingService.embed).toHaveBeenCalledWith(created.content);
      expect(mockRepo.saveEmbedding).toHaveBeenCalledWith(
        "mem-new",
        "bge-small-en-v1.5",
        384,
        expect.any(Buffer),
      );
      expect(mockRepo.getMemory).not.toHaveBeenCalled();
      expect(result).toEqual(created);
    });

    it("works without model loaded (no embedding)", async () => {
      const created = makeMemoryRecord({ id: "mem-no-emb" });
      mockRepo.createMemory.mockReturnValue(created);
      mockEmbeddingService.isLoaded.mockReturnValue(false);

      const result = await service.createMemory("proj-1", input);

      expect(mockRepo.createMemory).toHaveBeenCalledWith("proj-1", input);
      expect(mockEmbeddingService.embed).not.toHaveBeenCalled();
      expect(mockRepo.saveEmbedding).not.toHaveBeenCalled();
      expect(mockRepo.getMemory).not.toHaveBeenCalled();
      expect(result).toEqual(created);
    });

    it("logs warning and returns record when embedding fails", async () => {
      const created = makeMemoryRecord({ id: "mem-fail" });
      mockRepo.createMemory.mockReturnValue(created);
      mockEmbeddingService.isLoaded.mockReturnValue(true);
      mockEmbeddingService.getLoadedModelId.mockReturnValue("bge-small-en-v1.5");
      mockEmbeddingService.getDimension.mockReturnValue(384);
      mockEmbeddingService.embed.mockRejectedValue(new Error("embed failed"));

      const result = await service.createMemory("proj-1", input);

      // Wait a tick for async embedding catch block to execute
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining("Failed to embed memory mem-fail"));
      expect(mockRepo.getMemory).not.toHaveBeenCalled();
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

    it("triggers embedding asynchronously for project-scoped memories when model is loaded", async () => {
      const updated = makeMemoryRecord({ id: "mem-proj", scope: "project", content: "updated proj content" });
      const input: UpdateMemoryInput = { content: "updated proj content" };

      mockRepo.updateMemory.mockReturnValue(updated);
      mockEmbeddingService.isLoaded.mockReturnValue(true);
      mockEmbeddingService.getLoadedModelId.mockReturnValue("bge-small-en-v1.5");
      mockEmbeddingService.getDimension.mockReturnValue(384);
      mockEmbeddingService.embed.mockResolvedValue(new Float32Array(384));

      const result = service.updateMemory("mem-proj", input);

      expect(result).toEqual(updated);
      expect(mockRepo.updateMemory).toHaveBeenCalledWith("mem-proj", input);

      // Wait a tick for async embedding to be called
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockEmbeddingService.embed).toHaveBeenCalledWith("updated proj content");
      expect(mockRepo.saveEmbedding).toHaveBeenCalledWith(
        "mem-proj",
        "bge-small-en-v1.5",
        384,
        expect.any(Buffer)
      );
    });

    it("logs warning if embedding update fails", async () => {
      const updated = makeMemoryRecord({ id: "mem-proj", scope: "project", content: "updated proj content" });
      const input: UpdateMemoryInput = { content: "updated proj content" };

      mockRepo.updateMemory.mockReturnValue(updated);
      mockEmbeddingService.isLoaded.mockReturnValue(true);
      mockEmbeddingService.getLoadedModelId.mockReturnValue("bge-small-en-v1.5");
      mockEmbeddingService.getDimension.mockReturnValue(384);
      mockEmbeddingService.embed.mockRejectedValue(new Error("embed failed"));

      service.updateMemory("mem-proj", input);

      // Wait a tick for async embedding to execute catch block
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining("Failed to embed updated memory mem-proj: Error: embed failed"));
    });

    it("does not trigger embedding for sprint-scoped memories", async () => {
      const updated = makeMemoryRecord({ id: "mem-sprint", scope: "sprint", content: "updated sprint content" });
      const input: UpdateMemoryInput = { content: "updated sprint content" };

      mockRepo.updateMemory.mockReturnValue(updated);
      mockEmbeddingService.isLoaded.mockReturnValue(true);

      const result = service.updateMemory("mem-sprint", input);

      expect(result).toEqual(updated);
      expect(mockRepo.updateMemory).toHaveBeenCalledWith("mem-sprint", input);

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockEmbeddingService.embed).not.toHaveBeenCalled();
    });

    it("does not trigger embedding if model is not loaded", () => {
      const updated = makeMemoryRecord({ id: "mem-proj", scope: "project", content: "updated proj content" });
      const input: UpdateMemoryInput = { content: "updated proj content" };

      mockRepo.updateMemory.mockReturnValue(updated);
      mockEmbeddingService.isLoaded.mockReturnValue(false);

      service.updateMemory("mem-proj", input);

      expect(mockEmbeddingService.embed).not.toHaveBeenCalled();
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

    it("passes through to repository without scope or limit", () => {
      const records = [makeMemoryRecord()];
      mockRepo.listByProject.mockReturnValue(records);

      expect(service.listByProject("proj-1")).toEqual(records);
      expect(mockRepo.listByProject).toHaveBeenCalledWith("proj-1", undefined, undefined);
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

  describe("listBySprintAndAgent", () => {
    it("passes through to repository", () => {
      const records = [makeMemoryRecord({ sprintId: "s-1", agentPresetId: "agent-1" })];
      mockRepo.listBySprintAndAgent = vi.fn().mockReturnValue(records);

      expect(service.listBySprintAndAgent("proj-1", "s-1", "agent-1", 10)).toEqual(records);
      expect(mockRepo.listBySprintAndAgent).toHaveBeenCalledWith("proj-1", "s-1", "agent-1", 10);
    });

    it("passes through to repository without limit", () => {
      const records = [makeMemoryRecord({ sprintId: "s-1", agentPresetId: "agent-1" })];
      mockRepo.listBySprintAndAgent = vi.fn().mockReturnValue(records);

      expect(service.listBySprintAndAgent("proj-1", "s-1", "agent-1")).toEqual(records);
      expect(mockRepo.listBySprintAndAgent).toHaveBeenCalledWith("proj-1", "s-1", "agent-1", undefined);
    });
  });

  describe("listLongTermByAgent", () => {
    it("passes through to repository", () => {
      const records = [makeMemoryRecord({ scope: "project", agentPresetId: "agent-1" })];
      mockRepo.listLongTermByAgent = vi.fn().mockReturnValue(records);

      expect(service.listLongTermByAgent("proj-1", "agent-1", 10)).toEqual(records);
      expect(mockRepo.listLongTermByAgent).toHaveBeenCalledWith("proj-1", "agent-1", 10);
    });

    it("passes through to repository without limit", () => {
      const records = [makeMemoryRecord({ scope: "project", agentPresetId: "agent-1" })];
      mockRepo.listLongTermByAgent = vi.fn().mockReturnValue(records);

      expect(service.listLongTermByAgent("proj-1", "agent-1")).toEqual(records);
      expect(mockRepo.listLongTermByAgent).toHaveBeenCalledWith("proj-1", "agent-1", undefined);
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
      mockRepo.getMemories.mockReturnValue([memA, memC]);

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

      expect(mockRepo.getMemories).toHaveBeenCalledWith(["mem-a", "mem-c"]);

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
        makeMemoryRecord({ id: "mem-3", content: "content 3" }),
      ];

      mockEmbeddingService.isLoaded.mockReturnValue(true);
      mockEmbeddingService.getLoadedModelId.mockReturnValue("bge-small-en-v1.5");
      mockEmbeddingService.getDimension.mockReturnValue(384);
      mockEmbeddingService.embed.mockResolvedValue(new Float32Array(384));
      mockRepo.listByProject.mockReturnValue(memories);

      const onProgress = vi.fn();
      const completed = await service.reembedProject("proj-1", onProgress);

      expect(completed).toBe(3);
      expect(mockRepo.listByProject).toHaveBeenCalledWith("proj-1", undefined, 10000);
      expect(mockEmbeddingService.embed).toHaveBeenCalledTimes(3);
      expect(mockRepo.saveEmbedding).toHaveBeenCalledTimes(3);
      // Wait to ensure all promises resolve
      expect(onProgress).toHaveBeenCalledWith(1, 3);
      expect(onProgress).toHaveBeenCalledWith(2, 3);
      expect(onProgress).toHaveBeenCalledWith(3, 3);
    });

    it("throws when model not loaded", async () => {
      mockEmbeddingService.isLoaded.mockReturnValue(false);

      await expect(service.reembedProject("proj-1")).rejects.toThrow("No embedding model loaded");
    });

    it("continues on individual embed failures and logs warnings", async () => {
      const memories = [
        makeMemoryRecord({ id: "mem-ok", content: "good" }),
        makeMemoryRecord({ id: "mem-fail", content: "bad" }),
        makeMemoryRecord({ id: "mem-ok-2", content: "good 2" }),
      ];

      mockEmbeddingService.isLoaded.mockReturnValue(true);
      mockEmbeddingService.getLoadedModelId.mockReturnValue("bge-small-en-v1.5");
      mockEmbeddingService.getDimension.mockReturnValue(384);
      mockEmbeddingService.embed.mockImplementation(async (content) => {
        if (content === "bad") throw new Error("embed error");
        return new Float32Array(384);
      });
      mockRepo.listByProject.mockReturnValue(memories);

      const completed = await service.reembedProject("proj-1");

      expect(completed).toBe(2);
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining("Failed to re-embed memory mem-fail"));
      expect(mockEmbeddingService.embed).toHaveBeenCalledTimes(3);
    });

    it("uses bounded concurrency", async () => {
      const memories = Array.from({ length: 10 }, (_, i) => makeMemoryRecord({ id: `mem-${i}`, content: `content ${i}` }));

      mockEmbeddingService.isLoaded.mockReturnValue(true);
      mockEmbeddingService.getLoadedModelId.mockReturnValue("bge-small-en-v1.5");
      mockEmbeddingService.getDimension.mockReturnValue(384);

      let maxConcurrent = 0;
      let currentConcurrent = 0;

      mockEmbeddingService.embed.mockImplementation(async () => {
        currentConcurrent++;
        if (currentConcurrent > maxConcurrent) maxConcurrent = currentConcurrent;
        await new Promise(resolve => setTimeout(resolve, 10)); // tiny delay
        currentConcurrent--;
        return new Float32Array(384);
      });

      mockRepo.listByProject.mockReturnValue(memories);

      const completed = await service.reembedProject("proj-1");

      expect(completed).toBe(10);
      expect(maxConcurrent).toBeLessThanOrEqual(5);
    });
  });

  describe("startReembedProject", () => {
    it("throws when model not loaded", () => {
      mockEmbeddingService.isLoaded.mockReturnValue(false);
      expect(() => service.startReembedProject("proj-1")).toThrow("No embedding model loaded");
    });

    it("throws when already in progress", () => {
      mockEmbeddingService.isLoaded.mockReturnValue(true);
      mockRepo.listByProject.mockReturnValue([makeMemoryRecord()]);
      mockEmbeddingService.getLoadedModelId.mockReturnValue("bge-small-en-v1.5");
      mockEmbeddingService.getDimension.mockReturnValue(384);
      mockEmbeddingService.embed.mockResolvedValue(new Float32Array(384));

      service.startReembedProject("proj-1");
      expect(() => service.startReembedProject("proj-1")).toThrow("Re-embedding already in progress");
    });

    it("sets progress state and completes", async () => {
      mockEmbeddingService.isLoaded.mockReturnValue(true);
      mockEmbeddingService.getLoadedModelId.mockReturnValue("bge-small-en-v1.5");
      mockEmbeddingService.getDimension.mockReturnValue(384);
      mockEmbeddingService.embed.mockResolvedValue(new Float32Array(384));
      mockRepo.listByProject.mockReturnValue([makeMemoryRecord()]);

      service.startReembedProject("proj-1");

      const progress = service.getReembedProgress();
      expect(progress).toBeTruthy();
      expect(progress!.total).toBe(1);
      expect(progress!.projectId).toBe("proj-1");

      // Wait for async completion
      await vi.waitFor(() => {
        expect(service.getReembedProgress()!.active).toBe(false);
      });
      expect(service.getReembedProgress()!.completed).toBe(1);
    });

    it("continues and logs warning if individual embed fails, but correct completion count", async () => {
      const memories = [
        makeMemoryRecord({ id: "mem-fail", content: "bad" }),
        makeMemoryRecord({ id: "mem-ok", content: "good" }),
      ];
      mockEmbeddingService.isLoaded.mockReturnValue(true);
      mockEmbeddingService.getLoadedModelId.mockReturnValue("bge-small-en-v1.5");
      mockEmbeddingService.getDimension.mockReturnValue(384);
      mockEmbeddingService.embed.mockImplementation(async (content) => {
        if (content === "bad") throw new Error("embed error");
        return new Float32Array(384);
      });
      mockRepo.listByProject.mockReturnValue(memories);

      service.startReembedProject("proj-1");

      await vi.waitFor(() => {
        expect(service.getReembedProgress()!.active).toBe(false);
      });

      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining("Failed to re-embed memory mem-fail"));
      expect(service.getReembedProgress()!.completed).toBe(1);
    });

    it("stops early if progress active flag is false", async () => {
      const memories = Array.from({ length: 10 }, (_, i) => makeMemoryRecord({ id: `mem-${i}`, content: `content ${i}` }));

      mockEmbeddingService.isLoaded.mockReturnValue(true);
      mockEmbeddingService.getLoadedModelId.mockReturnValue("bge-small-en-v1.5");
      mockEmbeddingService.getDimension.mockReturnValue(384);

      let processed = 0;
      mockEmbeddingService.embed.mockImplementation(async () => {
        processed++;
        await new Promise(resolve => setTimeout(resolve, 50));
        return new Float32Array(384);
      });
      mockRepo.listByProject.mockReturnValue(memories);

      service.startReembedProject("proj-1");

      // Cancel immediately
      const progress = service.getReembedProgress();
      if (progress) progress.active = false;

      // Wait for workers to exit
      await vi.waitFor(() => {
        expect(service.getReembedProgress()!.active).toBe(false);
      });

      expect(processed).toBeLessThan(10);
    });
  });

  describe("getReembedProgress", () => {
    it("returns null when no reembed has started", () => {
      expect(service.getReembedProgress()).toBeNull();
    });
  });

  describe("countByScope", () => {
    it("passes through to repository", () => {
      mockRepo.countByScope.mockReturnValue(42);
      expect(service.countByScope("proj-1", "sprint")).toBe(42);
      expect(mockRepo.countByScope).toHaveBeenCalledWith("proj-1", "sprint");
    });
  });

  describe("countStaleEmbeddings", () => {
    it("returns 0 when no model loaded", () => {
      mockEmbeddingService.getLoadedModelId.mockReturnValue(null);
      expect(service.countStaleEmbeddings("proj-1")).toBe(0);
    });

    it("delegates to repository with current model", () => {
      mockEmbeddingService.getLoadedModelId.mockReturnValue("bge-small-en-v1.5");
      mockRepo.countStaleEmbeddings.mockReturnValue(5);
      expect(service.countStaleEmbeddings("proj-1")).toBe(5);
      expect(mockRepo.countStaleEmbeddings).toHaveBeenCalledWith("proj-1", "bge-small-en-v1.5");
    });
  });

  describe("getEmbeddingMap", () => {
    it("returns empty result when no model loaded", () => {
      mockEmbeddingService.getLoadedModelId.mockReturnValue(null);
      const result = service.getEmbeddingMap("proj-1");
      expect(result).toEqual({ nodes: [], edges: [], hasEmbeddings: false });
    });

    it("handles single node without crashing", () => {
      mockEmbeddingService.getLoadedModelId.mockReturnValue("bge-small-en-v1.5");
      mockEmbeddingService.getDimension.mockReturnValue(3);
      mockRepo.loadEmbeddingsForScope.mockReturnValue([
        { id: "m1", embeddingBlob: makeFloat32Buffer([1, 0, 0]), embeddingDimension: 3 },
      ]);
      const result = service.getEmbeddingMap("proj-1");
      expect(result.nodes).toHaveLength(1);
      expect(result.edges).toHaveLength(0);
      // ((0 / 1) - 0.5) * 600 = -300
      expect(result.nodes[0].x).toBe(-300);
      expect(result.nodes[0].y).toBe(-300);
    });

    it("handles Uint8Array embeddings instead of Buffer", () => {
      mockEmbeddingService.getLoadedModelId.mockReturnValue("bge-small-en-v1.5");
      mockEmbeddingService.getDimension.mockReturnValue(1);
      mockRepo.loadEmbeddingsForScope.mockReturnValue([
        // Float32 1.0 is 0x3f800000 in little-endian => [0, 0, 128, 63]
        { id: "m1", embeddingBlob: new Uint8Array([0, 0, 128, 63]), embeddingDimension: 1 },
      ]);
      const result = service.getEmbeddingMap("proj-1");
      expect(result.nodes).toHaveLength(1);
    });

    it("returns empty result when no dimension", () => {
      mockEmbeddingService.getLoadedModelId.mockReturnValue("bge-small-en-v1.5");
      mockEmbeddingService.getDimension.mockReturnValue(null);
      const result = service.getEmbeddingMap("proj-1");
      expect(result).toEqual({ nodes: [], edges: [], hasEmbeddings: false });
    });

    it("returns empty result when no embeddings in scope", () => {
      mockEmbeddingService.getLoadedModelId.mockReturnValue("bge-small-en-v1.5");
      mockEmbeddingService.getDimension.mockReturnValue(3);
      mockRepo.loadEmbeddingsForScope.mockReturnValue([]);
      const result = service.getEmbeddingMap("proj-1");
      expect(result).toEqual({ nodes: [], edges: [], hasEmbeddings: false });
    });

    it("projects embeddings to 2D and computes similarity edges", () => {
      mockEmbeddingService.getLoadedModelId.mockReturnValue("bge-small-en-v1.5");
      mockEmbeddingService.getDimension.mockReturnValue(3);

      // Three vectors: first two are similar (close), third is different
      mockRepo.loadEmbeddingsForScope.mockReturnValue([
        { id: "m1", embeddingBlob: makeFloat32Buffer([1, 0, 0]), embeddingDimension: 3 },
        { id: "m2", embeddingBlob: makeFloat32Buffer([0.9, 0.1, 0]), embeddingDimension: 3 },
        { id: "m3", embeddingBlob: makeFloat32Buffer([0, 0, 1]), embeddingDimension: 3 },
      ]);

      const result = service.getEmbeddingMap("proj-1");

      expect(result.hasEmbeddings).toBe(true);
      expect(result.nodes).toHaveLength(3);
      expect(result.nodes[0].id).toBe("m1");
      expect(result.nodes[1].id).toBe("m2");
      expect(result.nodes[2].id).toBe("m3");

      // Each node should have numeric x,y coordinates
      for (const n of result.nodes) {
        expect(typeof n.x).toBe("number");
        expect(typeof n.y).toBe("number");
        expect(Number.isFinite(n.x)).toBe(true);
        expect(Number.isFinite(n.y)).toBe(true);
      }

      // m1 and m2 are very similar (cosine ≈ 0.994), should produce an edge
      const m1m2Edge = result.edges.find(
        e => (e.source === "m1" && e.target === "m2") || (e.source === "m2" && e.target === "m1"),
      );
      expect(m1m2Edge).toBeDefined();
      expect(m1m2Edge!.similarity).toBeGreaterThan(0.9);

      // Edges are sorted by similarity descending
      for (let i = 1; i < result.edges.length; i++) {
        expect(result.edges[i].similarity).toBeLessThanOrEqual(result.edges[i - 1].similarity);
      }
    });

    it("respects topKPerNode to limit edges", () => {
      mockEmbeddingService.getLoadedModelId.mockReturnValue("bge-small-en-v1.5");
      mockEmbeddingService.getDimension.mockReturnValue(3);

      mockRepo.loadEmbeddingsForScope.mockReturnValue([
        { id: "m1", embeddingBlob: makeFloat32Buffer([1, 0, 0]), embeddingDimension: 3 },
        { id: "m2", embeddingBlob: makeFloat32Buffer([0.9, 0.1, 0]), embeddingDimension: 3 },
        { id: "m3", embeddingBlob: makeFloat32Buffer([0, 0, 1]), embeddingDimension: 3 },
      ]);

      // topKPerNode=1: each node keeps only its single strongest neighbor
      const result = service.getEmbeddingMap("proj-1", undefined, undefined, undefined, 1);

      // m1↔m2 are each other's top-1. m3's top-1 is either m1 or m2. So 2 edges.
      expect(result.edges.length).toBeLessThanOrEqual(2);
      // m1↔m2 must be included (strongest pair)
      const m1m2 = result.edges.find(
        e => (e.source === "m1" && e.target === "m2") || (e.source === "m2" && e.target === "m1"),
      );
      expect(m1m2).toBeDefined();
    });

    it("passes scope parameters to repository", () => {
      mockEmbeddingService.getLoadedModelId.mockReturnValue("bge-small-en-v1.5");
      mockEmbeddingService.getDimension.mockReturnValue(3);
      mockRepo.loadEmbeddingsForScope.mockReturnValue([]);

      service.getEmbeddingMap("proj-1", "project", "s1", "a1");

      expect(mockRepo.loadEmbeddingsForScope).toHaveBeenCalledWith(
        "proj-1", "bge-small-en-v1.5", "project", "s1", "a1",
      );
    });
  });
});
