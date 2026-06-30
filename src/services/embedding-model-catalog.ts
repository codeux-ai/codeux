import type { EmbeddingModelInfo, InAppEmbeddingModelId } from "../contracts/memory-types.js";

interface EmbeddingModelSource {
  repo: string;
  modelFile: string;
}

const STANDARD_MODEL_FILES = [
  "model.onnx",
  "tokenizer.json",
  "tokenizer_config.json",
];

export const EMBEDDING_MODEL_CATALOG: Record<InAppEmbeddingModelId, EmbeddingModelInfo> = {
  "bge-small-en-v1.5": {
    id: "bge-small-en-v1.5",
    displayName: "BGE Small EN v1.5",
    description: "Compact English embedding model. Fast inference, low memory (~130 MB). 384 dimensions.",
    dimension: 384,
    sizeBytes: 130_000_000,
    language: "English",
    files: STANDARD_MODEL_FILES,
  },
  "bge-base-en-v1.5": {
    id: "bge-base-en-v1.5",
    displayName: "BGE Base EN v1.5",
    description: "Balanced English embedding model with stronger retrieval quality than BGE Small. ~436 MB. 768 dimensions.",
    dimension: 768,
    sizeBytes: 436_000_000,
    language: "English",
    files: STANDARD_MODEL_FILES,
  },
  "bge-large-en-v1.5": {
    id: "bge-large-en-v1.5",
    displayName: "BGE Large EN v1.5",
    description: "Highest-quality English BGE option for local memory search. Requires more disk and RAM. ~1.3 GB. 1024 dimensions.",
    dimension: 1024,
    sizeBytes: 1_337_000_000,
    language: "English",
    files: STANDARD_MODEL_FILES,
  },
  "all-minilm-l6-v2": {
    id: "all-minilm-l6-v2",
    displayName: "All-MiniLM L6 v2",
    description: "Very fast sentence-transformer model for lightweight local semantic search. ~90 MB. 384 dimensions.",
    dimension: 384,
    sizeBytes: 90_000_000,
    language: "English",
    files: STANDARD_MODEL_FILES,
  },
  "all-mpnet-base-v2": {
    id: "all-mpnet-base-v2",
    displayName: "All-MPNet Base v2",
    description: "High-quality sentence-transformer model for English semantic search. ~436 MB. 768 dimensions.",
    dimension: 768,
    sizeBytes: 436_000_000,
    language: "English",
    files: STANDARD_MODEL_FILES,
  },
  "multilingual-e5-large": {
    id: "multilingual-e5-large",
    displayName: "Multilingual E5 Large",
    description: "High-quality multilingual embedding model (XLM-RoBERTa). ~562 MB quantized. 1024 dimensions.",
    dimension: 1024,
    sizeBytes: 562_000_000,
    language: "Multilingual",
    files: STANDARD_MODEL_FILES,
  },
};

const EMBEDDING_MODEL_SOURCES: Record<InAppEmbeddingModelId, EmbeddingModelSource> = {
  "bge-small-en-v1.5": {
    repo: "BAAI/bge-small-en-v1.5",
    modelFile: "onnx/model.onnx",
  },
  "bge-base-en-v1.5": {
    repo: "Xenova/bge-base-en-v1.5",
    modelFile: "onnx/model.onnx",
  },
  "bge-large-en-v1.5": {
    repo: "Xenova/bge-large-en-v1.5",
    modelFile: "onnx/model.onnx",
  },
  "all-minilm-l6-v2": {
    repo: "Xenova/all-MiniLM-L6-v2",
    modelFile: "onnx/model.onnx",
  },
  "all-mpnet-base-v2": {
    repo: "Xenova/all-mpnet-base-v2",
    modelFile: "onnx/model.onnx",
  },
  "multilingual-e5-large": {
    repo: "intfloat/multilingual-e5-large",
    modelFile: "onnx/model_qint8_avx512_vnni.onnx",
  },
};

export function getModelDownloadUrl(modelId: InAppEmbeddingModelId, fileName: string): string {
  const source = EMBEDDING_MODEL_SOURCES[modelId];

  if (fileName === "model.onnx") {
    return `https://huggingface.co/${source.repo}/resolve/main/${source.modelFile}`;
  }

  return `https://huggingface.co/${source.repo}/resolve/main/${fileName}`;
}
