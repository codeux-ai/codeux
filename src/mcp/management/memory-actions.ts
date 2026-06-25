import type { ManageCodeUxArgs, ManagementResponseEnvelope } from "../../contracts/internal-management-types.js";
import type { MemoryService } from "../../services/memory-service.js";
import type { MemoryPromotionService } from "../../services/memory-promotion-service.js";
import type { EmbeddingModelManager } from "../../services/embedding-model-manager.js";
import { type MemoryScope, type MemoryCategory, MEMORY_SCOPES, MEMORY_CATEGORIES } from "../../contracts/memory-types.js";
import type { UpdateMemoryInput } from "../../contracts/memory-types.js";
import { parseRequiredString, parseOptionalString, parseOptionalNumber, parseOptionalStringArray, parseOptionalEnum } from "./payload-parsers.js";


export class MemoryActions {
  constructor(
    private readonly memoryService: MemoryService,
    private readonly memoryPromotionService: MemoryPromotionService,
    private readonly embeddingModelManager: EmbeddingModelManager,
  ) {}

  async handleMemoryAction(args: ManageCodeUxArgs): Promise<ManagementResponseEnvelope> {
    const payload = args.payload || {};

    switch (args.action) {
      case "search":
        return this.searchMemories(payload);
      case "list":
        return this.listMemories(payload);
      case "get":
        return this.getMemory(payload);
      case "create":
        return this.createMemory(payload);
      case "update":
        return this.updateMemory(payload);
      case "delete":
        return this.deleteMemory(args, payload);
      case "promote":
        return this.promoteMemory(payload);
      case "start_reembed":
        return this.startReembed(payload);
      case "get_map":
        return this.getMap(payload);
      case "count":
        return this.countMemories(payload);
      case "model_status":
        return this.modelStatus();
      default:
        throw new Error(`Unknown memory action: ${args.action}`);
    }
  }

  private async searchMemories(payload: Record<string, unknown>): Promise<ManagementResponseEnvelope> {
    const projectId = parseRequiredString(payload, "projectId");
    const query = parseRequiredString(payload, "query");

    const scope = parseOptionalEnum<MemoryScope>(payload, "scope", MEMORY_SCOPES);

    const results = await this.memoryService.search({
      projectId,
      query,
      scope,
      sprintId: parseOptionalString(payload, "sprintId"),
      agentPresetId: parseOptionalString(payload, "agentPresetId"),
      limit: parseOptionalNumber(payload, "limit"),
      minSimilarity: parseOptionalNumber(payload, "minSimilarity"),
    });

    return { result: { results } };
  }

  private listMemories(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const projectId = parseRequiredString(payload, "projectId");

    const scope = parseOptionalEnum<MemoryScope>(payload, "scope", MEMORY_SCOPES);
    const limit = parseOptionalNumber(payload, "limit");
    const sprintId = parseOptionalString(payload, "sprintId");
    const agentPresetId = parseOptionalString(payload, "agentPresetId");

    let memories: any[];
    if (sprintId && agentPresetId) {
      memories = this.memoryService.listBySprintAndAgent(projectId, sprintId, agentPresetId, limit);
    } else if (sprintId) {
      memories = this.memoryService.listBySprint(projectId, sprintId, limit);
    } else if (agentPresetId) {
      if (scope === "project") {
        memories = this.memoryService.listLongTermByAgent(projectId, agentPresetId, limit);
      } else {
        memories = this.memoryService.listByAgent(projectId, agentPresetId, limit);
      }
    } else {
      memories = this.memoryService.listByProject(projectId, scope, limit);
    }

    return { result: { memories } };
  }

  private getMemory(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const memoryId = parseRequiredString(payload, "memoryId");

    const memory = this.memoryService.getMemory(memoryId);
    if (!memory) throw new Error(`Memory not found: ${memoryId}`);

    return { result: { memory } };
  }

  private async createMemory(payload: Record<string, unknown>): Promise<ManagementResponseEnvelope> {
    const projectId = parseRequiredString(payload, "projectId");

    const category = parseOptionalEnum<MemoryCategory>(payload, "category", MEMORY_CATEGORIES) || "context";
    const scope = parseOptionalEnum<MemoryScope>(payload, "scope", MEMORY_SCOPES) || "project";

    const memory = await this.memoryService.createMemory(projectId, {
      content: parseOptionalString(payload, "content") ?? "",
      category,
      scope,
      strength: parseOptionalNumber(payload, "strength") ?? 1.0,
      sprintId: parseOptionalString(payload, "sprintId"),
      agentPresetId: parseOptionalString(payload, "agentPresetId"),
    });

    return { result: { memory } };
  }

  private updateMemory(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const memoryId = parseRequiredString(payload, "memoryId");

    const updateInput: UpdateMemoryInput = {};
    const content = parseOptionalString(payload, "content");
    if (content !== undefined) updateInput.content = content;

    const category = parseOptionalEnum<MemoryCategory>(payload, "category", MEMORY_CATEGORIES);
    if (category) updateInput.category = category;

    const strength = parseOptionalNumber(payload, "strength");
    if (strength !== undefined) updateInput.strength = strength;

    const memory = this.memoryService.updateMemory(memoryId, updateInput);
    return { result: { memory } };
  }

  private deleteMemory(args: ManageCodeUxArgs, payload: Record<string, unknown>): ManagementResponseEnvelope {
    const memoryId = parseRequiredString(payload, "memoryId");

    if (args.approval?.confirmed !== true) {
      return { approvalRequired: true, approvalMessage: `Are you sure you want to delete memory ${memoryId}?` };
    }

    this.memoryService.deleteMemory(memoryId);
    return { result: { success: true } };
  }

  private promoteMemory(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const projectId = parseRequiredString(payload, "projectId");
    const memoryIds = parseOptionalStringArray(payload, "memoryIds") || [];
    if (memoryIds.length === 0) throw new Error("memoryIds are required");

    const reason = parseOptionalString(payload, "reason");
    const promoted = this.memoryPromotionService.promoteMemories(projectId, memoryIds, reason);

    return { result: { promoted } };
  }

  private startReembed(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const projectId = parseRequiredString(payload, "projectId");

    this.memoryService.startReembedProject(projectId);
    return { result: { success: true } };
  }

  private getMap(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const projectId = parseRequiredString(payload, "projectId");

    const scope = parseOptionalEnum<MemoryScope>(payload, "scope", MEMORY_SCOPES);
    const sprintId = parseOptionalString(payload, "sprintId");
    const agentPresetId = parseOptionalString(payload, "agentPresetId");
    const topKPerNode = parseOptionalNumber(payload, "topKPerNode");

    const map = this.memoryService.getEmbeddingMap(projectId, scope, sprintId, agentPresetId, topKPerNode);
    return { result: { map } };
  }

  private countMemories(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const projectId = typeof payload.projectId === "string" ? payload.projectId : undefined;
    const scope = parseOptionalEnum<MemoryScope>(payload, "scope", MEMORY_SCOPES);
    if (!projectId || !scope) throw new Error("projectId and scope are required");

    const count = this.memoryService.countByScope(projectId, scope);
    const staleCount = this.memoryService.countStaleEmbeddings(projectId);

    return { result: { count, staleCount } };
  }

  private modelStatus(): ManagementResponseEnvelope {
    const status = this.embeddingModelManager.getStatuses();
    return { result: { status } };
  }
}
