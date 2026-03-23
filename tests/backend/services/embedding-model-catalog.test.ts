import { describe, expect, it } from "vitest";
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
});
