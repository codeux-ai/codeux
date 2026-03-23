import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerMemoryRoutes, type MemoryRouteDependencies } from "../../../src/server/memory-routes.js";

// Minimal Express-like mock
function createMockApp() {
  const routes: Record<string, Record<string, Function>> = {};
  const app = {
    get: vi.fn((path: string, handler: Function) => {
      routes[`GET:${path}`] = { handler };
    }),
    post: vi.fn((path: string, handler: Function) => {
      routes[`POST:${path}`] = { handler };
    }),
    patch: vi.fn((path: string, handler: Function) => {
      routes[`PATCH:${path}`] = { handler };
    }),
    delete: vi.fn((path: string, handler: Function) => {
      routes[`DELETE:${path}`] = { handler };
    }),
  };
  return { app, routes };
}

function createMockRes() {
  const res: any = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  };
  return res;
}

function createMockDeps(): MemoryRouteDependencies {
  return {
    memoryService: {
      createMemory: vi.fn().mockResolvedValue({ id: "m1", content: "test" }),
      updateMemory: vi.fn().mockReturnValue({ id: "m1", content: "updated" }),
      deleteMemory: vi.fn(),
      listByProject: vi.fn().mockReturnValue([]),
      listBySprint: vi.fn().mockReturnValue([]),
      listByAgent: vi.fn().mockReturnValue([]),
      search: vi.fn().mockResolvedValue([]),
      reembedProject: vi.fn().mockResolvedValue(5),
      startReembedProject: vi.fn(),
      getReembedProgress: vi.fn().mockReturnValue(null),
      countByScope: vi.fn().mockReturnValue(10),
      countStaleEmbeddings: vi.fn().mockReturnValue(0),
      getEmbeddingMap: vi.fn().mockReturnValue({ nodes: [], edges: [], hasEmbeddings: false }),
    } as any,
    memoryPromotionService: {
      analyzeForPromotion: vi.fn().mockResolvedValue([]),
      promoteMemories: vi.fn().mockReturnValue([]),
    } as any,
    embeddingModelManager: {
      downloadModel: vi.fn().mockResolvedValue(undefined),
      cancelDownload: vi.fn(),
      selectModel: vi.fn().mockResolvedValue(undefined),
      deleteModel: vi.fn().mockResolvedValue(undefined),
      getStatuses: vi.fn().mockReturnValue([]),
    } as any,
    embeddingService: {
      getLoadedModelId: vi.fn().mockReturnValue(null),
      isModelDownloaded: vi.fn().mockReturnValue(false),
    } as any,
    memoryRepository: {
      getModelStatus: vi.fn().mockReturnValue(null),
    } as any,
    settingsRepository: {
      getProjectResolvedSettings: vi.fn().mockReturnValue({
        memory: { mapMaxEdgesPerNode: 3 },
      }),
    } as any,
  };
}

describe("memory-routes", () => {
  let app: ReturnType<typeof createMockApp>["app"];
  let routes: ReturnType<typeof createMockApp>["routes"];
  let deps: MemoryRouteDependencies;

  beforeEach(() => {
    vi.clearAllMocks();
    const mock = createMockApp();
    app = mock.app;
    routes = mock.routes;
    deps = createMockDeps();
    registerMemoryRoutes(app as any, deps);
  });

  it("registers all expected routes", () => {
    expect(app.get).toHaveBeenCalledTimes(6); // list, embedding-models, model status, reembed progress, embedding-map, stats
    expect(app.post).toHaveBeenCalledTimes(8); // create, search, promotion analyze/execute, download, cancel, select, reembed
    expect(app.patch).toHaveBeenCalledTimes(1); // update
    expect(app.delete).toHaveBeenCalledTimes(2); // delete memory, delete model
  });

  describe("GET /api/projects/:projectId/memories", () => {
    it("calls listByProject when no sprintId/agentPresetId", () => {
      const handler = routes["GET:/api/projects/:projectId/memories"].handler;
      const res = createMockRes();
      handler({ params: { projectId: "p1" }, query: {} }, res);
      expect(deps.memoryService.listByProject).toHaveBeenCalledWith("p1", undefined, undefined);
      expect(res.json).toHaveBeenCalled();
    });

    it("calls listBySprint when sprintId provided", () => {
      const handler = routes["GET:/api/projects/:projectId/memories"].handler;
      const res = createMockRes();
      handler({ params: { projectId: "p1" }, query: { sprintId: "s1" } }, res);
      expect(deps.memoryService.listBySprint).toHaveBeenCalledWith("p1", "s1", undefined);
    });

    it("calls listByAgent when agentPresetId provided", () => {
      const handler = routes["GET:/api/projects/:projectId/memories"].handler;
      const res = createMockRes();
      handler({ params: { projectId: "p1" }, query: { agentPresetId: "a1" } }, res);
      expect(deps.memoryService.listByAgent).toHaveBeenCalledWith("p1", "a1", undefined);
    });
  });

  describe("POST /api/projects/:projectId/memories", () => {
    it("creates a memory with valid input", async () => {
      const handler = routes["POST:/api/projects/:projectId/memories"].handler;
      const res = createMockRes();
      await handler(
        { params: { projectId: "p1" }, body: { content: "test", scope: "project", category: "context" } },
        res,
      );
      expect(deps.memoryService.createMemory).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it("rejects missing content", async () => {
      const handler = routes["POST:/api/projects/:projectId/memories"].handler;
      const res = createMockRes();
      await handler({ params: { projectId: "p1" }, body: { scope: "project", category: "context" } }, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("rejects invalid scope", async () => {
      const handler = routes["POST:/api/projects/:projectId/memories"].handler;
      const res = createMockRes();
      await handler({ params: { projectId: "p1" }, body: { content: "x", scope: "invalid", category: "context" } }, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("rejects invalid category", async () => {
      const handler = routes["POST:/api/projects/:projectId/memories"].handler;
      const res = createMockRes();
      await handler({ params: { projectId: "p1" }, body: { content: "x", scope: "project", category: "invalid" } }, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe("PATCH /api/memories/:memoryId", () => {
    it("updates a memory", () => {
      const handler = routes["PATCH:/api/memories/:memoryId"].handler;
      const res = createMockRes();
      handler({ params: { memoryId: "m1" }, body: { content: "new" } }, res);
      expect(deps.memoryService.updateMemory).toHaveBeenCalledWith("m1", { content: "new" });
    });
  });

  describe("DELETE /api/memories/:memoryId", () => {
    it("deletes a memory", () => {
      const handler = routes["DELETE:/api/memories/:memoryId"].handler;
      const res = createMockRes();
      handler({ params: { memoryId: "m1" } }, res);
      expect(deps.memoryService.deleteMemory).toHaveBeenCalledWith("m1");
      expect(res.status).toHaveBeenCalledWith(204);
    });
  });

  describe("POST /api/projects/:projectId/memories/search", () => {
    it("searches with valid query", async () => {
      const handler = routes["POST:/api/projects/:projectId/memories/search"].handler;
      const res = createMockRes();
      await handler({ params: { projectId: "p1" }, body: { query: "test query" } }, res);
      expect(deps.memoryService.search).toHaveBeenCalled();
    });

    it("rejects missing query", async () => {
      const handler = routes["POST:/api/projects/:projectId/memories/search"].handler;
      const res = createMockRes();
      await handler({ params: { projectId: "p1" }, body: {} }, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe("POST /api/projects/:projectId/memories/promotion/analyze", () => {
    it("analyzes with sprintId", async () => {
      const handler = routes["POST:/api/projects/:projectId/memories/promotion/analyze"].handler;
      const res = createMockRes();
      await handler({ params: { projectId: "p1" }, body: { sprintId: "s1" } }, res);
      expect(deps.memoryPromotionService.analyzeForPromotion).toHaveBeenCalledWith("p1", "s1");
    });

    it("rejects missing sprintId", async () => {
      const handler = routes["POST:/api/projects/:projectId/memories/promotion/analyze"].handler;
      const res = createMockRes();
      await handler({ params: { projectId: "p1" }, body: {} }, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe("POST /api/projects/:projectId/memories/promotion/execute", () => {
    it("promotes with valid memoryIds", () => {
      const handler = routes["POST:/api/projects/:projectId/memories/promotion/execute"].handler;
      const res = createMockRes();
      handler({ params: { projectId: "p1" }, body: { memoryIds: ["m1", "m2"] } }, res);
      expect(deps.memoryPromotionService.promoteMemories).toHaveBeenCalledWith("p1", ["m1", "m2"], undefined);
    });

    it("rejects empty memoryIds", () => {
      const handler = routes["POST:/api/projects/:projectId/memories/promotion/execute"].handler;
      const res = createMockRes();
      handler({ params: { projectId: "p1" }, body: { memoryIds: [] } }, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe("GET /api/embedding-models", () => {
    it("returns models with statuses", () => {
      const handler = routes["GET:/api/embedding-models"].handler;
      const res = createMockRes();
      handler({}, res);
      expect(deps.embeddingModelManager.getStatuses).toHaveBeenCalled();
    });
  });

  describe("POST /api/embedding-models/:modelId/download", () => {
    it("starts download for valid model", async () => {
      const handler = routes["POST:/api/embedding-models/:modelId/download"].handler;
      const res = createMockRes();
      await handler({ params: { modelId: "bge-small-en-v1.5" } }, res);
      expect(res.json).toHaveBeenCalledWith({ status: "downloading", modelId: "bge-small-en-v1.5" });
    });

    it("rejects unknown model", async () => {
      const handler = routes["POST:/api/embedding-models/:modelId/download"].handler;
      const res = createMockRes();
      await handler({ params: { modelId: "unknown-model" } }, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe("POST /api/embedding-models/:modelId/cancel", () => {
    it("cancels download", () => {
      const handler = routes["POST:/api/embedding-models/:modelId/cancel"].handler;
      const res = createMockRes();
      handler({ params: { modelId: "bge-small-en-v1.5" } }, res);
      expect(deps.embeddingModelManager.cancelDownload).toHaveBeenCalledWith("bge-small-en-v1.5");
    });
  });

  describe("POST /api/embedding-models/:modelId/select", () => {
    it("selects a valid model", async () => {
      const handler = routes["POST:/api/embedding-models/:modelId/select"].handler;
      const res = createMockRes();
      await handler({ params: { modelId: "bge-small-en-v1.5" } }, res);
      expect(deps.embeddingModelManager.selectModel).toHaveBeenCalledWith("bge-small-en-v1.5");
    });

    it("rejects unknown model", async () => {
      const handler = routes["POST:/api/embedding-models/:modelId/select"].handler;
      const res = createMockRes();
      await handler({ params: { modelId: "fake" } }, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe("DELETE /api/embedding-models/:modelId", () => {
    it("deletes model", async () => {
      const handler = routes["DELETE:/api/embedding-models/:modelId"].handler;
      const res = createMockRes();
      await handler({ params: { modelId: "bge-small-en-v1.5" } }, res);
      expect(deps.embeddingModelManager.deleteModel).toHaveBeenCalledWith("bge-small-en-v1.5");
      expect(res.status).toHaveBeenCalledWith(204);
    });
  });

  describe("GET /api/embedding-models/:modelId/status", () => {
    it("returns DB status when available", () => {
      const handler = routes["GET:/api/embedding-models/:modelId/status"].handler;
      const res = createMockRes();
      (deps.memoryRepository as any).getModelStatus.mockReturnValue({
        id: "bge-small-en-v1.5",
        downloaded: true,
        downloading: false,
        downloadProgress: 1,
        localPath: "/models/bge",
        error: null,
      });
      handler({ params: { modelId: "bge-small-en-v1.5" } }, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ downloaded: true, active: false }));
    });

    it("returns default status when no DB record", () => {
      const handler = routes["GET:/api/embedding-models/:modelId/status"].handler;
      const res = createMockRes();
      handler({ params: { modelId: "bge-small-en-v1.5" } }, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ downloaded: false, active: false }));
    });
  });

  describe("POST /api/projects/:projectId/memories/reembed", () => {
    it("starts re-embed and returns status", () => {
      const handler = routes["POST:/api/projects/:projectId/memories/reembed"].handler;
      const res = createMockRes();
      handler({ params: { projectId: "p1" } }, res);
      expect(res.json).toHaveBeenCalledWith({ status: "started" });
    });
  });

  describe("GET /api/projects/:projectId/memories/embedding-map", () => {
    it("returns embedding map data with topK from settings", () => {
      const handler = routes["GET:/api/projects/:projectId/memories/embedding-map"].handler;
      const res = createMockRes();
      handler({ params: { projectId: "p1" }, query: {} }, res);
      expect(deps.settingsRepository.getProjectResolvedSettings).toHaveBeenCalledWith("p1");
      expect(deps.memoryService.getEmbeddingMap).toHaveBeenCalledWith("p1", undefined, undefined, undefined, 3);
      expect(res.json).toHaveBeenCalledWith({ nodes: [], edges: [], hasEmbeddings: false });
    });

    it("passes scope query parameter", () => {
      const handler = routes["GET:/api/projects/:projectId/memories/embedding-map"].handler;
      const res = createMockRes();
      handler({ params: { projectId: "p1" }, query: { scope: "project" } }, res);
      expect(deps.memoryService.getEmbeddingMap).toHaveBeenCalledWith("p1", "project", undefined, undefined, 3);
    });
  });

  describe("GET /api/projects/:projectId/memories/stats", () => {
    it("returns memory stats", () => {
      const handler = routes["GET:/api/projects/:projectId/memories/stats"].handler;
      const res = createMockRes();
      handler({ params: { projectId: "p1" } }, res);
      expect(res.json).toHaveBeenCalledWith({
        sprint: 10,
        agent: 10,
        project: 10,
        activeModel: null,
        staleEmbeddings: 0,
      });
    });
  });
});
