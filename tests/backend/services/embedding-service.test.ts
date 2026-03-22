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
