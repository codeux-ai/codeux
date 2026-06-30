import { describe, expect, it } from "vitest";
import {
  EMBEDDING_MODEL_IDS,
  type InAppEmbeddingModelId,
} from "../../../src/contracts/memory-types.js";
import {
  EMBEDDING_MODEL_CATALOG,
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
});
