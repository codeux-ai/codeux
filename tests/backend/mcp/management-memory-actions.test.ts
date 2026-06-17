import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryActions } from "../../../src/mcp/management/memory-actions.js";
import type { MemoryService } from "../../../src/services/memory-service.js";
import type { MemoryPromotionService } from "../../../src/services/memory-promotion-service.js";
import type { EmbeddingModelManager } from "../../../src/services/embedding-model-manager.js";

describe("MemoryActions", () => {
  let memoryService: unknown;
  let memoryPromotionService: unknown;
  let embeddingModelManager: unknown;
  let actions: MemoryActions;

  beforeEach(() => {
    memoryService = {
      search: vi.fn().mockResolvedValue([{ memory: { id: "mem-1" }, similarity: 0.9 }]),
      listByProject: vi.fn().mockReturnValue([{ id: "mem-2" }]),
      getMemory: vi.fn().mockReturnValue({ id: "mem-1" }),
      createMemory: vi.fn().mockResolvedValue({ id: "mem-new" }),
      updateMemory: vi.fn().mockReturnValue({ id: "mem-1", content: "updated" }),
      deleteMemory: vi.fn(),
      startReembedProject: vi.fn(),
      getEmbeddingMap: vi.fn().mockReturnValue({ nodes: [], edges: [], hasEmbeddings: true }),
      countByScope: vi.fn().mockReturnValue(10),
      countStaleEmbeddings: vi.fn().mockReturnValue(2),
    };

    memoryPromotionService = {
      promoteMemories: vi.fn().mockReturnValue([{ id: "mem-promoted" }]),
    };

    embeddingModelManager = {
      getStatuses: vi.fn().mockReturnValue([{ id: "model-1", downloaded: true }]),
    };

    actions = new MemoryActions(
      memoryService as unknown as MemoryService,
      memoryPromotionService as unknown as MemoryPromotionService,
      embeddingModelManager as unknown as EmbeddingModelManager,
    );
  });

  it("rejects searching with missing query", async () => {
    await expect(actions.handleMemoryAction({
      domain: "memory",
      action: "search",
      payload: { projectId: "proj-1" },
    })).rejects.toThrow("query is required");
  });

  it("handles invalid limits gracefully by dropping them", async () => {
    await actions.handleMemoryAction({
      domain: "memory",
      action: "search",
      payload: { projectId: "proj-1", query: "test", limit: "invalid" },
    });
    expect(memoryService.search).toHaveBeenCalledWith(expect.objectContaining({
      limit: undefined,
    }));
  });

  it("handles searching memories", async () => {
    const res = await actions.handleMemoryAction({
      domain: "memory",
      action: "search",
      payload: { projectId: "proj-1", query: "test" },
    });
    expect(res.result).toEqual({ results: [{ memory: { id: "mem-1" }, similarity: 0.9 }] });
    expect(memoryService.search).toHaveBeenCalledWith({
      projectId: "proj-1",
      query: "test",
      scope: undefined,
      sprintId: undefined,
      agentPresetId: undefined,
      limit: undefined,
      minSimilarity: undefined,
    });
  });

  it("handles listing memories", async () => {
    const res = await actions.handleMemoryAction({
      domain: "memory",
      action: "list",
      payload: { projectId: "proj-1" },
    });
    expect(res.result).toEqual({ memories: [{ id: "mem-2" }] });
  });

  it("handles getting a single memory", async () => {
    const res = await actions.handleMemoryAction({
      domain: "memory",
      action: "get",
      payload: { memoryId: "mem-1" },
    });
    expect(res.result).toEqual({ memory: { id: "mem-1" } });
  });

  it("handles creating a memory", async () => {
    const res = await actions.handleMemoryAction({
      domain: "memory",
      action: "create",
      payload: { projectId: "proj-1", content: "new info" },
    });
    expect(res.result).toEqual({ memory: { id: "mem-new" } });
  });

  it("handles updating a memory", async () => {
    const res = await actions.handleMemoryAction({
      domain: "memory",
      action: "update",
      payload: { memoryId: "mem-1", content: "updated" },
    });
    expect(res.result).toEqual({ memory: { id: "mem-1", content: "updated" } });
  });

  it("requires approval for deleting a memory", async () => {
    const res = await actions.handleMemoryAction({
      domain: "memory",
      action: "delete",
      payload: { memoryId: "mem-1" },
    });
    expect(res.approvalRequired).toBe(true);
    expect(memoryService.deleteMemory).not.toHaveBeenCalled();
  });

  it("allows deleting a memory with explicit approval", async () => {
    const res = await actions.handleMemoryAction({
      domain: "memory",
      action: "delete",
      payload: { memoryId: "mem-1" },
      approval: { confirmed: true },
    });
    expect(res.result).toEqual({ success: true });
    expect(memoryService.deleteMemory).toHaveBeenCalledWith("mem-1");
  });

  it("handles promoting a memory", async () => {
    const res = await actions.handleMemoryAction({
      domain: "memory",
      action: "promote",
      payload: { projectId: "proj-1", memoryIds: ["mem-1"] },
    });
    expect(res.result).toEqual({ promoted: [{ id: "mem-promoted" }] });
    expect(memoryPromotionService.promoteMemories).toHaveBeenCalledWith("proj-1", ["mem-1"], undefined);
  });

  it("handles getting embedding model status", async () => {
    const res = await actions.handleMemoryAction({
      domain: "memory",
      action: "model_status",
      payload: {},
    });
    expect(res.result).toEqual({ status: [{ id: "model-1", downloaded: true }] });
  });
});
