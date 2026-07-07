import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import { EmbeddingModelManager } from "../../../src/services/embedding-model-manager.js";
import {
  EMBEDDING_MODEL_CATALOG,
  createCustomEmbeddingModelDefinition,
} from "../../../src/services/embedding-model-catalog.js";
import type { CustomEmbeddingModelDefinition } from "../../../src/contracts/memory-types.js";

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    mkdirSync: vi.fn(),
    createWriteStream: vi.fn().mockReturnValue({
      write: vi.fn((chunk: any, cb: any) => cb()),
      end: vi.fn((cb: any) => cb()),
      destroy: vi.fn(),
    }),
  };
});

const mockEmbeddingService = {
  getModelPath: vi.fn().mockReturnValue("/mock/models/bge-small-en-v1.5"),
  isModelDownloaded: vi.fn().mockReturnValue(false),
  loadModel: vi.fn().mockResolvedValue(undefined),
  unloadModel: vi.fn().mockResolvedValue(undefined),
  deleteModelFiles: vi.fn(),
  getLoadedModelId: vi.fn().mockReturnValue(null),
};

const mockRepository = {
  upsertModelStatus: vi.fn(),
  listModelStatuses: vi.fn().mockReturnValue([]),
  getModelStatus: vi.fn().mockReturnValue(null),
};

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn().mockReturnThis(),
};

describe("EmbeddingModelManager", () => {
  let manager: EmbeddingModelManager;
  let customModel: CustomEmbeddingModelDefinition;
  let systemSettings: any;
  let mockSettingsRepository: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockEmbeddingService.getModelPath.mockReturnValue("/mock/models/bge-small-en-v1.5");
    mockEmbeddingService.isModelDownloaded.mockReturnValue(false);
    mockEmbeddingService.loadModel.mockResolvedValue(undefined);
    mockEmbeddingService.unloadModel.mockResolvedValue(undefined);
    mockEmbeddingService.getLoadedModelId.mockReturnValue(null);
    mockRepository.listModelStatuses.mockReturnValue([]);
    mockRepository.getModelStatus.mockReturnValue(null);
    customModel = createCustomEmbeddingModelDefinition({
      displayName: "Custom BGE",
      repoOrUrl: "owner/custom-bge",
      onnxModelFile: "onnx/model_quantized.onnx",
      tokenizerFiles: ["assets/tokenizer.json", "assets/tokenizer_config.json"],
      dimension: 384,
      approximateSizeBytes: 100,
      language: "English",
    });
    systemSettings = {
      defaults: {
        memory: {
          embeddingModel: null,
          customEmbeddingModels: [customModel],
        },
      },
    };
    mockSettingsRepository = {
      getSystemSettings: vi.fn(() => systemSettings),
      saveSystemSettings: vi.fn((next: any) => {
        systemSettings = next;
        return next;
      }),
    };
    manager = new EmbeddingModelManager(
      mockEmbeddingService as any,
      mockRepository as any,
      mockLogger as any,
      mockSettingsRepository as any,
    );
  });

  describe("cancelDownload", () => {
    it("does nothing when no download is active", () => {
      manager.cancelDownload("bge-small-en-v1.5");
      expect(mockRepository.upsertModelStatus).not.toHaveBeenCalled();
    });
  });

  describe("selectModel", () => {
    it("throws when model is not downloaded", async () => {
      mockEmbeddingService.isModelDownloaded.mockReturnValue(false);
      await expect(manager.selectModel("bge-small-en-v1.5")).rejects.toThrow("not downloaded");
    });

    it("loads the model when downloaded", async () => {
      mockEmbeddingService.isModelDownloaded.mockReturnValue(true);
      await manager.selectModel("bge-small-en-v1.5");
      expect(mockEmbeddingService.loadModel).toHaveBeenCalledWith("bge-small-en-v1.5", expect.objectContaining({
        id: "bge-small-en-v1.5",
        source: "built_in",
      }));
    });

    it("rejects selecting a custom model before every required file is downloaded", async () => {
      vi.spyOn(fs, "existsSync").mockImplementation((filePath) => String(filePath).endsWith("tokenizer.json"));
      mockEmbeddingService.isModelDownloaded.mockReturnValue(true);

      await expect(manager.selectModel(customModel.id)).rejects.toThrow("not downloaded");

      vi.mocked(fs.existsSync).mockRestore();
    });

    it("loads a custom model when all required files are downloaded", async () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      mockEmbeddingService.isModelDownloaded.mockReturnValue(true);

      await manager.selectModel(customModel.id);

      expect(mockEmbeddingService.loadModel).toHaveBeenCalledWith(customModel.id, expect.objectContaining({
        id: customModel.id,
        source: "custom",
        dimension: 384,
      }));

      vi.mocked(fs.existsSync).mockRestore();
    });
  });

  describe("deleteModel", () => {
    it("unloads model if currently loaded before deleting", async () => {
      mockEmbeddingService.getLoadedModelId.mockReturnValue("bge-small-en-v1.5");
      await manager.deleteModel("bge-small-en-v1.5");
      expect(mockEmbeddingService.unloadModel).toHaveBeenCalled();
      expect(mockEmbeddingService.deleteModelFiles).toHaveBeenCalledWith("bge-small-en-v1.5");
      expect(mockRepository.upsertModelStatus).toHaveBeenCalledWith("bge-small-en-v1.5", expect.objectContaining({
        downloaded: false,
        downloading: false,
      }));
    });

    it("deletes without unloading if a different model is loaded", async () => {
      mockEmbeddingService.getLoadedModelId.mockReturnValue("multilingual-e5-large");
      await manager.deleteModel("bge-small-en-v1.5");
      expect(mockEmbeddingService.unloadModel).not.toHaveBeenCalled();
      expect(mockEmbeddingService.deleteModelFiles).toHaveBeenCalledWith("bge-small-en-v1.5");
    });

    it("removes custom model definitions when deleting a custom model", async () => {
      await manager.deleteModel(customModel.id);

      expect(mockEmbeddingService.deleteModelFiles).toHaveBeenCalledWith(customModel.id);
      expect(mockSettingsRepository.saveSystemSettings).toHaveBeenCalledWith(expect.objectContaining({
        defaults: expect.objectContaining({
          memory: expect.objectContaining({
            customEmbeddingModels: [],
          }),
        }),
      }));
    });
  });

  describe("getStatuses", () => {
    it("returns default statuses when no DB records exist", () => {
      mockRepository.listModelStatuses.mockReturnValue([]);
      mockEmbeddingService.isModelDownloaded.mockReturnValue(false);

      const statuses = manager.getStatuses();
      expect(statuses).toHaveLength(Object.keys(EMBEDDING_MODEL_CATALOG).length + 1);
      expect(statuses.every((s) => !s.downloaded)).toBe(true);
    });

    it("merges DB statuses with catalog", () => {
      mockRepository.listModelStatuses.mockReturnValue([
        {
          id: "bge-small-en-v1.5",
          downloaded: true,
          downloading: false,
          downloadProgress: 1,
          localPath: "/models/bge",
          error: null,
        },
      ]);
      mockEmbeddingService.isModelDownloaded.mockReturnValue(false);

      const statuses = manager.getStatuses();
      const bge = statuses.find((s) => s.id === "bge-small-en-v1.5");
      const qwen = statuses.find((s) => s.id === "multilingual-e5-large");
      expect(bge!.downloaded).toBe(true);
      expect(qwen!.downloaded).toBe(false);
    });

    it("includes custom model statuses alongside built-ins", () => {
      mockRepository.listModelStatuses.mockReturnValue([
        {
          id: customModel.id,
          downloaded: true,
          downloading: false,
          downloadProgress: 1,
          localPath: "/models/custom",
          error: null,
        },
      ]);

      const statuses = manager.getStatuses();
      expect(statuses.find((s) => s.id === customModel.id)).toEqual(expect.objectContaining({
        downloaded: true,
        localPath: "/models/custom",
      }));
    });
  });

  describe("downloadModel", () => {
    it("throws for unknown model", async () => {
      await expect(manager.downloadModel("nonexistent" as any)).rejects.toThrow("Unknown model");
    });

    it("sets initial downloading status and creates directory", async () => {
      // Mock fetch to return no body (triggers error path)
      const mockFetch = vi.fn().mockResolvedValue({ ok: true, body: null });
      vi.stubGlobal("fetch", mockFetch);

      await expect(manager.downloadModel("bge-small-en-v1.5")).rejects.toThrow("No response body");

      // Verify it created the model directory
      expect(fs.mkdirSync).toHaveBeenCalled();

      // Verify initial downloading status was set
      expect(mockRepository.upsertModelStatus).toHaveBeenCalledWith("bge-small-en-v1.5", expect.objectContaining({
        downloading: true,
        downloadProgress: 0,
      }));

      // Error status should be set
      expect(mockRepository.upsertModelStatus).toHaveBeenCalledWith("bge-small-en-v1.5", expect.objectContaining({
        downloaded: false,
        downloading: false,
        error: expect.stringContaining("No response body"),
      }));

      vi.unstubAllGlobals();
    });

    it("updates error status on fetch failure", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        body: null,
      });
      vi.stubGlobal("fetch", mockFetch);

      await expect(manager.downloadModel("bge-small-en-v1.5")).rejects.toThrow("HTTP 404");

      expect(mockRepository.upsertModelStatus).toHaveBeenCalledWith("bge-small-en-v1.5", expect.objectContaining({
        downloaded: false,
        downloading: false,
        error: expect.stringContaining("404"),
      }));

      vi.unstubAllGlobals();
    });

    it("constructs custom Hugging Face download URLs", async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true, body: null });
      vi.stubGlobal("fetch", mockFetch);

      await expect(manager.downloadModel(customModel.id)).rejects.toThrow("No response body");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://huggingface.co/owner/custom-bge/resolve/main/onnx/model_quantized.onnx",
        expect.objectContaining({ redirect: "follow" }),
      );

      vi.unstubAllGlobals();
    });

    it("prevents duplicate concurrent downloads", async () => {
      const neverResolve = new Promise(() => {}); // hangs forever
      const mockFetch = vi.fn().mockReturnValue(neverResolve);
      vi.stubGlobal("fetch", mockFetch);

      // Start first download (won't complete)
      const p1 = manager.downloadModel("bge-small-en-v1.5").catch(() => {});

      // Second download should throw immediately
      await expect(manager.downloadModel("bge-small-en-v1.5")).rejects.toThrow("already in progress");

      // Cancel to clean up
      manager.cancelDownload("bge-small-en-v1.5");

      vi.unstubAllGlobals();
    });
  });
});
