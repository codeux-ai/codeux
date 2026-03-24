import type { Express } from "express";
import type { MemoryService } from "../services/memory-service.js";
import type { MemoryPromotionService } from "../services/memory-promotion-service.js";
import type { EmbeddingModelManager } from "../services/embedding-model-manager.js";
import type { EmbeddingService } from "../services/embedding-service.js";
import type { MemoryRepository } from "../repositories/memory-repository.js";
import type { SettingsRepository } from "../repositories/settings-repository.js";
import type {
  MemoryScope,
  MemoryCategory,
  CreateMemoryInput,
  UpdateMemoryInput,
  EmbeddingModelId,
} from "../contracts/memory-types.js";
import { MEMORY_SCOPES, MEMORY_CATEGORIES, EMBEDDING_MODEL_IDS } from "../contracts/memory-types.js";
import { EMBEDDING_MODEL_CATALOG } from "../services/embedding-model-catalog.js";

export interface MemoryRouteDependencies {
  memoryService: MemoryService;
  memoryPromotionService: MemoryPromotionService;
  embeddingModelManager: EmbeddingModelManager;
  embeddingService: EmbeddingService;
  memoryRepository: MemoryRepository;
  settingsRepository: SettingsRepository;
}

function toError(error: unknown, prefix: string): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${prefix}: ${message}`;
}

export function registerMemoryRoutes(app: Express, deps: MemoryRouteDependencies): void {
  const {
    memoryService,
    memoryPromotionService,
    embeddingModelManager,
    embeddingService,
    memoryRepository,
    settingsRepository,
  } = deps;

  // --- Memory CRUD ---

  app.get("/api/projects/:projectId/memories", (req, res) => {
    try {
      const projectId = String(req.params.projectId).trim();
      const scope = req.query.scope as MemoryScope | undefined;
      const sprintId = req.query.sprintId as string | undefined;
      const agentPresetId = req.query.agentPresetId as string | undefined;
      const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : undefined;

      if (sprintId && agentPresetId) {
        res.json(memoryService.listBySprintAndAgent(projectId, sprintId, agentPresetId, limit));
      } else if (sprintId) {
        res.json(memoryService.listBySprint(projectId, sprintId, limit));
      } else if (agentPresetId && scope === "project") {
        res.json(memoryService.listLongTermByAgent(projectId, agentPresetId, limit));
      } else if (agentPresetId) {
        res.json(memoryService.listByAgent(projectId, agentPresetId, limit));
      } else {
        res.json(memoryService.listByProject(projectId, scope, limit));
      }
    } catch (error) {
      res.status(400).json({ error: toError(error, "Failed to list memories") });
    }
  });

  app.post("/api/projects/:projectId/memories", async (req, res) => {
    try {
      const projectId = String(req.params.projectId).trim();
      const body = req.body as Partial<CreateMemoryInput>;

      if (!body.content || typeof body.content !== "string") {
        res.status(400).json({ error: "content is required" });
        return;
      }
      if (!body.scope || !MEMORY_SCOPES.includes(body.scope)) {
        res.status(400).json({ error: `scope must be one of: ${MEMORY_SCOPES.join(", ")}` });
        return;
      }
      if (!body.category || !MEMORY_CATEGORIES.includes(body.category)) {
        res.status(400).json({ error: `category must be one of: ${MEMORY_CATEGORIES.join(", ")}` });
        return;
      }

      const record = await memoryService.createMemory(projectId, {
        scope: body.scope,
        sprintId: body.sprintId,
        agentPresetId: body.agentPresetId,
        content: body.content,
        category: body.category,
        strength: body.strength,
        source: body.source ?? { type: "manual" },
      });

      res.status(201).json(record);
    } catch (error) {
      res.status(400).json({ error: toError(error, "Failed to create memory") });
    }
  });

  app.patch("/api/memories/:memoryId", (req, res) => {
    try {
      const memoryId = String(req.params.memoryId).trim();
      const body = req.body as Partial<UpdateMemoryInput>;
      const record = memoryService.updateMemory(memoryId, body);
      res.json(record);
    } catch (error) {
      res.status(400).json({ error: toError(error, "Failed to update memory") });
    }
  });

  app.delete("/api/memories/:memoryId", (req, res) => {
    try {
      const memoryId = String(req.params.memoryId).trim();
      memoryService.deleteMemory(memoryId);
      res.status(204).send();
    } catch (error) {
      res.status(400).json({ error: toError(error, "Failed to delete memory") });
    }
  });

  // --- Semantic search ---

  app.post("/api/projects/:projectId/memories/search", async (req, res) => {
    try {
      const projectId = String(req.params.projectId).trim();
      const { query, scope, limit, minSimilarity } = req.body as {
        query?: string;
        scope?: MemoryScope;
        limit?: number;
        minSimilarity?: number;
      };

      if (!query || typeof query !== "string") {
        res.status(400).json({ error: "query is required" });
        return;
      }

      const results = await memoryService.search({
        projectId,
        query,
        scope,
        limit,
        minSimilarity,
      });

      res.json(results);
    } catch (error) {
      res.status(400).json({ error: toError(error, "Failed to search memories") });
    }
  });

  // --- Promotion ---

  app.post("/api/projects/:projectId/memories/promotion/analyze", async (req, res) => {
    try {
      const projectId = String(req.params.projectId).trim();
      const { sprintId } = req.body as { sprintId?: string };

      if (!sprintId) {
        res.status(400).json({ error: "sprintId is required" });
        return;
      }

      const candidates = await memoryPromotionService.analyzeForPromotion(projectId, sprintId);
      res.json(candidates);
    } catch (error) {
      res.status(400).json({ error: toError(error, "Failed to analyze for promotion") });
    }
  });

  app.post("/api/projects/:projectId/memories/promotion/execute", (req, res) => {
    try {
      const projectId = String(req.params.projectId).trim();
      const { memoryIds, reason } = req.body as { memoryIds?: string[]; reason?: string };

      if (!memoryIds || !Array.isArray(memoryIds) || memoryIds.length === 0) {
        res.status(400).json({ error: "memoryIds array is required" });
        return;
      }

      const promoted = memoryPromotionService.promoteMemories(projectId, memoryIds, reason);
      res.json(promoted);
    } catch (error) {
      res.status(400).json({ error: toError(error, "Failed to promote memories") });
    }
  });

  // --- Embedding model management ---

  app.get("/api/embedding-models", (req, res) => {
    try {
      const statuses = embeddingModelManager.getStatuses();
      const models = statuses.map((status) => ({
        ...status,
        ...EMBEDDING_MODEL_CATALOG[status.id],
        active: embeddingService.getLoadedModelId() === status.id,
      }));
      res.json(models);
    } catch (error) {
      res.status(400).json({ error: toError(error, "Failed to list embedding models") });
    }
  });

  app.post("/api/embedding-models/:modelId/download", async (req, res) => {
    try {
      const modelId = String(req.params.modelId) as EmbeddingModelId;
      if (!EMBEDDING_MODEL_IDS.includes(modelId)) {
        res.status(400).json({ error: `Unknown model: ${modelId}` });
        return;
      }

      // Start download in background, return immediately
      embeddingModelManager.downloadModel(modelId).catch(() => {
        // Error is persisted to DB status
      });

      res.json({ status: "downloading", modelId });
    } catch (error) {
      res.status(400).json({ error: toError(error, "Failed to start download") });
    }
  });

  app.post("/api/embedding-models/:modelId/cancel", (req, res) => {
    try {
      const modelId = String(req.params.modelId) as EmbeddingModelId;
      embeddingModelManager.cancelDownload(modelId);
      res.json({ status: "cancelled", modelId });
    } catch (error) {
      res.status(400).json({ error: toError(error, "Failed to cancel download") });
    }
  });

  app.post("/api/embedding-models/:modelId/select", async (req, res) => {
    try {
      const modelId = String(req.params.modelId) as EmbeddingModelId;
      if (!EMBEDDING_MODEL_IDS.includes(modelId)) {
        res.status(400).json({ error: `Unknown model: ${modelId}` });
        return;
      }

      await embeddingModelManager.selectModel(modelId);
      res.json({ status: "active", modelId });
    } catch (error) {
      res.status(400).json({ error: toError(error, "Failed to select model") });
    }
  });

  app.delete("/api/embedding-models/:modelId", async (req, res) => {
    try {
      const modelId = String(req.params.modelId) as EmbeddingModelId;
      await embeddingModelManager.deleteModel(modelId);
      res.status(204).send();
    } catch (error) {
      res.status(400).json({ error: toError(error, "Failed to delete model") });
    }
  });

  app.get("/api/embedding-models/:modelId/status", (req, res) => {
    try {
      const modelId = String(req.params.modelId) as EmbeddingModelId;
      const status = memoryRepository.getModelStatus(modelId);
      if (!status) {
        res.json({
          id: modelId,
          downloaded: embeddingService.isModelDownloaded(modelId),
          downloading: false,
          downloadProgress: 0,
          localPath: null,
          error: null,
          active: embeddingService.getLoadedModelId() === modelId,
        });
        return;
      }
      res.json({
        ...status,
        active: embeddingService.getLoadedModelId() === modelId,
      });
    } catch (error) {
      res.status(400).json({ error: toError(error, "Failed to get model status") });
    }
  });

  // --- Re-embed ---

  app.post("/api/projects/:projectId/memories/reembed", (req, res) => {
    try {
      const projectId = String(req.params.projectId).trim();
      memoryService.startReembedProject(projectId);
      res.json({ status: "started" });
    } catch (error) {
      res.status(400).json({ error: toError(error, "Failed to start re-embed") });
    }
  });

  app.get("/api/projects/:projectId/memories/reembed/progress", (req, res) => {
    try {
      const progress = memoryService.getReembedProgress();
      if (!progress) {
        res.json({ active: false, completed: 0, total: 0 });
        return;
      }
      res.json(progress);
    } catch (error) {
      res.status(400).json({ error: toError(error, "Failed to get re-embed progress") });
    }
  });

  // --- Embedding map (2D projection + similarity edges) ---

  app.get("/api/projects/:projectId/memories/embedding-map", (req, res) => {
    try {
      const projectId = String(req.params.projectId).trim();
      const scope = req.query.scope as MemoryScope | undefined;
      const sprintId = req.query.sprintId as string | undefined;
      const agentPresetId = req.query.agentPresetId as string | undefined;
      const settings = settingsRepository.getProjectResolvedSettings(projectId);
      const topK = settings.memory.mapMaxEdgesPerNode;
      const result = memoryService.getEmbeddingMap(
        projectId, scope, sprintId, agentPresetId, topK,
      );
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: toError(error, "Failed to get embedding map") });
    }
  });

  // --- Memory stats ---

  app.get("/api/projects/:projectId/memories/stats", (req, res) => {
    try {
      const projectId = String(req.params.projectId).trim();
      res.json({
        sprint: memoryService.countByScope(projectId, "sprint"),
        agent: memoryService.countByScope(projectId, "agent"),
        project: memoryService.countByScope(projectId, "project"),
        activeModel: embeddingService.getLoadedModelId(),
        staleEmbeddings: memoryService.countStaleEmbeddings(projectId),
      });
    } catch (error) {
      res.status(400).json({ error: toError(error, "Failed to get memory stats") });
    }
  });
}
