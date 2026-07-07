import { describe, expect, it } from "vitest";
import {
  EMBEDDING_MODEL_IDS,
  type InAppEmbeddingModelId,
} from "../../../src/contracts/memory-types.js";
import {
  EMBEDDING_MODEL_CATALOG,
  createCustomEmbeddingModelDefinition,
  getEmbeddingModelCatalog,
  getModelDownloadUrl,
} from "../../../src/services/embedding-model-catalog.js";

describe("embedding-model-catalog", () => {
  it("contains bge-small-en-v1.5 model", () => {
    const model = EMBEDDING_MODEL_CATALOG["bge-small-en-v1.5"];
    expect(model).toBeDefined();
    expect(model.dimension).toBe(384);
    expect(model.files.length).toBeGreaterThan(0);
  });

  it("contains multilingual-e5-large model", () => {
    const model = EMBEDDING_MODEL_CATALOG["multilingual-e5-large"];
    expect(model).toBeDefined();
    expect(model.dimension).toBe(1024);
    expect(model.files.length).toBeGreaterThan(0);
  });

  it("generates download URLs for model files", () => {
    const url = getModelDownloadUrl("bge-small-en-v1.5", "model.onnx");
    expect(url).toContain("bge-small-en-v1.5");
    expect(url).toContain("model.onnx");
    expect(url).toContain("huggingface.co");
  });

  it("advertises catalog metadata for every downloadable model", () => {
    expect(Object.keys(EMBEDDING_MODEL_CATALOG).sort()).toEqual([...EMBEDDING_MODEL_IDS].sort());

    for (const id of EMBEDDING_MODEL_IDS) {
      const model = EMBEDDING_MODEL_CATALOG[id];
      expect(model.id).toBe(id);
      expect(model.displayName).not.toHaveLength(0);
      expect(model.dimension).toBeGreaterThan(0);
      expect(model.sizeBytes).toBeGreaterThan(0);
      expect(model.files).toEqual(["model.onnx", "tokenizer.json", "tokenizer_config.json"]);
      expect(model.source).toBe("built_in");
    }
  });

  it.each([
    ["all-minilm-l6-v2", "Xenova/all-MiniLM-L6-v2", "onnx/model.onnx"],
    ["all-mpnet-base-v2", "Xenova/all-mpnet-base-v2", "onnx/model.onnx"],
    ["bge-base-en-v1.5", "Xenova/bge-base-en-v1.5", "onnx/model.onnx"],
    ["bge-large-en-v1.5", "Xenova/bge-large-en-v1.5", "onnx/model.onnx"],
    ["multilingual-e5-large", "intfloat/multilingual-e5-large", "onnx/model_qint8_avx512_vnni.onnx"],
  ] satisfies Array<[InAppEmbeddingModelId, string, string]>)(
    "generates Hugging Face ONNX URLs for %s",
    (modelId, repo, modelFile) => {
      expect(getModelDownloadUrl(modelId, "model.onnx")).toBe(`https://huggingface.co/${repo}/resolve/main/${modelFile}`);
      expect(getModelDownloadUrl(modelId, "tokenizer.json")).toBe(`https://huggingface.co/${repo}/resolve/main/tokenizer.json`);
    },
  );

  it("creates a custom model definition from a Hugging Face repo id", () => {
    const model = createCustomEmbeddingModelDefinition({
      displayName: "Custom BGE",
      repoOrUrl: "BAAI/bge-small-en-v1.5",
      onnxModelFile: "onnx/model.onnx",
      tokenizerFiles: ["tokenizer.json", "tokenizer_config.json"],
      dimension: 384,
      approximateSizeBytes: 130_000_000,
      language: "English",
    });

    expect(model).toEqual(expect.objectContaining({
      id: expect.stringMatching(/^hf-BAAI-bge-small-en-v1\.5-onnx-model-/),
      displayName: "Custom BGE",
      huggingFaceRepo: "BAAI/bge-small-en-v1.5",
      huggingFaceUrl: "https://huggingface.co/BAAI/bge-small-en-v1.5",
      onnxModelFile: "onnx/model.onnx",
      tokenizerFiles: ["tokenizer.json", "tokenizer_config.json"],
      dimension: 384,
      approximateSizeBytes: 130_000_000,
      language: "English",
      validationStatus: "valid",
    }));
  });

  it("normalizes a Hugging Face file URL into repo and ONNX path data", () => {
    const model = createCustomEmbeddingModelDefinition({
      displayName: "URL Model",
      huggingFaceRepoOrUrl: "https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/blob/main/onnx/model.onnx",
      tokenizerFiles: ["tokenizer.json"],
      dimension: 384,
      sizeBytes: 90_000_000,
      language: "English",
    });

    expect(model.huggingFaceRepo).toBe("sentence-transformers/all-MiniLM-L6-v2");
    expect(model.onnxModelFile).toBe("onnx/model.onnx");
  });

  it("rejects non-Hugging Face and malformed custom links", () => {
    expect(() => createCustomEmbeddingModelDefinition({
      displayName: "Bad Host",
      repoOrUrl: "https://example.com/owner/repo",
      onnxModelFile: "onnx/model.onnx",
      tokenizerFiles: ["tokenizer.json"],
      dimension: 384,
      approximateSizeBytes: 1,
      language: "English",
    })).toThrow("Only https://huggingface.co");

    expect(() => createCustomEmbeddingModelDefinition({
      displayName: "Bad Repo",
      repoOrUrl: "owner",
      onnxModelFile: "onnx/model.onnx",
      tokenizerFiles: ["tokenizer.json"],
      dimension: 384,
      approximateSizeBytes: 1,
      language: "English",
    })).toThrow("owner/repo");
  });

  it("builds custom Hugging Face download URLs without changing built-in URLs", () => {
    const model = createCustomEmbeddingModelDefinition({
      displayName: "Nested Tokenizer",
      repoOrUrl: "owner/repo-name",
      onnxModelFile: "onnx/model_quantized.onnx",
      tokenizerFiles: ["assets/tokenizer.json", "assets/tokenizer_config.json"],
      dimension: 768,
      approximateSizeBytes: 100,
      language: "English",
    });

    expect(getModelDownloadUrl(model.id, "model.onnx", [model])).toBe(
      "https://huggingface.co/owner/repo-name/resolve/main/onnx/model_quantized.onnx",
    );
    expect(getModelDownloadUrl(model.id, "tokenizer.json", [model])).toBe(
      "https://huggingface.co/owner/repo-name/resolve/main/assets/tokenizer.json",
    );
    expect(getModelDownloadUrl("bge-small-en-v1.5", "model.onnx", [model])).toBe(
      "https://huggingface.co/BAAI/bge-small-en-v1.5/resolve/main/onnx/model.onnx",
    );
  });

  it("merges custom models alongside built-in catalog entries", () => {
    const custom = createCustomEmbeddingModelDefinition({
      displayName: "Custom",
      repoOrUrl: "owner/repo",
      onnxModelFile: "onnx/model.onnx",
      tokenizerFiles: ["tokenizer.json"],
      dimension: 256,
      approximateSizeBytes: 42,
      language: "Multilingual",
    });

    const catalog = getEmbeddingModelCatalog([custom]);
    expect(catalog["bge-small-en-v1.5"].source).toBe("built_in");
    expect(catalog[custom.id]).toEqual(expect.objectContaining({
      id: custom.id,
      source: "custom",
      huggingFaceRepo: "owner/repo",
      files: ["model.onnx", "tokenizer.json"],
    }));
  });

  it("does not allow custom settings entries to override built-in catalog IDs", () => {
    const catalog = getEmbeddingModelCatalog([{
      id: "bge-small-en-v1.5",
      displayName: "Shadow Model",
      huggingFaceRepo: "owner/repo",
      huggingFaceUrl: "https://huggingface.co/owner/repo",
      onnxModelFile: "onnx/model.onnx",
      tokenizerFiles: ["tokenizer.json"],
      dimension: 1,
      approximateSizeBytes: 1,
      language: "English",
      validationStatus: "valid",
    }]);

    expect(catalog["bge-small-en-v1.5"].source).toBe("built_in");
    expect(catalog["bge-small-en-v1.5"].displayName).toBe("BGE Small EN v1.5");
  });
});
