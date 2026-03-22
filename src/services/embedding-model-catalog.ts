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
    description: "Multilingual embedding model. Higher quality, larger footprint (~1.2 GB). 1024 dimensions.",
    dimension: 1024,
    sizeBytes: 1_200_000_000,
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
    "Qwen3-Embedding-0.6B": "Qwen/Qwen3-Embedding-0.6B",
  };

  const repo = repoMap[modelId];
  const branch = modelId === "Qwen3-Embedding-0.6B" ? "main" : "main";
  const onnxPath = fileName === "model.onnx" ? "onnx/model.onnx" : fileName;

  return `https://huggingface.co/${repo}/resolve/${branch}/${onnxPath}`;
}
