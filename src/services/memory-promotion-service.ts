import type {
  MemoryRecord,
  PromotionCandidate,
  MemorySettings,
} from "../contracts/memory-types.js";
import { MemoryRepository } from "../repositories/memory-repository.js";
import { MemoryService } from "./memory-service.js";
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
    const candidates: PromotionCandidate[] = [];

    for (const memory of sprintMemories) {
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

      // Score the candidate
      const categoryWeight = CATEGORY_WEIGHTS[memory.category] ?? 1.0;
      const crossSprintBonus = crossSprintCount >= 3 ? 0.3 : crossSprintCount >= 2 ? 0.2 : crossSprintCount >= 1 ? 0.1 : 0;
      const strengthBonus = memory.strength >= 0.9 ? 0.2 : memory.strength >= 0.8 ? 0.1 : 0;
      const score = Math.min(1, (memory.strength * categoryWeight + crossSprintBonus + strengthBonus) / 1.5);

      const reasons: string[] = [];
      if (crossSprintCount >= 2) reasons.push(`appeared in ${crossSprintCount + 1} sprints`);
      if (memory.strength >= 0.9) reasons.push("high strength");
      if (categoryWeight >= 1.2) reasons.push(`important category: ${memory.category}`);
      if (reasons.length === 0) reasons.push("meets promotion threshold");

      candidates.push({
        memory,
        score,
        reason: reasons.join(", "),
        crossSprintCount,
      });
    }

    // Sort by score descending
    candidates.sort((a, b) => b.score - a.score);
    return candidates;
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

    const memoryIds = qualifying.map((c) => c.memory.id);
    const promoted = this.promoteMemories(projectId, memoryIds, "Auto-promoted from sprint");

    this.logger.info(`Auto-promoted ${promoted.length} memories from sprint ${sprintId}`);
    return promoted;
  }
}
