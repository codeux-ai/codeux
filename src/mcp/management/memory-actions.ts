import type { ManageCodeUxArgs, ManagementResponseEnvelope } from "../../contracts/internal-management-types.js";
import type { AddLongTermMemoryArgs } from "../../contracts/internal-management-types.js";
import type { MemoryService } from "../../services/memory-service.js";
import type { MemoryPromotionService } from "../../services/memory-promotion-service.js";
import type { EmbeddingModelManager } from "../../services/embedding-model-manager.js";
import {
  type MemoryScope,
  type MemoryCategory,
  type MemoryClaimStatus,
  type MemoryClaimEvidenceSupport,
  MEMORY_SCOPES,
  MEMORY_CATEGORIES,
  MEMORY_CLAIM_STATUSES,
  MEMORY_CLAIM_EVIDENCE_SUPPORTS,
} from "../../contracts/memory-types.js";
import type { AddMemoryClaimEvidenceInput, CreateMemoryClaimInput, UpdateMemoryClaimInput, UpdateMemoryInput } from "../../contracts/memory-types.js";
import {
  managementValidationError,
  parseRequiredString,
  parseOptionalString,
  parseOptionalNumber,
  parseOptionalStringArray,
  parseOptionalEnum,
  parseOptionalEnumStrict,
  parseOptionalNullableString,
} from "./payload-parsers.js";


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
      case "create_claim":
        return this.createClaim(payload);
      case "list_claims":
        return this.listClaims(payload);
      case "get_claim":
        return this.getClaim(payload);
      case "update_claim":
        return this.updateClaim(payload);
      case "add_claim_evidence":
        return this.addClaimEvidence(payload);
      case "deprecate_claim":
        return this.deprecateClaim(args, payload);
      default:
        throw new Error(`Unknown memory action: ${args.action}`);
    }
  }

  async addLongTermMemory(args: AddLongTermMemoryArgs): Promise<ManagementResponseEnvelope> {
    const projectId = parseRequiredString(args as unknown as Record<string, unknown>, "projectId");
    const memory = parseRequiredString(args as unknown as Record<string, unknown>, "memory");
    const category = parseOptionalEnumStrict<MemoryCategory>(
      args as unknown as Record<string, unknown>,
      "category",
      MEMORY_CATEGORIES.filter((candidate) => candidate !== "error"),
    ) ?? "learning";
    const sourceMemoryId = parseOptionalString(args as unknown as Record<string, unknown>, "sourceMemoryId");

    const result = await this.memoryService.createProjectMemoryClaim(projectId, {
      claim: memory,
      category,
      confidence: parseOptionalClaimScore(args as unknown as Record<string, unknown>, "confidence") ?? 0.9,
      durability: parseOptionalClaimScore(args as unknown as Record<string, unknown>, "durability") ?? 0.9,
      tags: parseOptionalStringArray(args as unknown as Record<string, unknown>, "tags"),
      appliesToPaths: parseOptionalStringArray(args as unknown as Record<string, unknown>, "appliesToPaths"),
      sourceType: "manual",
      sourceMemoryId,
    }, sourceMemoryId ? { memoryId: sourceMemoryId, supportType: "supports", weight: 1 } : undefined);

    return {
      result: {
        ...result,
        richWidget: {
          type: "memory",
          data: {
            title: "Added to long-term memory",
            memory,
            category,
            claimId: result.claim.id,
            memoryId: result.mirrorMemory.id,
            status: "stored",
          },
        },
      },
    };
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

  private async createClaim(payload: Record<string, unknown>): Promise<ManagementResponseEnvelope> {
    const projectId = parseRequiredString(payload, "projectId");
    const category = parseOptionalEnumStrict<MemoryCategory>(payload, "category", MEMORY_CATEGORIES) ?? "context";
    const sourceMemoryId = parseOptionalString(payload, "sourceMemoryId");
    const supportType = parseOptionalEnumStrict<MemoryClaimEvidenceSupport>(payload, "supportType", MEMORY_CLAIM_EVIDENCE_SUPPORTS);
    const evidenceWeight = parseOptionalClaimScore(payload, "weight") ?? parseOptionalClaimScore(payload, "evidenceWeight");

    const input: CreateMemoryClaimInput = {
      claim: parseRequiredString(payload, "claim"),
      category,
      confidence: parseOptionalClaimScore(payload, "confidence") ?? 0.8,
      durability: parseOptionalClaimScore(payload, "durability") ?? 0.8,
      tags: parseOptionalStringArray(payload, "tags"),
      appliesToPaths: parseOptionalStringArray(payload, "appliesToPaths"),
      sourceType: "manual",
      sourceMemoryId,
      supersedesClaimId: parseOptionalString(payload, "supersedesClaimId"),
    };

    const evidence: Omit<AddMemoryClaimEvidenceInput, "claimId"> | undefined = sourceMemoryId
      ? { memoryId: sourceMemoryId, supportType, weight: evidenceWeight }
      : undefined;

    const result = await this.memoryService.createProjectMemoryClaim(projectId, input, evidence);
    return { result };
  }

  private listClaims(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const projectId = parseRequiredString(payload, "projectId");
    const status = parseOptionalEnumStrict<MemoryClaimStatus>(payload, "status", MEMORY_CLAIM_STATUSES);
    const category = parseOptionalEnumStrict<MemoryCategory>(payload, "category", MEMORY_CATEGORIES);
    const limit = parseOptionalNumber(payload, "limit");

    const claims = this.memoryService.listMemoryClaims(projectId, { status, category, limit });
    return { result: { claims } };
  }

  private getClaim(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const projectId = parseRequiredString(payload, "projectId");
    const claimId = parseRequiredString(payload, "claimId");

    const claim = this.memoryService.getMemoryClaim(projectId, claimId);
    return { result: { claim } };
  }

  private updateClaim(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const projectId = parseRequiredString(payload, "projectId");
    const claimId = parseRequiredString(payload, "claimId");

    const updateInput: UpdateMemoryClaimInput = {};
    const claim = parseOptionalString(payload, "claim");
    if ("claim" in payload && !claim) {
      throw managementValidationError("claim is required", "claim");
    }
    if (claim !== undefined) updateInput.claim = claim;

    const category = parseOptionalEnumStrict<MemoryCategory>(payload, "category", MEMORY_CATEGORIES);
    if (category) updateInput.category = category;

    const confidence = parseOptionalClaimScore(payload, "confidence");
    if (confidence !== undefined) updateInput.confidence = confidence;

    const durability = parseOptionalClaimScore(payload, "durability");
    if (durability !== undefined) updateInput.durability = durability;

    const status = parseOptionalEnumStrict<MemoryClaimStatus>(payload, "status", MEMORY_CLAIM_STATUSES);
    if (status) updateInput.status = status;

    const tags = parseOptionalStringArray(payload, "tags");
    if (tags) updateInput.tags = tags;

    const appliesToPaths = parseOptionalStringArray(payload, "appliesToPaths");
    if (appliesToPaths) updateInput.appliesToPaths = appliesToPaths;

    const supersedesClaimId = parseOptionalNullableString(payload, "supersedesClaimId");
    if (supersedesClaimId !== undefined) updateInput.supersedesClaimId = supersedesClaimId;

    const updated = this.memoryService.updateMemoryClaim(projectId, claimId, updateInput);
    return { result: { claim: updated } };
  }

  private addClaimEvidence(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const projectId = parseRequiredString(payload, "projectId");
    const input: AddMemoryClaimEvidenceInput = {
      claimId: parseRequiredString(payload, "claimId"),
      memoryId: parseRequiredString(payload, "memoryId"),
      supportType: parseOptionalEnumStrict<MemoryClaimEvidenceSupport>(payload, "supportType", MEMORY_CLAIM_EVIDENCE_SUPPORTS),
      weight: parseOptionalClaimScore(payload, "weight"),
    };

    const evidence = this.memoryService.addMemoryClaimEvidence(projectId, input);
    return { result: { evidence } };
  }

  private deprecateClaim(args: ManageCodeUxArgs, payload: Record<string, unknown>): ManagementResponseEnvelope {
    const projectId = parseRequiredString(payload, "projectId");
    const claimId = parseRequiredString(payload, "claimId");

    if (args.approval?.confirmed !== true) {
      return { approvalRequired: true, approvalMessage: `Are you sure you want to deprecate memory claim ${claimId}?` };
    }

    const claim = this.memoryService.deprecateMemoryClaim(projectId, claimId);
    return { result: { success: true, claim } };
  }
}

function parseOptionalClaimScore(payload: Record<string, unknown>, key: string): number | undefined {
  if (!(key in payload) || payload[key] === undefined || payload[key] === null) {
    return undefined;
  }
  const value = parseOptionalNumber(payload, key, 0, 1);
  if (value === undefined) {
    throw managementValidationError(`Invalid value for ${key}. Must be a number between 0 and 1.`, key);
  }
  return value;
}
