import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRemediationService } from "../../../src/services/memory-remediation-service.js";
import { createDefaultProviderSettings, DEFAULT_DASHBOARD_SETTINGS, DEFAULT_PROVIDER_CONFIG_IDS } from "../../../src/repositories/settings-defaults.js";
import type { MemoryRecord, PromotionCandidate } from "../../../src/contracts/memory-types.js";

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn().mockReturnThis(),
};

function makeMemory(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: "mem-1",
    projectId: "project-1",
    scope: "project",
    sprintId: null,
    agentPresetId: null,
    content: "Use a small focused sprint branch for isolated file edits.",
    category: "patterns",
    strength: 0.8,
    source: { type: "manual" },
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

function makeCandidate(overrides: Partial<PromotionCandidate> = {}): PromotionCandidate {
  const memory = makeMemory({
    id: "candidate-source-1",
    scope: "sprint",
    sprintId: "sprint-1",
    content: "Use dependency factory composition for service wiring.",
    category: "patterns",
    strength: 0.72,
  });
  return {
    id: memory.id,
    memory,
    clusterId: "cluster:candidate-source-1",
    claim: memory.content,
    evidenceMemoryIds: ["candidate-source-1", "supporting-memory-2", "supporting-memory-3"],
    evidenceCount: 3,
    riskFlags: [],
    score: 0.46,
    reason: "confirmed by 2 agents, clustered from 3 sprint memories",
    crossSprintCount: 1,
    ...overrides,
  };
}

function buildService(overrides: Record<string, unknown> = {}) {
  const executionRepository = {
    createExecutionInvocation: vi.fn().mockReturnValue({ id: "xi-remediation-skip" }),
    appendExecutionInvocationMessage: vi.fn(),
  };
  const deps = {
    memoryPromotionService: {
      analyzeForPromotion: vi.fn().mockResolvedValue([]),
      promoteMemories: vi.fn(),
      promoteCandidatesAsClaims: vi.fn().mockReturnValue([]),
    },
    memoryService: {
      listByProject: vi.fn().mockReturnValue([]),
      deleteMemory: vi.fn(),
    },
    taskService: {
      resolveInvocationProvider: vi.fn(),
    },
    structuredAgentRequestService: {
      executeRequest: vi.fn(),
    },
    executionRepository,
    getDashboardSettings: vi.fn().mockReturnValue({
      ...DEFAULT_DASHBOARD_SETTINGS,
      memory: {
        ...DEFAULT_DASHBOARD_SETTINGS.memory,
        enabled: true,
        remediationMode: "ai",
      },
    }),
    logger,
    ...overrides,
  };

  return {
    deps,
    executionRepository,
    service: new MemoryRemediationService(deps as any),
  };
}

describe("MemoryRemediationService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("records a completed remediation invocation when scheduled AI cleanup has no candidates", async () => {
    const { deps, executionRepository, service } = buildService();
    deps.memoryService.listByProject.mockReturnValue([makeMemory()]);

    const result = await service.remediateLongTermMemories({
      projectId: "project-1",
      repoPath: "/repo/project-1",
      mode: "ai",
    });

    expect(result).toEqual({
      mode: "ai",
      deleted: 0,
      reviewed: 1,
      aiUsed: false,
      skippedReason: "no_candidates",
    });
    expect(deps.structuredAgentRequestService.executeRequest).not.toHaveBeenCalled();
    expect(executionRepository.createExecutionInvocation).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project-1",
      type: "remediation",
      status: "completed",
      skipValidation: true,
      finishedAt: expect.any(String),
    }));
    expect(executionRepository.appendExecutionInvocationMessage).toHaveBeenCalledWith(
      "xi-remediation-skip",
      expect.objectContaining({
        role: "system",
        contentMarkdown: expect.stringContaining("no deterministic cleanup candidates"),
        metadata: expect.objectContaining({
          mode: "ai",
          remediationSkipped: true,
          skippedReason: "no_candidates",
          reviewedCount: 1,
          candidateCount: 0,
        }),
      }),
    );
  });

  it("records a completed remediation invocation when post-sprint AI remediation has no candidates", async () => {
    const { deps, executionRepository, service } = buildService();
    deps.memoryPromotionService.analyzeForPromotion.mockResolvedValue([]);

    const result = await service.remediateSprintMemories({
      projectId: "project-1",
      sprintId: "sprint-1",
      sprintRunId: "run-1",
      repoPath: "/repo/project-1",
      sprintName: "Sprint 1",
      sprintGoal: "Ship the feature",
    });

    expect(result).toEqual({
      mode: "ai",
      promoted: [],
      candidateCount: 0,
      aiUsed: false,
      skippedReason: "no_candidates",
    });
    expect(deps.structuredAgentRequestService.executeRequest).not.toHaveBeenCalled();
    expect(executionRepository.createExecutionInvocation).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project-1",
      sprintId: "sprint-1",
      sprintRunId: "run-1",
      type: "remediation",
      status: "completed",
      skipValidation: true,
    }));
    expect(executionRepository.appendExecutionInvocationMessage).toHaveBeenCalledWith(
      "xi-remediation-skip",
      expect.objectContaining({
        role: "system",
        contentMarkdown: expect.stringContaining("no promotion candidates"),
        metadata: expect.objectContaining({
          mode: "ai",
          remediationSkipped: true,
          skippedReason: "no_candidates",
          candidateCount: 0,
          eligibleCount: 0,
        }),
      }),
    );
  });

  it("uses compact candidate IDs for AI sprint remediation decisions", async () => {
    const provider = createDefaultProviderSettings("codex");
    const candidate = makeCandidate();
    const promoted = makeMemory({
      id: "promoted-1",
      scope: "project",
      promotedFromId: candidate.memory.id,
      promotionReason: "AI selected durable pattern",
    });
    const { deps, service } = buildService();
    deps.memoryPromotionService.analyzeForPromotion.mockResolvedValue([candidate]);
    deps.memoryPromotionService.promoteCandidatesAsClaims.mockReturnValue([promoted]);
    deps.taskService.resolveInvocationProvider.mockReturnValue({
      provider: "codex",
      providerConfigId: DEFAULT_PROVIDER_CONFIG_IDS.codex,
      providers: {
        [DEFAULT_PROVIDER_CONFIG_IDS.codex]: provider,
      },
    });
    deps.structuredAgentRequestService.executeRequest.mockImplementation(async (request: any) => ({
      parsed: request.parseFn(`{ "promote": [{ "id": "${candidate.id}", "reason": "AI selected durable pattern" }] }`),
    }));

    const result = await service.remediateSprintMemories({
      projectId: "project-1",
      sprintId: "sprint-1",
      sprintRunId: "run-1",
      repoPath: "/repo/project-1",
      sprintName: "Sprint 1",
      sprintGoal: "Ship the feature",
    });

    expect(result).toEqual({
      mode: "ai",
      promoted: [promoted],
      candidateCount: 1,
      aiUsed: true,
    });
    const request = deps.structuredAgentRequestService.executeRequest.mock.calls[0]![0] as { providerPrompt: string };
    expect(request.providerPrompt).toContain(`"id": "${candidate.id}"`);
    expect(request.providerPrompt).toContain('"evidenceCount": 3');
    expect(request.providerPrompt).toContain('"crossSprintCount": 1');
    expect(request.providerPrompt).not.toContain("supporting-memory-2");
    expect(request.providerPrompt).not.toContain("evidenceMemoryIds");
    expect(request.providerPrompt).not.toContain("clusterId");
    expect(deps.memoryPromotionService.promoteCandidatesAsClaims).toHaveBeenCalledWith(
      "project-1",
      [candidate],
      expect.any(Function),
    );
    const reasonFn = deps.memoryPromotionService.promoteCandidatesAsClaims.mock.calls[0]![2] as (item: PromotionCandidate) => string;
    expect(reasonFn(candidate)).toBe("AI selected durable pattern");
  });
});
