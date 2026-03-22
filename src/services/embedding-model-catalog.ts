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
  "multilingual-e5-large": {
    id: "multilingual-e5-large",
    displayName: "Multilingual E5 Large",
    description: "High-quality multilingual embedding model (XLM-RoBERTa). ~562 MB quantized. 1024 dimensions.",
    dimension: 1024,
    sizeBytes: 562_000_000,
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
    "multilingual-e5-large": "intfloat/multilingual-e5-large",
  };

  const repo = repoMap[modelId];

  if (fileName === "model.onnx") {
    // E5-large uses int8 quantized variant; BGE uses the standard model
    const onnxFile = modelId === "multilingual-e5-large"
      ? "onnx/model_qint8_avx512_vnni.onnx"
      : "onnx/model.onnx";
    return `https://huggingface.co/${repo}/resolve/main/${onnxFile}`;
  }

  return `https://huggingface.co/${repo}/resolve/main/${fileName}`;
}
