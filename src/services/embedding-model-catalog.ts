import type { EmbeddingModelId, EmbeddingModelInfo } from "../contracts/memory-types.js";

export const EMBEDDING_MODEL_CATALOG: Record<EmbeddingModelId, EmbeddingModelInfo> = {
  "bge-small-en-v1.5": {
    id: "bge-small-en-v1.5",
    displayName: "BGE Small EN v1.5",
    description: "Compact English embedding model. Fast inference, low memory (~130 MB). 384 dimensions.",
    dimension: 384,
    sizeBytes: 130_000_000,
    language: "English",
    files: [
      "model.onnx",
      "tokenizer.json",
      "tokenizer_config.json",
    ],
  },
  "Qwen3-Embedding-0.6B": {
    id: "Qwen3-Embedding-0.6B",
    displayName: "Qwen3 Embedding 0.6B",
    description: "Multilingual embedding model. Higher quality, larger footprint (~614 MB quantized). 1024 dimensions.",
    dimension: 1024,
    sizeBytes: 614_000_000,
    language: "Multilingual",
    files: [
      "model.onnx",
      "tokenizer.json",
      "tokenizer_config.json",
    ],
  },
};

export function getModelDownloadUrl(modelId: EmbeddingModelId, fileName: string): string {
  const repoMap: Record<EmbeddingModelId, string> = {
    "bge-small-en-v1.5": "BAAI/bge-small-en-v1.5",
    "Qwen3-Embedding-0.6B": "onnx-community/Qwen3-Embedding-0.6B-ONNX",
  };

  const repo = repoMap[modelId];

  if (fileName === "model.onnx") {
    // Qwen3 uses the int8 quantized ONNX variant from the onnx-community repo
    const onnxFile = modelId === "Qwen3-Embedding-0.6B" ? "onnx/model_quantized.onnx" : "onnx/model.onnx";
    return `https://huggingface.co/${repo}/resolve/main/${onnxFile}`;
  }

  return `https://huggingface.co/${repo}/resolve/main/${fileName}`;
}
