import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import { EmbeddingService } from "../../../src/services/embedding-service.js";

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(false),
    rmSync: vi.fn(),
  };
});

describe("EmbeddingService", () => {
  let service: EmbeddingService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new EmbeddingService();
  });

  describe("initial state", () => {
    it("isLoaded returns false", () => {
      expect(service.isLoaded()).toBe(false);
    });

    it("getLoadedModelId returns null", () => {
      expect(service.getLoadedModelId()).toBeNull();
    });

    it("getDimension returns null when no model loaded", () => {
      expect(service.getDimension()).toBeNull();
    });
  });

  describe("embed", () => {
    it("throws when no model loaded", async () => {
      await expect(service.embed("test")).rejects.toThrow("No model loaded");
    });

    it("uses a rotated broker credential on the next external request", async () => {
      let secret = "embedding-secret-v1";
      const resolver = {
        withCredential: vi.fn(async (_reference, _context, consumer) => await consumer(Buffer.from(secret))),
      } as any;
      const fetchImpl = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
        data: [{ embedding: [1, 0] }],
      }), { status: 200, headers: { "content-type": "application/json" } }));
      service = new EmbeddingService(resolver, fetchImpl as any);
      service.configureExternal({
        baseUrl: "https://embedding.example.test/v1/embeddings",
        apiKey: "",
        apiKeyCredentialRef: { credentialId: "embedding-credential", capability: "read" },
        model: "embedding-model",
        dimensions: 2,
      }, "project-1");

      await service.embed("first");
      secret = "embedding-secret-v2";
      await service.embed("second");

      expect(fetchImpl.mock.calls[0]![1]?.headers).toEqual(expect.objectContaining({ Authorization: "Bearer embedding-secret-v1" }));
      expect(fetchImpl.mock.calls[1]![1]?.headers).toEqual(expect.objectContaining({ Authorization: "Bearer embedding-secret-v2" }));
      expect(resolver.withCredential).toHaveBeenCalledTimes(2);
    });
  });

  describe("embedBatch", () => {
    it("throws when no model loaded", async () => {
      await expect(service.embedBatch(["a", "b"])).rejects.toThrow("No model loaded");
    });
  });

  describe("loadModel", () => {
    it("throws when model files are not found", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      await expect(service.loadModel("bge-small-en-v1.5")).rejects.toThrow("Model files not found");
    });
  });

  describe("unloadModel", () => {
    it("does nothing when no model loaded", async () => {
      await expect(service.unloadModel()).resolves.not.toThrow();
      expect(service.isLoaded()).toBe(false);
    });
  });

  describe("isModelDownloaded", () => {
    it("returns false when files don't exist", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      expect(service.isModelDownloaded("bge-small-en-v1.5")).toBe(false);
    });

    it("returns true when both model and tokenizer files exist", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      expect(service.isModelDownloaded("bge-small-en-v1.5")).toBe(true);
    });
  });

  describe("getModelPath", () => {
    it("returns a path containing the model ID", () => {
      const p = service.getModelPath("bge-small-en-v1.5");
      expect(p).toContain("bge-small-en-v1.5");
    });
  });

  describe("deleteModelFiles", () => {
    it("calls rmSync when directory exists", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      service.deleteModelFiles("bge-small-en-v1.5");
      expect(fs.rmSync).toHaveBeenCalled();
    });

    it("does nothing when directory does not exist", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      service.deleteModelFiles("bge-small-en-v1.5");
      expect(fs.rmSync).not.toHaveBeenCalled();
    });
  });
});
