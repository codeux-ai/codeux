import type { DashboardSettings, DashboardSettingsScope, ProviderId, Subtask } from "../contracts/app-types.js";
import type { MemoryRecord, MemorySettings, PromotionCandidate } from "../contracts/memory-types.js";
import type { Logger } from "../shared/logging/logger.js";
import type { GuardrailService } from "./guardrail-service.js";
import type { MemoryPromotionService } from "./memory-promotion-service.js";
import type { MemoryService } from "./memory-service.js";
import { isCiFailureMemoryContent } from "./memory-service.js";
import type { TaskService } from "./task-service.js";
import type { StructuredAgentRequestService } from "./structured-agent-request-service.js";
import type { ExecutionRepository } from "../repositories/execution-repository.js";
import { buildProviderPrompt } from "./cli-workflow-utils.js";
import { DEFAULT_CLI_WORKFLOW_SETTINGS } from "./cli-workflow-utils.js";

interface MemoryRemediationDeps {
  memoryPromotionService: MemoryPromotionService;
  memoryService: MemoryService;
  taskService: TaskService;
  structuredAgentRequestService: StructuredAgentRequestService;
  executionRepository?: Pick<ExecutionRepository, "createExecutionInvocation" | "appendExecutionInvocationMessage">;
  guardrailService?: GuardrailService;
  getDashboardSettings: (scope?: DashboardSettingsScope) => DashboardSettings;
  getGithubToken?: () => string | undefined;
  logger: Logger;
}

export interface MemoryRemediationRunResult {
  mode: MemorySettings["remediationMode"];
  promoted: MemoryRecord[];
  candidateCount: number;
  aiUsed: boolean;
  skippedReason?: string;
}

interface AiRemediationResponse {
  promote: Array<{ id: string; reason?: string }>;
  delete?: Array<{ id: string; reason?: string }>;
}

export class MemoryRemediationService {
  constructor(private readonly deps: MemoryRemediationDeps) {}

  async remediateLongTermMemories(args: {
    projectId: string;
    repoPath: string;
    mode?: Exclude<MemorySettings["remediationMode"], "off">;
  }): Promise<{ mode: "deterministic" | "ai"; deleted: number; reviewed: number; aiUsed: boolean; skippedReason?: string }> {
    const settings = this.deps.getDashboardSettings({ projectId: args.projectId });
    const mode = args.mode || (settings.memory.remediationMode === "ai" ? "ai" : "deterministic");
    if (!settings.memory.enabled) {
      if (mode === "ai") {
        this.recordSkippedAiInvocation({
          projectId: args.projectId,
          skippedReason: "disabled",
          summary: "AI long-term memory remediation was skipped because memory is disabled.",
        });
      }
      return { mode, deleted: 0, reviewed: 0, aiUsed: false, skippedReason: "disabled" };
    }

    const memories = this.deps.memoryService.listByProject(args.projectId, "project", settings.memory.maxProjectMemories);
    const cleanupCandidates = this.findLongTermCleanupCandidates(memories);
    let selectedIds = cleanupCandidates.map((candidate) => candidate.id);
    let aiUsed = false;

    if (mode === "ai" && cleanupCandidates.length === 0) {
      this.recordSkippedAiInvocation({
        projectId: args.projectId,
        skippedReason: "no_candidates",
        reviewedCount: memories.length,
        candidateCount: 0,
        summary: "AI long-term memory remediation found no deterministic cleanup candidates to review.",
      });
      return { mode, deleted: 0, reviewed: memories.length, aiUsed: false, skippedReason: "no_candidates" };
    }

    if (mode === "ai" && cleanupCandidates.length > 0) {
      const guardrailKey = `long-term-memory-remediation:${args.projectId}`;
      const guardrail = this.deps.guardrailService?.evaluate({ projectId: args.projectId }, guardrailKey, "remediation") ?? null;
      if (guardrail && !guardrail.allowed && guardrail.action !== "WARN_ONLY") {
        this.recordSkippedAiInvocation({
          projectId: args.projectId,
          skippedReason: `guardrail:${guardrail.count}/${guardrail.cap}`,
          reviewedCount: memories.length,
          candidateCount: cleanupCandidates.length,
          summary: `AI long-term memory remediation was blocked by the remediation guardrail (${guardrail.count}/${guardrail.cap}).`,
        });
        return { mode, deleted: 0, reviewed: memories.length, aiUsed: false, skippedReason: `guardrail:${guardrail.count}/${guardrail.cap}` };
      }
      this.deps.guardrailService?.record({ projectId: args.projectId }, guardrailKey, "remediation");
      const decision = await this.runAiLongTermRemediation({
        projectId: args.projectId,
        repoPath: args.repoPath,
        settings,
        candidates: cleanupCandidates,
      });
      const allowedIds = new Set(cleanupCandidates.map((candidate) => candidate.id));
      selectedIds = (decision.delete || []).map((item) => item.id).filter((id) => allowedIds.has(id));
      aiUsed = true;
    }

    for (const id of selectedIds) {
      this.deps.memoryService.deleteMemory(id);
    }

    return { mode, deleted: selectedIds.length, reviewed: memories.length, aiUsed };
  }

  async remediateSprintMemories(args: {
    projectId: string;
    sprintId: string;
    sprintRunId?: string | null;
    repoPath: string;
    sprintName?: string;
    sprintGoal?: string;
  }): Promise<MemoryRemediationRunResult> {
    const scope = { projectId: args.projectId, sprintId: args.sprintId };
    const settings = this.deps.getDashboardSettings(scope);
    const memorySettings = settings.memory;

    if (!memorySettings.enabled || memorySettings.remediationMode === "off") {
      if (memorySettings.remediationMode === "ai") {
        this.recordSkippedAiInvocation({
          projectId: args.projectId,
          sprintId: args.sprintId,
          sprintRunId: args.sprintRunId || null,
          skippedReason: "disabled",
          summary: "AI sprint memory remediation was skipped because memory is disabled.",
        });
      }
      return { mode: memorySettings.remediationMode, promoted: [], candidateCount: 0, aiUsed: false, skippedReason: "disabled" };
    }

    const candidates = await this.deps.memoryPromotionService.analyzeForPromotion(args.projectId, args.sprintId);
    const eligible = candidates
      .filter((candidate) => candidate.score >= memorySettings.promotionThreshold)
      .slice(0, memorySettings.remediationMaxPromotions);

    if (eligible.length === 0) {
      if (memorySettings.remediationMode === "ai") {
        this.recordSkippedAiInvocation({
          projectId: args.projectId,
          sprintId: args.sprintId,
          sprintRunId: args.sprintRunId || null,
          skippedReason: "no_candidates",
          candidateCount: candidates.length,
          eligibleCount: 0,
          summary: candidates.length === 0
            ? "AI sprint memory remediation found no promotion candidates to review."
            : "AI sprint memory remediation found no promotion candidates that met the configured threshold.",
        });
      }
      return { mode: memorySettings.remediationMode, promoted: [], candidateCount: candidates.length, aiUsed: false, skippedReason: "no_candidates" };
    }

    if (memorySettings.remediationMode !== "ai") {
      const promoted = this.deps.memoryPromotionService.promoteCandidatesAsClaims(
        args.projectId,
        eligible,
        "Deterministic memory remediation after sprint",
      );
      return { mode: memorySettings.remediationMode, promoted, candidateCount: candidates.length, aiUsed: false };
    }

    const guardrailKey = `memory-remediation:${args.sprintRunId || args.sprintId}`;
    const guardrail = this.deps.guardrailService?.evaluate(scope, guardrailKey, "remediation") ?? null;
    if (guardrail && !guardrail.allowed && guardrail.action !== "WARN_ONLY") {
      this.recordSkippedAiInvocation({
        projectId: args.projectId,
        sprintId: args.sprintId,
        sprintRunId: args.sprintRunId || null,
        skippedReason: `guardrail:${guardrail.count}/${guardrail.cap}`,
        candidateCount: candidates.length,
        eligibleCount: eligible.length,
        summary: `AI sprint memory remediation was blocked by the remediation guardrail (${guardrail.count}/${guardrail.cap}).`,
      });
      return {
        mode: "ai",
        promoted: [],
        candidateCount: candidates.length,
        aiUsed: false,
        skippedReason: `guardrail:${guardrail.count}/${guardrail.cap}`,
      };
    }
    this.deps.guardrailService?.record(scope, guardrailKey, "remediation");

    try {
      const decision = await this.runAiRemediation({
        ...args,
        settings,
        candidates: eligible,
      });
      const allowedIds = new Set(eligible.map((candidate) => candidate.memory.id));
      const candidateById = new Map(eligible.map((candidate) => [candidate.memory.id, candidate]));
      const selected = decision.promote
        .map((item) => ({
          id: item.id,
          candidate: candidateById.get(item.id),
          reason: item.reason?.trim() || "AI memory remediation after sprint",
        }))
        .filter((item) => allowedIds.has(item.id))
        .slice(0, memorySettings.remediationMaxPromotions);

      if (selected.length === 0) {
        return { mode: "ai", promoted: [], candidateCount: candidates.length, aiUsed: true, skippedReason: "ai_selected_none" };
      }

      const reasonByCandidateId = new Map<string, string>();
      const selectedCandidates = selected.flatMap((item) => {
        if (!item.candidate) return [];
        reasonByCandidateId.set(item.candidate.memory.id, item.reason);
        return [item.candidate];
      });
      const promoted = this.deps.memoryPromotionService.promoteCandidatesAsClaims(
        args.projectId,
        selectedCandidates,
        (candidate) => reasonByCandidateId.get(candidate.memory.id) || "AI memory remediation after sprint",
      );
      return { mode: "ai", promoted, candidateCount: candidates.length, aiUsed: true };
    } catch (error) {
      this.deps.logger.warn("AI memory remediation failed; falling back to deterministic promotion", {
        projectId: args.projectId,
        sprintId: args.sprintId,
        error: error instanceof Error ? error.message : String(error),
      });
      const promoted = this.deps.memoryPromotionService.promoteCandidatesAsClaims(
        args.projectId,
        eligible,
        "Deterministic fallback after AI remediation failure",
      );
      return { mode: "ai", promoted, candidateCount: candidates.length, aiUsed: false, skippedReason: "ai_failed_fallback" };
    }
  }

  private async runAiRemediation(args: {
    projectId: string;
    sprintId: string;
    sprintRunId?: string | null;
    repoPath: string;
    sprintName?: string;
    sprintGoal?: string;
    settings: DashboardSettings;
    candidates: PromotionCandidate[];
  }): Promise<AiRemediationResponse> {
    const pseudoTask: Subtask = {
      id: `memory-remediation-${args.sprintId}`,
      title: `Memory remediation for ${args.sprintName || args.sprintId}`,
      prompt: args.sprintGoal || "Review sprint memories and select long-term project knowledge.",
      depends_on: [],
      is_independent: true,
      status: "PENDING",
    };
    const route = this.deps.taskService.resolveInvocationProvider("remediation", pseudoTask, {
      scope: { projectId: args.projectId, sprintId: args.sprintId },
      cliOnly: true,
    });
    const provider = route.provider as Exclude<ProviderId, "jules">;
    const providerConfigId = route.providerConfigId || route.provider;
    const providerSettings = route.providers[providerConfigId];
    const workflowSettings = {
      ...DEFAULT_CLI_WORKFLOW_SETTINGS,
      ...args.settings.cliWorkflow,
    };

    const prompt = buildProviderPrompt(this.buildPrompt(args), providerSettings.thinkingMode);
    const result = await this.deps.structuredAgentRequestService.executeRequest<AiRemediationResponse>({
      projectId: args.projectId,
      sprintId: args.sprintId,
      sprintRunId: args.sprintRunId || null,
      purpose: "remediation",
      type: "remediation",
      provider,
      model: providerSettings.model,
      apiKey: providerSettings.apiKey,
      maxConcurrentTasks: providerSettings.maxConcurrentTasks,
      qwenAuthMode: providerSettings.qwenAuthMode,
      qwenRegion: providerSettings.qwenRegion,
      qwenBaseUrl: providerSettings.qwenBaseUrl,
      qwenEnvKey: providerSettings.qwenEnvKey,
      qwenModelId: providerSettings.qwenModelId,
      qwenProtocol: providerSettings.qwenProtocol,
      qwenAdditionalModelProviders: providerSettings.qwenAdditionalModelProviders,
      openCodeAuthMode: providerSettings.openCodeAuthMode,
      openCodeProviderId: providerSettings.openCodeProviderId,
      openCodeModelId: providerSettings.openCodeModelId,
      openCodeBaseUrl: providerSettings.openCodeBaseUrl,
      openCodeEnvKey: providerSettings.openCodeEnvKey,
      openCodePackage: providerSettings.openCodePackage,
      providerMountAuth: providerSettings.mountAuth,
      providerAuthPath: providerSettings.authPath,
      customBaseUrl: providerSettings.customBaseUrl,
      customModel: providerSettings.customModel,
      providerPrompt: prompt,
      repoPath: args.repoPath,
      settings: {
        ...args.settings,
        cliWorkflow: workflowSettings,
      },
      githubToken: this.deps.getGithubToken?.(),
      parseFn: parseAiRemediationResponse,
      buildRetryPrompt: (error) => [
        "Your previous response failed validation:",
        error.message,
        "",
        "Return only valid JSON with this shape: { \"promote\": [{ \"id\": \"memory-id\", \"reason\": \"short reason\" }] }.",
      ].join("\n"),
      providerLabel: "Memory remediation",
      sessionIdPrefix: "memory-remediation",
      maxRetries: workflowSettings.maxParsingRetries,
    });
    return result.parsed;
  }

  private recordSkippedAiInvocation(args: {
    projectId: string;
    sprintId?: string | null;
    sprintRunId?: string | null;
    skippedReason: string;
    summary: string;
    reviewedCount?: number;
    candidateCount?: number;
    eligibleCount?: number;
  }): void {
    const executionRepository = this.deps.executionRepository;
    if (!executionRepository) return;

    try {
      const now = new Date().toISOString();
      const invocation = executionRepository.createExecutionInvocation({
        projectId: args.projectId,
        sprintId: args.sprintId || null,
        sprintRunId: args.sprintRunId || null,
        skipValidation: true,
        type: "remediation",
        status: "completed",
        startedAt: now,
        finishedAt: now,
        errorMessage: null,
      });
      executionRepository.appendExecutionInvocationMessage(invocation.id, {
        role: "system",
        contentMarkdown: [
          args.summary,
          "",
          `Skipped reason: \`${args.skippedReason}\`.`,
        ].join("\n"),
        metadata: {
          mode: "ai",
          remediationSkipped: true,
          skippedReason: args.skippedReason,
          reviewedCount: args.reviewedCount ?? null,
          candidateCount: args.candidateCount ?? null,
          eligibleCount: args.eligibleCount ?? null,
        },
      });
    } catch (error) {
      this.deps.logger.warn("Failed to record skipped AI memory remediation invocation", {
        projectId: args.projectId,
        sprintId: args.sprintId,
        sprintRunId: args.sprintRunId,
        skippedReason: args.skippedReason,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async runAiLongTermRemediation(args: {
    projectId: string;
    repoPath: string;
    settings: DashboardSettings;
    candidates: MemoryRecord[];
  }): Promise<AiRemediationResponse> {
    const pseudoTask: Subtask = {
      id: `long-term-memory-remediation-${args.projectId}`,
      title: "Long-term memory remediation",
      prompt: "Review long-term project memories and select unsafe cleanup candidates.",
      depends_on: [],
      is_independent: true,
      status: "PENDING",
    };
    const route = this.deps.taskService.resolveInvocationProvider("remediation", pseudoTask, {
      scope: { projectId: args.projectId },
      cliOnly: true,
    });
    const provider = route.provider as Exclude<ProviderId, "jules">;
    const providerConfigId = route.providerConfigId || route.provider;
    const providerSettings = route.providers[providerConfigId];
    const workflowSettings = {
      ...DEFAULT_CLI_WORKFLOW_SETTINGS,
      ...args.settings.cliWorkflow,
    };
    const prompt = buildProviderPrompt([
      "You are reviewing long-term Code UX project memories for safe cleanup.",
      "Only approve deletion for exact duplicates, obsolete CI/check/build failure memories, or memories that are clearly not durable project knowledge.",
      "Do not delete unique architecture, codebase, pattern, decision, or preference knowledge.",
      "",
      "Cleanup candidates:",
      JSON.stringify(args.candidates.map((memory) => ({
        id: memory.id,
        category: memory.category,
        strength: memory.strength,
        source: memory.source,
        content: memory.content,
      })), null, 2),
      "",
      "Return only JSON: { \"promote\": [], \"delete\": [{ \"id\": \"memory-id\", \"reason\": \"why deletion is safe\" }] }",
    ].join("\n"), providerSettings.thinkingMode);

    const result = await this.deps.structuredAgentRequestService.executeRequest<AiRemediationResponse>({
      projectId: args.projectId,
      purpose: "remediation",
      type: "remediation",
      provider,
      model: providerSettings.model,
      apiKey: providerSettings.apiKey,
      maxConcurrentTasks: providerSettings.maxConcurrentTasks,
      qwenAuthMode: providerSettings.qwenAuthMode,
      qwenRegion: providerSettings.qwenRegion,
      qwenBaseUrl: providerSettings.qwenBaseUrl,
      qwenEnvKey: providerSettings.qwenEnvKey,
      qwenModelId: providerSettings.qwenModelId,
      qwenProtocol: providerSettings.qwenProtocol,
      qwenAdditionalModelProviders: providerSettings.qwenAdditionalModelProviders,
      openCodeAuthMode: providerSettings.openCodeAuthMode,
      openCodeProviderId: providerSettings.openCodeProviderId,
      openCodeModelId: providerSettings.openCodeModelId,
      openCodeBaseUrl: providerSettings.openCodeBaseUrl,
      openCodeEnvKey: providerSettings.openCodeEnvKey,
      openCodePackage: providerSettings.openCodePackage,
      providerMountAuth: providerSettings.mountAuth,
      providerAuthPath: providerSettings.authPath,
      customBaseUrl: providerSettings.customBaseUrl,
      customModel: providerSettings.customModel,
      providerPrompt: prompt,
      repoPath: args.repoPath,
      settings: {
        ...args.settings,
        cliWorkflow: workflowSettings,
      },
      githubToken: this.deps.getGithubToken?.(),
      parseFn: parseAiRemediationResponse,
      buildRetryPrompt: (error) => `Return valid JSON only. Error: ${error.message}`,
      providerLabel: "Long-term memory remediation",
      sessionIdPrefix: "long-term-memory-remediation",
      maxRetries: workflowSettings.maxParsingRetries,
    });
    return result.parsed;
  }

  private buildPrompt(args: {
    sprintName?: string;
    sprintGoal?: string;
    candidates: PromotionCandidate[];
  }): string {
    const candidatesJson = JSON.stringify(args.candidates.map((candidate) => ({
      id: candidate.memory.id,
      clusterId: candidate.clusterId,
      claim: candidate.claim,
      category: candidate.memory.category,
      strength: candidate.memory.strength,
      score: Number(candidate.score.toFixed(3)),
      reason: candidate.reason,
      riskFlags: candidate.riskFlags,
      evidenceMemoryIds: candidate.evidenceMemoryIds,
      content: candidate.memory.content,
    })), null, 2);

    return [
      "You are performing Code UX memory remediation after a sprint.",
      "Select only durable project knowledge worth promoting to long-term memory. Treat each candidate as an evidence cluster, not as a raw fact to automatically copy.",
      "Reject transient notes, implementation trivia, duplicated facts, speculative statements, and CI/check/build failure observations.",
      "Reject candidates with risk flags such as test_fixture, task_local, file_specific, or implementation_trivia unless they clearly describe a durable repository convention beyond one sprint or one fixture.",
      "Prefer architecture, codebase conventions, reusable patterns, and explicit decisions that future workers should know.",
      "",
      `Sprint: ${args.sprintName || "unknown"}`,
      `Goal: ${args.sprintGoal || "unknown"}`,
      "",
      "Candidate memories:",
      candidatesJson,
      "",
      "Return only JSON with this exact shape:",
      "{ \"promote\": [{ \"id\": \"memory-id\", \"reason\": \"why this is durable\" }] }",
    ].join("\n");
  }

  private findLongTermCleanupCandidates(memories: MemoryRecord[]): MemoryRecord[] {
    const byId = new Map<string, MemoryRecord>();
    for (const memory of memories) {
      if (memory.source.originType === "ci_failure_learning" || isCiFailureMemoryContent(memory.category, memory.content)) {
        byId.set(memory.id, memory);
      }
    }
    for (const duplicate of selectDuplicatesToDelete(memories)) {
      byId.set(duplicate.id, duplicate);
    }
    return [...byId.values()];
  }
}

function normalizeMemoryContent(content: string): string {
  return content.trim().toLowerCase().replace(/\s+/g, " ");
}

function compareKeepPriority(left: MemoryRecord, right: MemoryRecord): number {
  if (left.strength !== right.strength) {
    return right.strength - left.strength;
  }
  return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
}

function selectDuplicatesToDelete(memories: MemoryRecord[]): MemoryRecord[] {
  const groups = new Map<string, MemoryRecord[]>();
  for (const memory of memories) {
    const key = normalizeMemoryContent(memory.content);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) || []), memory]);
  }

  const duplicates: MemoryRecord[] = [];
  for (const group of groups.values()) {
    if (group.length <= 1) continue;
    const sorted = [...group].sort(compareKeepPriority);
    duplicates.push(...sorted.slice(1));
  }
  return duplicates;
}

function parseAiRemediationResponse(text: string): AiRemediationResponse {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error("No JSON object found.");
  }
  const parsed = JSON.parse(match[0]) as Partial<AiRemediationResponse>;
  if (!Array.isArray(parsed.promote)) {
    throw new Error("Expected promote array.");
  }
  return {
    promote: parsed.promote
      .filter((item): item is { id: string; reason?: string } => (
        typeof item === "object"
        && item !== null
        && typeof (item as { id?: unknown }).id === "string"
      ))
      .map((item) => ({ id: item.id.trim(), reason: item.reason })),
    delete: (parsed.delete || [])
      .filter((item): item is { id: string; reason?: string } => (
        typeof item === "object"
        && item !== null
        && typeof (item as { id?: unknown }).id === "string"
      ))
      .map((item) => ({ id: item.id.trim(), reason: item.reason })),
  };
}
