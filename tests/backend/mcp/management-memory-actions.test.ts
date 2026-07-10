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
      createProjectMemoryClaim: vi.fn().mockResolvedValue({
        claim: { id: "claim-1", claim: "Use durable project memory.", category: "learning" },
        mirrorMemory: { id: "mem-claim-1", source: { type: "manual", originType: "memory_claim", originId: "claim-1" } },
      }),
      listMemoryClaims: vi.fn().mockReturnValue([{ id: "claim-1" }]),
      getMemoryClaim: vi.fn().mockReturnValue({ id: "claim-1", claim: "Use durable project memory." }),
      updateMemoryClaim: vi.fn().mockReturnValue({ id: "claim-1", claim: "Updated claim" }),
      addMemoryClaimEvidence: vi.fn().mockReturnValue({ claimId: "claim-1", memoryId: "mem-1", supportType: "supports", weight: 0.8 }),
      deprecateMemoryClaim: vi.fn().mockReturnValue({ id: "claim-1", status: "deprecated" }),
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

  it("creates a durable memory claim with a project-scope mirror", async () => {
    const res = await actions.handleMemoryAction({
      domain: "memory",
      action: "create_claim",
      payload: {
        projectId: "proj-1",
        claim: "Use durable project memory.",
        category: "learning",
        confidence: 0.9,
        durability: 0.85,
        tags: [" durable "],
        appliesToPaths: ["src/services/memory-service.ts"],
        sourceMemoryId: "mem-1",
        supportType: "supports",
        weight: 0.8,
      },
    });

    expect(res.result).toEqual({
      claim: { id: "claim-1", claim: "Use durable project memory.", category: "learning" },
      mirrorMemory: { id: "mem-claim-1", source: { type: "manual", originType: "memory_claim", originId: "claim-1" } },
    });
    expect(memoryService.createProjectMemoryClaim).toHaveBeenCalledWith(
      "proj-1",
      {
        claim: "Use durable project memory.",
        category: "learning",
        confidence: 0.9,
        durability: 0.85,
        tags: ["durable"],
        appliesToPaths: ["src/services/memory-service.ts"],
        sourceType: "manual",
        sourceMemoryId: "mem-1",
        supersedesClaimId: undefined,
      },
      { memoryId: "mem-1", supportType: "supports", weight: 0.8 },
    );
  });

  it("adds long-term memory through the dedicated Project manager lane", async () => {
    const res = await actions.addLongTermMemory({
      projectId: "proj-1",
      memory: "Use dependency-aware sprint tasks.",
      category: "patterns",
      confidence: 0.95,
      durability: 0.9,
      tags: [" planning "],
      appliesToPaths: ["src/sprint"],
      sourceMemoryId: "mem-1",
    });

    expect(memoryService.createProjectMemoryClaim).toHaveBeenCalledWith(
      "proj-1",
      {
        claim: "Use dependency-aware sprint tasks.",
        category: "patterns",
        confidence: 0.95,
        durability: 0.9,
        tags: ["planning"],
        appliesToPaths: ["src/sprint"],
        sourceType: "manual",
        sourceMemoryId: "mem-1",
      },
      { memoryId: "mem-1", supportType: "supports", weight: 1 },
    );
    expect(res.result).toMatchObject({
      claim: { id: "claim-1" },
      mirrorMemory: { id: "mem-claim-1" },
      richWidget: {
        type: "memory",
        data: {
          memory: "Use dependency-aware sprint tasks.",
          category: "patterns",
          claimId: "claim-1",
          memoryId: "mem-claim-1",
          status: "stored",
        },
      },
    });
  });

  it("rejects blank dedicated long-term memories", async () => {
    await expect(actions.addLongTermMemory({
      projectId: "proj-1",
      memory: "   ",
    })).rejects.toThrow("memory is required");
    expect(memoryService.createProjectMemoryClaim).not.toHaveBeenCalled();
  });

  it("propagates durable-memory persistence failures", async () => {
    vi.mocked((memoryService as Pick<MemoryService, "createProjectMemoryClaim">).createProjectMemoryClaim)
      .mockRejectedValueOnce(new Error("memory persistence unavailable"));

    await expect(actions.addLongTermMemory({
      projectId: "proj-1",
      memory: "Keep this durable.",
    })).rejects.toThrow("memory persistence unavailable");
  });

  it("rejects blank memory claims with a management validation error", async () => {
    await expect(actions.handleMemoryAction({
      domain: "memory",
      action: "create_claim",
      payload: { projectId: "proj-1", claim: "   " },
    })).rejects.toThrow("claim is required");
  });

  it("rejects invalid claim enums with a management validation error", async () => {
    await expect(actions.handleMemoryAction({
      domain: "memory",
      action: "create_claim",
      payload: { projectId: "proj-1", claim: "Valid claim", category: "not-a-category" },
    })).rejects.toThrow("Invalid value for category");
  });

  it("lists memory claims with filters", async () => {
    const res = await actions.handleMemoryAction({
      domain: "memory",
      action: "list_claims",
      payload: { projectId: "proj-1", status: "active", category: "learning", limit: 5 },
    });

    expect(res.result).toEqual({ claims: [{ id: "claim-1" }] });
    expect(memoryService.listMemoryClaims).toHaveBeenCalledWith("proj-1", {
      status: "active",
      category: "learning",
      limit: 5,
    });
  });

  it("gets a project-scoped memory claim", async () => {
    const res = await actions.handleMemoryAction({
      domain: "memory",
      action: "get_claim",
      payload: { projectId: "proj-1", claimId: "claim-1" },
    });

    expect(res.result).toEqual({ claim: { id: "claim-1", claim: "Use durable project memory." } });
    expect(memoryService.getMemoryClaim).toHaveBeenCalledWith("proj-1", "claim-1");
  });

  it("updates a memory claim", async () => {
    const res = await actions.handleMemoryAction({
      domain: "memory",
      action: "update_claim",
      payload: {
        projectId: "proj-1",
        claimId: "claim-1",
        claim: "Updated claim",
        category: "patterns",
        confidence: 0.7,
        durability: 0.9,
        status: "active",
        tags: ["updated"],
        appliesToPaths: ["src/mcp/management/memory-actions.ts"],
        supersedesClaimId: null,
      },
    });

    expect(res.result).toEqual({ claim: { id: "claim-1", claim: "Updated claim" } });
    expect(memoryService.updateMemoryClaim).toHaveBeenCalledWith("proj-1", "claim-1", {
      claim: "Updated claim",
      category: "patterns",
      confidence: 0.7,
      durability: 0.9,
      status: "active",
      tags: ["updated"],
      appliesToPaths: ["src/mcp/management/memory-actions.ts"],
      supersedesClaimId: null,
    });
  });

  it("adds memory claim evidence", async () => {
    const res = await actions.handleMemoryAction({
      domain: "memory",
      action: "add_claim_evidence",
      payload: { projectId: "proj-1", claimId: "claim-1", memoryId: "mem-1", supportType: "supports", weight: 0.8 },
    });

    expect(res.result).toEqual({ evidence: { claimId: "claim-1", memoryId: "mem-1", supportType: "supports", weight: 0.8 } });
    expect(memoryService.addMemoryClaimEvidence).toHaveBeenCalledWith("proj-1", {
      claimId: "claim-1",
      memoryId: "mem-1",
      supportType: "supports",
      weight: 0.8,
    });
  });

  it("requires approval before deprecating a memory claim", async () => {
    const res = await actions.handleMemoryAction({
      domain: "memory",
      action: "deprecate_claim",
      payload: { projectId: "proj-1", claimId: "claim-1" },
    });

    expect(res.approvalRequired).toBe(true);
    expect(memoryService.deprecateMemoryClaim).not.toHaveBeenCalled();
  });

  it("deprecates a memory claim after explicit approval", async () => {
    const res = await actions.handleMemoryAction({
      domain: "memory",
      action: "deprecate_claim",
      payload: { projectId: "proj-1", claimId: "claim-1" },
      approval: { confirmed: true },
    });

    expect(res.result).toEqual({ success: true, claim: { id: "claim-1", status: "deprecated" } });
    expect(memoryService.deprecateMemoryClaim).toHaveBeenCalledWith("proj-1", "claim-1");
  });
});
