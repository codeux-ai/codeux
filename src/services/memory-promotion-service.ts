import type {
  MemoryRecord,
  PromotionCandidate,
  MemorySettings,
  MemoryPromotionRiskFlag,
} from "../contracts/memory-types.js";
import { MemoryRepository } from "../repositories/memory-repository.js";
import { MemoryService } from "./memory-service.js";
import { isCiFailureMemoryContent } from "./memory-service.js";
import type { Logger } from "../shared/logging/logger.js";

const CATEGORY_WEIGHTS: Record<string, number> = {
  architecture: 1.3,
  patterns: 1.2,
  decision: 1.1,
  codebase: 1.0,
  error: 0.9,
  learning: 0.9,
  context: 0.8,
  preferences: 0.7,
};

const RISK_PENALTIES: Record<MemoryPromotionRiskFlag, number> = {
  ci_failure: 1,
  test_fixture: 0.28,
  task_local: 0.2,
  implementation_trivia: 0.16,
  speculative: 0.12,
  file_specific: 0.08,
};

interface RawPromotionCandidate extends PromotionCandidate {
  similarCurrentSprintMemoryIds: string[];
}

export class MemoryPromotionService {
  private readonly memoryService: MemoryService;
  private readonly memoryRepository: MemoryRepository;
  private readonly logger: Logger;

  constructor(
    memoryService: MemoryService,
    memoryRepository: MemoryRepository,
    logger: Logger,
  ) {
    this.memoryService = memoryService;
    this.memoryRepository = memoryRepository;
    this.logger = logger;
  }

  async analyzeForPromotion(
    projectId: string,
    sprintId: string,
  ): Promise<PromotionCandidate[]> {
    const sprintMemories = this.memoryRepository.listBySprint(projectId, sprintId);
    const candidates: RawPromotionCandidate[] = [];

    for (const memory of sprintMemories) {
      const riskFlags = detectPromotionRiskFlags(memory);
      if (memory.source.originType === "ci_failure_learning" || riskFlags.includes("ci_failure")) {
        continue;
      }
      if (memory.strength < 0.6) continue;

      // Check for semantic similarity across other sprint memories (cross-sprint consistency)
      let crossSprintCount = 0;
      try {
        const searchResults = await this.memoryService.search({
          projectId,
          query: memory.content,
          scope: "sprint",
          limit: 20,
          minSimilarity: 0.75,
        });

        // Count distinct sprints (excluding current)
        const distinctSprints = new Set<string>();
        for (const result of searchResults) {
          if (result.memory.sprintId && result.memory.sprintId !== sprintId) {
            distinctSprints.add(result.memory.sprintId);
          }
        }
        crossSprintCount = distinctSprints.size;
      } catch {
        // Search may fail if no model loaded — still consider for promotion based on strength
      }

      // Check for near-duplicates in existing project memories
      let isDuplicate = false;
      try {
        const existingProject = await this.memoryService.search({
          projectId,
          query: memory.content,
          scope: "project",
          limit: 3,
          minSimilarity: 0.95,
        });
        if (existingProject.length > 0) {
          isDuplicate = true;
        }
      } catch {
        // Continue without dedup check
      }

      if (isDuplicate) continue;

      // Check for cross-agent consistency within the sprint
      let crossAgentCount = 0;
      let similarCurrentSprintMemoryIds: string[] = [];
      try {
        const sprintResults = await this.memoryService.search({
          projectId,
          query: memory.content,
          scope: "sprint",
          sprintId,
          limit: 10,
          minSimilarity: 0.75,
        });
        const distinctAgents = new Set<string>();
        const similarIds = new Set<string>();
        for (const result of sprintResults) {
          if (result.memory.id !== memory.id && result.memory.sprintId === sprintId) {
            similarIds.add(result.memory.id);
          }
          if (result.memory.agentPresetId && result.memory.agentPresetId !== memory.agentPresetId) {
            distinctAgents.add(result.memory.agentPresetId);
          }
        }
        crossAgentCount = distinctAgents.size;
        similarCurrentSprintMemoryIds = [...similarIds];
      } catch {
        // Search may fail — continue without cross-agent boost
      }

      // Score the candidate
      const categoryWeight = CATEGORY_WEIGHTS[memory.category] ?? 1.0;
      const crossSprintBonus = crossSprintCount >= 3 ? 0.3 : crossSprintCount >= 2 ? 0.2 : crossSprintCount >= 1 ? 0.1 : 0;
      const crossAgentBonus = crossAgentCount >= 2 ? 0.25 : crossAgentCount >= 1 ? 0.15 : 0;
      const strengthBonus = memory.strength >= 0.9 ? 0.2 : memory.strength >= 0.8 ? 0.1 : 0;
      const rawScore = Math.min(1, (memory.strength * categoryWeight + crossSprintBonus + crossAgentBonus + strengthBonus) / 1.5);
      const riskPenalty = Math.min(0.45, riskFlags.reduce((sum, flag) => sum + (RISK_PENALTIES[flag] ?? 0), 0));
      const score = Math.max(0, rawScore - riskPenalty);

      const reasons: string[] = [];
      if (crossSprintCount >= 2) reasons.push(`appeared in ${crossSprintCount + 1} sprints`);
      if (crossAgentCount >= 1) reasons.push(`confirmed by ${crossAgentCount + 1} agents`);
      if (memory.strength >= 0.9) reasons.push("high strength");
      if (categoryWeight >= 1.2) reasons.push(`important category: ${memory.category}`);
      if (riskFlags.length > 0) reasons.push(`risk flags: ${riskFlags.join(", ")}`);
      if (reasons.length === 0) reasons.push("meets promotion threshold");

      candidates.push({
        memory,
        clusterId: `memory:${memory.id}`,
        claim: memory.content,
        evidenceMemoryIds: [memory.id],
        riskFlags,
        score,
        reason: reasons.join(", "),
        crossSprintCount,
        similarCurrentSprintMemoryIds,
      });
    }

    return clusterPromotionCandidates(candidates);
  }

  promoteMemories(
    projectId: string,
    memoryIds: string[],
    reason?: string,
  ): MemoryRecord[] {
    const promoted: MemoryRecord[] = [];

    for (const memoryId of memoryIds) {
      const source = this.memoryRepository.getMemory(memoryId);
      if (!source) {
        this.logger.warn(`Memory ${memoryId} not found for promotion`);
        continue;
      }

      const record = this.memoryRepository.createPromotedMemory(
        projectId,
        source,
        reason ?? "Manual promotion",
      );
      promoted.push(record);
      this.logger.info(`Promoted memory ${memoryId} → ${record.id}`);

      // Automatically trigger embedding generation for the newly promoted long-term memory
      this.memoryService.triggerEmbedding(record).catch((error: Error) => {
        this.logger.warn(`Failed to embed promoted memory ${record.id}: ${error.message}`);
      });
    }

    return promoted;
  }

  promoteCandidatesAsClaims(
    projectId: string,
    candidates: PromotionCandidate[],
    reason: string | ((candidate: PromotionCandidate) => string) = "Memory remediation after sprint",
  ): MemoryRecord[] {
    const promoted: MemoryRecord[] = [];

    for (const candidate of candidates) {
      const source = candidate.memory;
      const existingClaim = this.memoryRepository.findActiveMemoryClaimByFingerprint(projectId, candidate.claim);
      if (existingClaim) {
        for (const evidenceMemoryId of candidate.evidenceMemoryIds) {
          this.memoryRepository.addMemoryClaimEvidence({
            claimId: existingClaim.id,
            memoryId: evidenceMemoryId,
            supportType: "supports",
            weight: evidenceMemoryId === source.id ? 1 : 0.85,
          });
        }
        const evidenceCount = this.memoryRepository.listMemoryClaimEvidence(existingClaim.id).length;
        this.memoryRepository.updateMemoryClaim(existingClaim.id, {
          confidence: evolveClaimScore(existingClaim.confidence, candidate.score, evidenceCount),
          durability: evolveClaimScore(existingClaim.durability, computeDurability(candidate), evidenceCount),
          tags: mergeUnique(existingClaim.tags, buildClaimTags(candidate)),
          appliesToPaths: mergeUnique(existingClaim.appliesToPaths, extractAppliesToPaths(candidate.claim)),
        });
        this.logger.info(`Linked ${candidate.evidenceMemoryIds.length} evidence memories to existing claim ${existingClaim.id}`);
        continue;
      }

      const promotionReason = typeof reason === "function" ? reason(candidate) : reason;
      const claim = this.memoryRepository.createMemoryClaim(projectId, {
        claim: candidate.claim,
        category: source.category,
        confidence: candidate.score,
        durability: computeDurability(candidate),
        tags: buildClaimTags(candidate),
        appliesToPaths: extractAppliesToPaths(candidate.claim),
        sourceType: "promotion",
        sourceMemoryId: source.id,
      });

      for (const evidenceMemoryId of candidate.evidenceMemoryIds) {
        this.memoryRepository.addMemoryClaimEvidence({
          claimId: claim.id,
          memoryId: evidenceMemoryId,
          supportType: "supports",
          weight: evidenceMemoryId === source.id ? 1 : 0.85,
        });
      }

      const record = this.memoryRepository.createPromotedClaimMemory(
        projectId,
        source,
        claim.claim,
        claim.id,
        promotionReason,
        Math.max(source.strength, candidate.score),
      );
      promoted.push(record);
      this.logger.info(`Promoted memory cluster ${candidate.clusterId} → claim ${claim.id} → ${record.id}`);

      this.memoryService.triggerEmbedding(record).catch((error: Error) => {
        this.logger.warn(`Failed to embed promoted claim memory ${record.id}: ${error.message}`);
      });
    }

    return promoted;
  }

  async autoPromoteFromSprint(
    projectId: string,
    sprintId: string,
    settings: MemorySettings,
  ): Promise<MemoryRecord[]> {
    if (!settings.autoPromote) return [];

    const candidates = await this.analyzeForPromotion(projectId, sprintId);
    const qualifying = candidates.filter((c) => c.score >= settings.promotionThreshold);

    if (qualifying.length === 0) {
      this.logger.info(`No memories from sprint ${sprintId} qualify for auto-promotion`);
      return [];
    }

    const promoted = this.promoteCandidatesAsClaims(projectId, qualifying, "Auto-promoted from sprint");

    this.logger.info(`Auto-promoted ${promoted.length} memories from sprint ${sprintId}`);
    return promoted;
  }
}

function detectPromotionRiskFlags(memory: MemoryRecord): MemoryPromotionRiskFlag[] {
  const text = memory.content;
  const flags = new Set<MemoryPromotionRiskFlag>();

  if (isCiFailureMemoryContent(memory.category, text)) {
    flags.add("ci_failure");
  }
  if (/\b(smoke[-_\s]?tests?|test fixture|fixture|merge conflict test|dag \+ merge conflict|conflict\.md)\b/i.test(text)) {
    flags.add("test_fixture");
  }
  if (/`[^`]+\.[a-z0-9]+`|(?:^|\s)[\w./-]+\.(?:md|ts|tsx|js|json|yml|yaml|toml|css|html)\b/i.test(text)) {
    flags.add("file_specific");
  }
  if (/\b(task requires|task-specified|satisfy the requirement|requested by qa follow-up|this task|this sprint|overwrote|created `|updated `|used `[^`]+` as a proxy|non-existent)\b/i.test(text)) {
    flags.add("task_local");
  }
  if (/\b(single[-\s]?line|timestamp|entire content|file to contain only|line with the timestamp)\b/i.test(text)) {
    flags.add("implementation_trivia");
  }
  if (/\b(maybe|probably|appears to|seems to|might be|could be)\b/i.test(text)) {
    flags.add("speculative");
  }

  return [...flags];
}

function clusterPromotionCandidates(candidates: RawPromotionCandidate[]): PromotionCandidate[] {
  if (candidates.length === 0) {
    return [];
  }

  const indexById = new Map(candidates.map((candidate, index) => [candidate.memory.id, index]));
  const parent = candidates.map((_, index) => index);
  const find = (index: number): number => {
    let current = index;
    while (parent[current] !== current) {
      parent[current] = parent[parent[current]];
      current = parent[current];
    }
    return current;
  };
  const union = (left: number, right: number): void => {
    const rootLeft = find(left);
    const rootRight = find(right);
    if (rootLeft !== rootRight) {
      parent[rootRight] = rootLeft;
    }
  };

  candidates.forEach((candidate, index) => {
    for (const similarId of candidate.similarCurrentSprintMemoryIds) {
      const similarIndex = indexById.get(similarId);
      if (similarIndex !== undefined) {
        union(index, similarIndex);
      }
    }
  });

  const groups = new Map<number, RawPromotionCandidate[]>();
  candidates.forEach((candidate, index) => {
    const root = find(index);
    groups.set(root, [...(groups.get(root) || []), candidate]);
  });

  const clustered = [...groups.values()].map((group) => {
    const representative = [...group].sort((left, right) => right.score - left.score)[0]!;
    const evidenceMemoryIds = [...new Set(group.map((candidate) => candidate.memory.id))].sort();
    const riskFlags = [...new Set(group.flatMap((candidate) => candidate.riskFlags))].sort() as MemoryPromotionRiskFlag[];
    const crossSprintCount = Math.max(...group.map((candidate) => candidate.crossSprintCount));
    const reasonParts = [representative.reason];
    if (group.length > 1) {
      reasonParts.push(`clustered from ${group.length} sprint memories`);
    }

    return {
      memory: representative.memory,
      clusterId: `cluster:${evidenceMemoryIds.join(",")}`,
      claim: representative.memory.content,
      evidenceMemoryIds,
      riskFlags,
      score: representative.score,
      reason: reasonParts.join(", "),
      crossSprintCount,
    };
  });

  clustered.sort((a, b) => b.score - a.score);
  return clustered;
}

function computeDurability(candidate: PromotionCandidate): number {
  const evidenceBonus = candidate.evidenceMemoryIds.length >= 3 ? 0.08 : candidate.evidenceMemoryIds.length >= 2 ? 0.04 : 0;
  const sprintBonus = candidate.crossSprintCount >= 3 ? 0.08 : candidate.crossSprintCount >= 1 ? 0.04 : 0;
  return Math.max(0, Math.min(1, candidate.score + evidenceBonus + sprintBonus));
}

function buildClaimTags(candidate: PromotionCandidate): string[] {
  const tags = new Set<string>(["memory-remediation"]);
  if (candidate.evidenceMemoryIds.length > 1) {
    tags.add("evidence-cluster");
  }
  if (candidate.crossSprintCount > 0) {
    tags.add("cross-sprint");
  }
  for (const flag of candidate.riskFlags) {
    tags.add(`risk:${flag}`);
  }
  return [...tags].sort();
}

function extractAppliesToPaths(claim: string): string[] {
  const paths = new Set<string>();
  const pathPattern = /`([^`]+\.[a-z0-9]+)`|(?:^|\s)([\w./-]+\.(?:md|ts|tsx|js|json|yml|yaml|toml|css|html))\b/gi;
  let match: RegExpExecArray | null;
  while ((match = pathPattern.exec(claim)) !== null) {
    const value = (match[1] || match[2] || "").trim();
    if (value && !value.includes("..")) {
      paths.add(value.replace(/^[./]+/, ""));
    }
  }
  return [...paths].sort();
}

function evolveClaimScore(current: number, observed: number, evidenceCount: number): number {
  const evidenceBonus = Math.min(0.12, Math.max(0, evidenceCount - 1) * 0.02);
  return Math.min(1, Math.max(current, observed) + evidenceBonus);
}

function mergeUnique(left: string[], right: string[]): string[] {
  return [...new Set([...left, ...right].map((value) => value.trim()).filter(Boolean))].sort();
}
