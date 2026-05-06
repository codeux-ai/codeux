import type { ManageCodeUxArgs, ManagementResponseEnvelope } from "../../contracts/internal-management-types.js";
import type { MemoryService } from "../../services/memory-service.js";
import type { MemoryPromotionService } from "../../services/memory-promotion-service.js";
import type { EmbeddingModelManager } from "../../services/embedding-model-manager.js";

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
    const projectId = typeof payload.projectId === "string" ? payload.projectId : undefined;
    const query = typeof payload.query === "string" ? payload.query : undefined;
    if (!projectId || !query) throw new Error("projectId and query are required");

    const results = await this.memoryService.search({
      projectId,
      query,
      scope: typeof payload.scope === "string" ? payload.scope as any : undefined,
      sprintId: typeof payload.sprintId === "string" ? payload.sprintId : undefined,
      agentPresetId: typeof payload.agentPresetId === "string" ? payload.agentPresetId : undefined,
      limit: typeof payload.limit === "number" ? payload.limit : undefined,
      minSimilarity: typeof payload.minSimilarity === "number" ? payload.minSimilarity : undefined,
    });

    return { result: { results } };
  }

  private listMemories(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const projectId = typeof payload.projectId === "string" ? payload.projectId : undefined;
    if (!projectId) throw new Error("projectId is required");

    const scope = typeof payload.scope === "string" ? payload.scope as any : undefined;
    const limit = typeof payload.limit === "number" ? payload.limit : undefined;
    const sprintId = typeof payload.sprintId === "string" ? payload.sprintId : undefined;
    const agentPresetId = typeof payload.agentPresetId === "string" ? payload.agentPresetId : undefined;

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
    const memoryId = typeof payload.memoryId === "string" ? payload.memoryId : undefined;
    if (!memoryId) throw new Error("memoryId is required");

    const memory = this.memoryService.getMemory(memoryId);
    if (!memory) throw new Error(`Memory not found: ${memoryId}`);

    return { result: { memory } };
  }

  private async createMemory(payload: Record<string, unknown>): Promise<ManagementResponseEnvelope> {
    const projectId = typeof payload.projectId === "string" ? payload.projectId : undefined;
    if (!projectId) throw new Error("projectId is required");

    const memory = await this.memoryService.createMemory(projectId, {
      content: typeof payload.content === "string" ? payload.content : "",
      category: typeof payload.category === "string" ? payload.category as any : "context",
      scope: typeof payload.scope === "string" ? payload.scope as any : "project",
      strength: typeof payload.strength === "number" ? payload.strength : 1.0,
      sprintId: typeof payload.sprintId === "string" ? payload.sprintId : undefined,
      agentPresetId: typeof payload.agentPresetId === "string" ? payload.agentPresetId : undefined,
    });

    return { result: { memory } };
  }

  private updateMemory(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const memoryId = typeof payload.memoryId === "string" ? payload.memoryId : undefined;
    if (!memoryId) throw new Error("memoryId is required");

    const updateInput: Record<string, any> = {};
    if (typeof payload.content === "string") updateInput.content = payload.content;
    if (typeof payload.category === "string") updateInput.category = payload.category;
    if (typeof payload.strength === "number") updateInput.strength = payload.strength;

    const memory = this.memoryService.updateMemory(memoryId, updateInput);
    return { result: { memory } };
  }

  private deleteMemory(args: ManageCodeUxArgs, payload: Record<string, unknown>): ManagementResponseEnvelope {
    const memoryId = typeof payload.memoryId === "string" ? payload.memoryId : undefined;
    if (!memoryId) throw new Error("memoryId is required");

    if (args.approval?.confirmed !== true) {
      return { approvalRequired: true, approvalMessage: `Are you sure you want to delete memory ${memoryId}?` };
    }

    this.memoryService.deleteMemory(memoryId);
    return { result: { success: true } };
  }

  private promoteMemory(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const projectId = typeof payload.projectId === "string" ? payload.projectId : undefined;
    const memoryIds = Array.isArray(payload.memoryIds) ? payload.memoryIds.filter(id => typeof id === "string") : [];
    if (!projectId || memoryIds.length === 0) throw new Error("projectId and memoryIds are required");

    const reason = typeof payload.reason === "string" ? payload.reason : undefined;
    const promoted = this.memoryPromotionService.promoteMemories(projectId, memoryIds, reason);

    return { result: { promoted } };
  }

  private startReembed(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const projectId = typeof payload.projectId === "string" ? payload.projectId : undefined;
    if (!projectId) throw new Error("projectId is required");

    this.memoryService.startReembedProject(projectId);
    return { result: { success: true } };
  }

  private getMap(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const projectId = typeof payload.projectId === "string" ? payload.projectId : undefined;
    if (!projectId) throw new Error("projectId is required");

    const scope = typeof payload.scope === "string" ? payload.scope as any : undefined;
    const sprintId = typeof payload.sprintId === "string" ? payload.sprintId : undefined;
    const agentPresetId = typeof payload.agentPresetId === "string" ? payload.agentPresetId : undefined;
    const topKPerNode = typeof payload.topKPerNode === "number" ? payload.topKPerNode : undefined;

    const map = this.memoryService.getEmbeddingMap(projectId, scope, sprintId, agentPresetId, topKPerNode);
    return { result: { map } };
  }

  private countMemories(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const projectId = typeof payload.projectId === "string" ? payload.projectId : undefined;
    const scope = typeof payload.scope === "string" ? payload.scope as any : undefined;
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
