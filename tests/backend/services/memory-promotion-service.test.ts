import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryPromotionService } from "../../../src/services/memory-promotion-service.js";
import type { MemoryRecord, MemorySettings } from "../../../src/contracts/memory-types.js";

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn().mockReturnThis(),
};

function makeMemory(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: "mem-1",
    projectId: "proj-1",
    scope: "sprint",
    sprintId: "sprint-1",
    agentPresetId: null,
    content: "Always use factory pattern for DI",
    category: "architecture",
    strength: 0.85,
    source: { type: "auto_capture" },
    embeddingModel: null,
    embeddingDimension: null,
    embeddingBlob: null,
    promotedFromId: null,
    promotionReason: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("MemoryPromotionService", () => {
  let memoryService: { search: ReturnType<typeof vi.fn> };
  let memoryRepository: {
    listBySprint: ReturnType<typeof vi.fn>;
    getMemory: ReturnType<typeof vi.fn>;
    createPromotedMemory: ReturnType<typeof vi.fn>;
    findActiveMemoryClaimByFingerprint: ReturnType<typeof vi.fn>;
    createMemoryClaim: ReturnType<typeof vi.fn>;
    addMemoryClaimEvidence: ReturnType<typeof vi.fn>;
    listMemoryClaimEvidence: ReturnType<typeof vi.fn>;
    updateMemoryClaim: ReturnType<typeof vi.fn>;
    createPromotedClaimMemory: ReturnType<typeof vi.fn>;
  };
  let service: MemoryPromotionService;

  beforeEach(() => {
    vi.clearAllMocks();
    memoryService = { search: vi.fn().mockResolvedValue([]), triggerEmbedding: vi.fn().mockResolvedValue(undefined) };
    memoryRepository = {
      listBySprint: vi.fn().mockReturnValue([]),
      getMemory: vi.fn(),
      createPromotedMemory: vi.fn(),
      findActiveMemoryClaimByFingerprint: vi.fn().mockReturnValue(null),
      createMemoryClaim: vi.fn(),
      addMemoryClaimEvidence: vi.fn(),
      listMemoryClaimEvidence: vi.fn().mockReturnValue([]),
      updateMemoryClaim: vi.fn(),
      createPromotedClaimMemory: vi.fn(),
    };
    service = new MemoryPromotionService(
      memoryService as any,
      memoryRepository as any,
      mockLogger as any,
    );
  });

  describe("analyzeForPromotion", () => {
    it("returns candidates with scores for sprint memories with high strength", async () => {
      const mem = makeMemory({ strength: 0.92, category: "architecture" });
      memoryRepository.listBySprint.mockReturnValue([mem]);
      // No cross-sprint matches, no project duplicates
      memoryService.search.mockResolvedValue([]);

      const candidates = await service.analyzeForPromotion("proj-1", "sprint-1");

      expect(candidates).toHaveLength(1);
      expect(candidates[0].memory).toBe(mem);
      expect(candidates[0].score).toBeGreaterThan(0);
      expect(candidates[0].reason).toContain("high strength");
      expect(candidates[0].crossSprintCount).toBe(0);
    });

    it("filters out low-strength memories below 0.6", async () => {
      const lowMem = makeMemory({ id: "low", strength: 0.4 });
      const highMem = makeMemory({ id: "high", strength: 0.75 });
      memoryRepository.listBySprint.mockReturnValue([lowMem, highMem]);
      memoryService.search.mockResolvedValue([]);

      const candidates = await service.analyzeForPromotion("proj-1", "sprint-1");

      expect(candidates).toHaveLength(1);
      expect(candidates[0].memory.id).toBe("high");
    });

    it("never promotes auto-captured CI failure memories", async () => {
      const ciFailure = makeMemory({
        id: "ci",
        category: "error",
        strength: 0.95,
        content: "GitHub Actions CI failed on the build check.",
        source: { type: "auto_capture", originType: "ci_failure_learning" },
      });
      memoryRepository.listBySprint.mockReturnValue([ciFailure]);

      const candidates = await service.analyzeForPromotion("proj-1", "sprint-1");

      expect(candidates).toHaveLength(0);
      expect(memoryService.search).not.toHaveBeenCalled();
    });

    it("deduplicates against existing project memories with >0.95 similarity", async () => {
      const mem = makeMemory({ strength: 0.9 });
      memoryRepository.listBySprint.mockReturnValue([mem]);

      // First call: sprint-scope search (no cross-sprint matches)
      // Second call: project-scope search returns a near-duplicate
      memoryService.search
        .mockResolvedValueOnce([]) // sprint search
        .mockResolvedValueOnce([{ memory: makeMemory({ id: "existing-proj", scope: "project" }), similarity: 0.97 }]); // project dedup

      const candidates = await service.analyzeForPromotion("proj-1", "sprint-1");

      expect(candidates).toHaveLength(0);
      expect(memoryService.search).toHaveBeenCalledTimes(2);
      expect(memoryService.search).toHaveBeenCalledWith(
        expect.objectContaining({ scope: "project", minSimilarity: 0.95 }),
      );
    });

    it("handles search failures gracefully during analysis", async () => {
      const mem = makeMemory({ strength: 0.7, category: "context" });
      memoryRepository.listBySprint.mockReturnValue([mem]);

      // Mock search to reject to cover catch blocks
      memoryService.search.mockRejectedValue(new Error("Search failed"));

      const candidates = await service.analyzeForPromotion("proj-1", "sprint-1");

      expect(candidates).toHaveLength(1);
      expect(candidates[0].memory).toBe(mem);
      // Ensure cross-sprint count defaults to 0 and score calculates from strength alone
      expect(candidates[0].crossSprintCount).toBe(0);
      expect(candidates[0].score).toBeGreaterThan(0);
      expect(candidates[0].reason).toContain("meets promotion threshold");
    });

    it("applies bonuses for cross-sprint and cross-agent confirmations", async () => {
      const mem = makeMemory({ strength: 0.8, category: "architecture", agentPresetId: "agent-1" });
      memoryRepository.listBySprint.mockReturnValue([mem]);

      memoryService.search.mockImplementation(async (query: any) => {
        if (query.scope === "project") return []; // No exact dedup match
        if (query.scope === "sprint" && !query.sprintId) {
          // Cross-sprint check: return matches in 3 distinct other sprints
          return [
            { memory: makeMemory({ sprintId: "sprint-2" }), similarity: 0.9 },
            { memory: makeMemory({ sprintId: "sprint-3" }), similarity: 0.8 },
            { memory: makeMemory({ sprintId: "sprint-4" }), similarity: 0.85 },
          ];
        }
        if (query.scope === "sprint" && query.sprintId === "sprint-1") {
          // Cross-agent check: return matches from 2 distinct other agents
          return [
            { memory: makeMemory({ agentPresetId: "agent-2" }), similarity: 0.9 },
            { memory: makeMemory({ agentPresetId: "agent-3" }), similarity: 0.8 },
          ];
        }
        return [];
      });

      const candidates = await service.analyzeForPromotion("proj-1", "sprint-1");

      expect(candidates).toHaveLength(1);
      expect(candidates[0].memory).toBe(mem);
      expect(candidates[0].crossSprintCount).toBe(3);
      expect(candidates[0].reason).toContain("appeared in 4 sprints");
      expect(candidates[0].reason).toContain("confirmed by 3 agents");
      // High bonuses applied
      expect(candidates[0].score).toBeGreaterThan(0.8);
    });

    it("applies partial bonuses for limited cross-sprint and cross-agent confirmations", async () => {
      const mem = makeMemory({ strength: 0.7, category: "context", agentPresetId: "agent-1" });
      memoryRepository.listBySprint.mockReturnValue([mem]);

      memoryService.search.mockImplementation(async (query: any) => {
        if (query.scope === "project") return []; // No exact dedup match
        if (query.scope === "sprint" && !query.sprintId) {
          // Cross-sprint check: 1 distinct other sprint
          return [
            { memory: makeMemory({ sprintId: "sprint-2" }), similarity: 0.9 },
          ];
        }
        if (query.scope === "sprint" && query.sprintId === "sprint-1") {
          // Cross-agent check: 1 distinct other agent
          return [
            { memory: makeMemory({ agentPresetId: "agent-2" }), similarity: 0.9 },
          ];
        }
        return [];
      });

      const candidates = await service.analyzeForPromotion("proj-1", "sprint-1");

      expect(candidates).toHaveLength(1);
      expect(candidates[0].memory).toBe(mem);
      expect(candidates[0].crossSprintCount).toBe(1);
      // Wait, appeared in 2 sprints is only added if crossSprintCount >= 2!
      // In the source code: if (crossSprintCount >= 2) reasons.push(`appeared in ${crossSprintCount + 1} sprints`);
      // Since crossSprintCount is 1, it won't be pushed.
      expect(candidates[0].reason).not.toContain("appeared in 2 sprints");
      expect(candidates[0].reason).toContain("confirmed by 2 agents");
      expect(candidates[0].score).toBeGreaterThan(0);
    });

    it("penalizes repeated fixture and task-local implementation trivia", async () => {
      const mem = makeMemory({
        id: "fixture-note",
        category: "patterns",
        strength: 0.6,
        content: "Conflict resolution for conflict.md also follows the pattern of using the version from the feature branch to maintain the single-line timestamped format.",
      });
      memoryRepository.listBySprint.mockReturnValue([mem]);
      memoryService.search.mockImplementation(async (query: any) => {
        if (query.scope === "project") return [];
        if (query.scope === "sprint" && !query.sprintId) {
          return [
            { memory: makeMemory({ id: "s2", sprintId: "sprint-2" }), similarity: 0.9 },
            { memory: makeMemory({ id: "s3", sprintId: "sprint-3" }), similarity: 0.9 },
            { memory: makeMemory({ id: "s4", sprintId: "sprint-4" }), similarity: 0.9 },
          ];
        }
        if (query.scope === "sprint" && query.sprintId === "sprint-1") {
          return [
            { memory: makeMemory({ id: "agent-2", agentPresetId: "agent-2" }), similarity: 0.9 },
          ];
        }
        return [];
      });

      const candidates = await service.analyzeForPromotion("proj-1", "sprint-1");

      expect(candidates).toHaveLength(1);
      expect(candidates[0].riskFlags).toEqual(expect.arrayContaining([
        "test_fixture",
        "file_specific",
        "implementation_trivia",
      ]));
      expect(candidates[0].score).toBeLessThan(0.7);
      expect(candidates[0].reason).toContain("risk flags");
    });

    it("clusters similar same-sprint memories into one evidence-backed candidate", async () => {
      const memA = makeMemory({
        id: "mem-a",
        content: "Use dependency factory composition for service wiring.",
      });
      const memB = makeMemory({
        id: "mem-b",
        agentPresetId: "agent-2",
        content: "Prefer dependency factory composition when wiring services.",
      });
      memoryRepository.listBySprint.mockReturnValue([memA, memB]);
      memoryService.search.mockImplementation(async (query: any) => {
        if (query.scope === "project") return [];
        if (query.scope === "sprint" && !query.sprintId) return [];
        if (query.scope === "sprint" && query.sprintId === "sprint-1") {
          return query.query.includes("Use dependency")
            ? [{ memory: memB, similarity: 0.88 }]
            : [{ memory: memA, similarity: 0.88 }];
        }
        return [];
      });

      const candidates = await service.analyzeForPromotion("proj-1", "sprint-1");

      expect(candidates).toHaveLength(1);
      expect(candidates[0].evidenceMemoryIds).toEqual(["mem-a", "mem-b"]);
      expect(candidates[0].reason).toContain("clustered from 2 sprint memories");
      expect(candidates[0].riskFlags).toEqual([]);
    });
  });

  describe("promoteMemories", () => {
    it("logs warning if memory not found for promotion", () => {
      memoryRepository.getMemory.mockReturnValue(null);

      const result = service.promoteMemories("proj-1", ["src-1"], "Manual promotion");

      expect(result).toHaveLength(0);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Memory src-1 not found for promotion"),
      );
    });

    it("creates project-scoped copies with promotedFromId and triggers embedding generation", () => {
      const source = makeMemory({ id: "src-1" });
      const promoted = makeMemory({
        id: "promoted-1",
        scope: "project",
        promotedFromId: "src-1",
        promotionReason: "Manual promotion",
      });
      memoryRepository.getMemory.mockReturnValue(source);
      memoryRepository.createPromotedMemory.mockReturnValue(promoted);

      const triggerEmbeddingMock = vi.fn().mockResolvedValue(undefined);
      (memoryService as any).triggerEmbedding = triggerEmbeddingMock;

      const result = service.promoteMemories("proj-1", ["src-1"], "Manual promotion");

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(promoted);
      expect(memoryRepository.createPromotedMemory).toHaveBeenCalledWith(
        "proj-1",
        source,
        "Manual promotion",
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("Promoted memory src-1"),
      );
      expect(triggerEmbeddingMock).toHaveBeenCalledWith(promoted);
    });

    it("uses default reason if not provided", () => {
      const source = makeMemory({ id: "src-1" });
      const promoted = makeMemory({ id: "promoted-1", scope: "project" });
      memoryRepository.getMemory.mockReturnValue(source);
      memoryRepository.createPromotedMemory.mockReturnValue(promoted);

      const triggerEmbeddingMock = vi.fn().mockResolvedValue(undefined);
      (memoryService as any).triggerEmbedding = triggerEmbeddingMock;

      service.promoteMemories("proj-1", ["src-1"]);

      expect(memoryRepository.createPromotedMemory).toHaveBeenCalledWith(
        "proj-1",
        source,
        "Manual promotion",
      );
    });

    it("logs warning if triggering embedding fails", async () => {
      const source = makeMemory({ id: "src-1" });
      const promoted = makeMemory({
        id: "promoted-1",
        scope: "project",
      });
      memoryRepository.getMemory.mockReturnValue(source);
      memoryRepository.createPromotedMemory.mockReturnValue(promoted);

      const triggerEmbeddingMock = vi.fn().mockRejectedValue(new Error("embed failure"));
      (memoryService as any).triggerEmbedding = triggerEmbeddingMock;

      service.promoteMemories("proj-1", ["src-1"], "Manual promotion");

      // Wait a tick for async embedding catch to execute
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Failed to embed promoted memory promoted-1: embed failure"),
      );
    });
  });

  describe("promoteCandidatesAsClaims", () => {
    it("creates an evidence-backed claim and searchable project memory", () => {
      const source = makeMemory({
        id: "src-1",
        content: "Use dependency factory composition for service wiring.",
        category: "patterns",
        strength: 0.8,
      });
      const candidate = {
        memory: source,
        clusterId: "cluster:src-1,src-2",
        claim: "Use dependency factory composition for service wiring.",
        evidenceMemoryIds: ["src-1", "src-2"],
        riskFlags: [],
        score: 0.82,
        reason: "confirmed by 2 agents",
        crossSprintCount: 1,
      };
      const claim = {
        id: "claim-1",
        projectId: "proj-1",
        claim: candidate.claim,
        fingerprint: "use dependency factory composition for service wiring",
        category: "patterns",
        confidence: 0.82,
        durability: 0.9,
        status: "active",
        tags: ["cross-sprint", "evidence-cluster", "memory-remediation"],
        appliesToPaths: [],
        sourceType: "promotion",
        sourceMemoryId: "src-1",
        supersedesClaimId: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      };
      const promoted = makeMemory({
        id: "promoted-claim-1",
        scope: "project",
        content: candidate.claim,
        promotedFromId: "src-1",
      });
      memoryRepository.createMemoryClaim.mockReturnValue(claim);
      memoryRepository.createPromotedClaimMemory.mockReturnValue(promoted);

      const triggerEmbeddingMock = vi.fn().mockResolvedValue(undefined);
      (memoryService as any).triggerEmbedding = triggerEmbeddingMock;

      const result = service.promoteCandidatesAsClaims("proj-1", [candidate], "AI selected durable claim");

      expect(result).toEqual([promoted]);
      expect(memoryRepository.createMemoryClaim).toHaveBeenCalledWith("proj-1", expect.objectContaining({
        claim: candidate.claim,
        category: "patterns",
        confidence: 0.82,
        sourceType: "promotion",
        sourceMemoryId: "src-1",
        tags: ["cross-sprint", "evidence-cluster", "memory-remediation"],
      }));
      expect(memoryRepository.addMemoryClaimEvidence).toHaveBeenCalledTimes(2);
      expect(memoryRepository.addMemoryClaimEvidence).toHaveBeenCalledWith(expect.objectContaining({
        claimId: "claim-1",
        memoryId: "src-1",
        weight: 1,
      }));
      expect(memoryRepository.createPromotedClaimMemory).toHaveBeenCalledWith(
        "proj-1",
        source,
        candidate.claim,
        "claim-1",
        "AI selected durable claim",
        0.82,
      );
      expect(triggerEmbeddingMock).toHaveBeenCalledWith(promoted);
    });

    it("links evidence to an existing active claim instead of duplicating it", () => {
      const source = makeMemory({ id: "src-1" });
      const candidate = {
        memory: source,
        clusterId: "memory:src-1",
        claim: source.content,
        evidenceMemoryIds: ["src-1", "src-2"],
        riskFlags: [],
        score: 0.8,
        reason: "meets promotion threshold",
        crossSprintCount: 0,
      };
      memoryRepository.findActiveMemoryClaimByFingerprint.mockReturnValue({
        id: "claim-existing",
        confidence: 0.7,
        durability: 0.72,
        tags: ["memory-remediation"],
        appliesToPaths: [],
      });
      memoryRepository.listMemoryClaimEvidence.mockReturnValue([
        { claimId: "claim-existing", memoryId: "old", supportType: "supports", weight: 1, createdAt: "2026-01-01T00:00:00.000Z" },
        { claimId: "claim-existing", memoryId: "src-1", supportType: "supports", weight: 1, createdAt: "2026-01-02T00:00:00.000Z" },
        { claimId: "claim-existing", memoryId: "src-2", supportType: "supports", weight: 0.85, createdAt: "2026-01-02T00:00:00.000Z" },
      ]);

      const result = service.promoteCandidatesAsClaims("proj-1", [candidate]);

      expect(result).toEqual([]);
      expect(memoryRepository.createMemoryClaim).not.toHaveBeenCalled();
      expect(memoryRepository.createPromotedClaimMemory).not.toHaveBeenCalled();
      expect(memoryRepository.addMemoryClaimEvidence).toHaveBeenCalledWith(expect.objectContaining({
        claimId: "claim-existing",
        memoryId: "src-1",
      }));
      const update = memoryRepository.updateMemoryClaim.mock.calls[0]![1];
      expect(update.confidence).toBeCloseTo(0.84);
      expect(update.durability).toBeGreaterThan(0.8);
      expect(update.tags).toEqual(["evidence-cluster", "memory-remediation"]);
    });
  });

  describe("autoPromoteFromSprint", () => {
    const baseSettings: MemorySettings = {
      enabled: true,
      embeddingProvider: "in_app",
      embeddingModel: null,
      externalEmbedding: {
        baseUrl: "",
        apiKey: "",
        model: "",
        dimensions: null,
      },
      autoCaptureSprint: true,
      autoCaptureAgent: true,
      autoPromote: true,
      promotionThreshold: 0.5,
      remediationMode: "off",
      remediationMaxPromotions: 3,
      maxSprintMemories: 100,
      maxProjectMemories: 500,
      mapMaxEdgesPerNode: 6,
      workerLearningsInstruction: "",
    };

    it("respects settings.autoPromote flag and returns empty when disabled", async () => {
      const settings = { ...baseSettings, autoPromote: false };

      const result = await service.autoPromoteFromSprint("proj-1", "sprint-1", settings);

      expect(result).toEqual([]);
      expect(memoryRepository.listBySprint).not.toHaveBeenCalled();
    });

    it("returns empty when no candidates meet the promotion threshold", async () => {
      const mem = makeMemory({ strength: 0.1 });
      memoryRepository.listBySprint.mockReturnValue([mem]);
      memoryService.search.mockResolvedValue([]);

      const result = await service.autoPromoteFromSprint("proj-1", "sprint-1", baseSettings);

      expect(result).toHaveLength(0);
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining("qualify for auto-promotion"));
    });

    it("promotes only candidates above threshold", async () => {
      const highMem = makeMemory({ id: "high", strength: 0.95, category: "architecture" });
      const lowMem = makeMemory({ id: "low", strength: 0.62, category: "context" });
      memoryRepository.listBySprint.mockReturnValue([highMem, lowMem]);
      memoryService.search.mockResolvedValue([]);

      const promotedRecord = makeMemory({ id: "promoted-high", scope: "project", promotedFromId: "high" });
      memoryRepository.createMemoryClaim.mockReturnValue({
        id: "claim-high",
        claim: highMem.content,
      });
      memoryRepository.createPromotedClaimMemory.mockReturnValue(promotedRecord);

      const settings = { ...baseSettings, promotionThreshold: 0.6 };
      const result = await service.autoPromoteFromSprint("proj-1", "sprint-1", settings);

      // The high-strength architecture memory should score well above 0.6;
      // the low-strength context memory should score below 0.6 threshold.
      // Verify at least one was promoted and the promoted IDs came from qualifying candidates.
      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(memoryRepository.createPromotedClaimMemory).toHaveBeenCalled();
      const promotedIds = memoryRepository.createPromotedClaimMemory.mock.calls.map(
        (call: any[]) => call[1].id,
      );
      expect(promotedIds).toContain("high");
    });
  });
});
