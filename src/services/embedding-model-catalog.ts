import { createHash } from "crypto";
import * as path from "path";
import type {
  CreateCustomEmbeddingModelInput,
  CustomEmbeddingModelDefinition,
  EmbeddingModelId,
  EmbeddingModelInfo,
  InAppEmbeddingModelId,
} from "../contracts/memory-types.js";
import { isInAppEmbeddingModelId } from "../contracts/memory-types.js";

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
    source: "built_in",
  },
  "bge-base-en-v1.5": {
    id: "bge-base-en-v1.5",
    displayName: "BGE Base EN v1.5",
    description: "Balanced English embedding model with stronger retrieval quality than BGE Small. ~436 MB. 768 dimensions.",
    dimension: 768,
    sizeBytes: 436_000_000,
    language: "English",
    files: STANDARD_MODEL_FILES,
    source: "built_in",
  },
  "bge-large-en-v1.5": {
    id: "bge-large-en-v1.5",
    displayName: "BGE Large EN v1.5",
    description: "Highest-quality English BGE option for local memory search. Requires more disk and RAM. ~1.3 GB. 1024 dimensions.",
    dimension: 1024,
    sizeBytes: 1_337_000_000,
    language: "English",
    files: STANDARD_MODEL_FILES,
    source: "built_in",
  },
  "all-minilm-l6-v2": {
    id: "all-minilm-l6-v2",
    displayName: "All-MiniLM L6 v2",
    description: "Very fast sentence-transformer model for lightweight local semantic search. ~90 MB. 384 dimensions.",
    dimension: 384,
    sizeBytes: 90_000_000,
    language: "English",
    files: STANDARD_MODEL_FILES,
    source: "built_in",
  },
  "all-mpnet-base-v2": {
    id: "all-mpnet-base-v2",
    displayName: "All-MPNet Base v2",
    description: "High-quality sentence-transformer model for English semantic search. ~436 MB. 768 dimensions.",
    dimension: 768,
    sizeBytes: 436_000_000,
    language: "English",
    files: STANDARD_MODEL_FILES,
    source: "built_in",
  },
  "multilingual-e5-large": {
    id: "multilingual-e5-large",
    displayName: "Multilingual E5 Large",
    description: "High-quality multilingual embedding model (XLM-RoBERTa). ~562 MB quantized. 1024 dimensions.",
    dimension: 1024,
    sizeBytes: 562_000_000,
    language: "Multilingual",
    files: STANDARD_MODEL_FILES,
    source: "built_in",
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

const HUGGING_FACE_BASE_URL = "https://huggingface.co";
const DEFAULT_CUSTOM_MODEL_FILE = "onnx/model.onnx";
const CUSTOM_MODEL_ID_SLUG_LENGTH = 56;

export function getEmbeddingModelCatalog(
  customModels: readonly CustomEmbeddingModelDefinition[] = [],
): Record<EmbeddingModelId, EmbeddingModelInfo> {
  return {
    ...EMBEDDING_MODEL_CATALOG,
    ...Object.fromEntries(
      customModels
        .filter((model) => model.validationStatus === "valid" && !isInAppEmbeddingModelId(model.id))
        .map((model) => [model.id, customEmbeddingModelToCatalogEntry(model)]),
    ),
  };
}

export function getEmbeddingModelInfo(
  modelId: EmbeddingModelId,
  customModels: readonly CustomEmbeddingModelDefinition[] = [],
): EmbeddingModelInfo | null {
  if (isInAppEmbeddingModelId(modelId)) {
    return EMBEDDING_MODEL_CATALOG[modelId];
  }

  const customModel = customModels.find((model) => model.id === modelId && model.validationStatus === "valid" && !isInAppEmbeddingModelId(model.id));
  return customModel ? customEmbeddingModelToCatalogEntry(customModel) : null;
}

export function customEmbeddingModelToCatalogEntry(model: CustomEmbeddingModelDefinition): EmbeddingModelInfo {
  return {
    id: model.id,
    displayName: model.displayName,
    description: `Custom Hugging Face embedding model from ${model.huggingFaceRepo}.`,
    dimension: model.dimension,
    sizeBytes: model.approximateSizeBytes,
    language: model.language,
    files: customModelLocalFiles(model),
    source: "custom",
    huggingFaceRepo: model.huggingFaceRepo,
    onnxModelFile: model.onnxModelFile,
    validationStatus: model.validationStatus,
  };
}

export function getModelDownloadUrl(
  modelId: EmbeddingModelId,
  fileName: string,
  customModels: readonly CustomEmbeddingModelDefinition[] = [],
): string {
  if (isInAppEmbeddingModelId(modelId)) {
    const source = EMBEDDING_MODEL_SOURCES[modelId];

    if (fileName === "model.onnx") {
      return `${HUGGING_FACE_BASE_URL}/${source.repo}/resolve/main/${source.modelFile}`;
    }

    return `${HUGGING_FACE_BASE_URL}/${source.repo}/resolve/main/${fileName}`;
  }

  const customModel = customModels.find((model) => model.id === modelId && model.validationStatus === "valid");
  if (!customModel) {
    throw new Error(`Unknown model: ${modelId}`);
  }

  const sourcePath = getCustomSourceFilePath(customModel, fileName);
  return `${HUGGING_FACE_BASE_URL}/${customModel.huggingFaceRepo}/resolve/main/${sourcePath}`;
}

export function createCustomEmbeddingModelDefinition(
  input: CreateCustomEmbeddingModelInput,
  existingModels: readonly CustomEmbeddingModelDefinition[] = [],
): CustomEmbeddingModelDefinition {
  const source = parseCustomModelSource(input.huggingFaceRepoOrUrl ?? input.repoOrUrl);
  const onnxModelFile = normalizeRepositoryFilePath(input.onnxModelFile, source.filePath ?? DEFAULT_CUSTOM_MODEL_FILE, "onnxModelFile");
  if (!onnxModelFile.endsWith(".onnx")) {
    throw new Error("onnxModelFile must point to an .onnx file");
  }

  const tokenizerFiles = normalizeTokenizerFiles(input.tokenizerFiles);
  const dimension = readPositiveInteger(input.dimension, "dimension");
  const approximateSizeBytes = readNonNegativeInteger(input.approximateSizeBytes ?? input.sizeBytes, "approximateSizeBytes");
  const displayName = readRequiredString(input.displayName, "displayName");
  const language = readRequiredString(input.language, "language");
  const id = buildCustomModelId(source.repo, onnxModelFile);

  const existing = existingModels.find((model) => model.id === id);
  if (existing) {
    return {
      ...existing,
      displayName,
      onnxModelFile,
      tokenizerFiles,
      dimension,
      approximateSizeBytes,
      language,
      validationStatus: "valid",
    };
  }

  return {
    id,
    displayName,
    huggingFaceRepo: source.repo,
    huggingFaceUrl: `${HUGGING_FACE_BASE_URL}/${source.repo}`,
    onnxModelFile,
    tokenizerFiles,
    dimension,
    approximateSizeBytes,
    language,
    validationStatus: "valid",
  };
}

export function sanitizeCustomEmbeddingModelDefinitions(
  value: unknown,
): CustomEmbeddingModelDefinition[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const sanitized = new Map<EmbeddingModelId, CustomEmbeddingModelDefinition>();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    try {
      const record = item as Record<string, unknown>;
      const source = parseCustomModelSource(record.huggingFaceRepo ?? record.huggingFaceUrl ?? record.repoOrUrl);
      const onnxModelFile = normalizeRepositoryFilePath(record.onnxModelFile, DEFAULT_CUSTOM_MODEL_FILE, "onnxModelFile");
      const tokenizerFiles = normalizeTokenizerFiles(record.tokenizerFiles);
      const dimension = readPositiveInteger(record.dimension, "dimension");
      const approximateSizeBytes = readNonNegativeInteger(record.approximateSizeBytes ?? record.sizeBytes, "approximateSizeBytes");
      const displayName = readRequiredString(record.displayName, "displayName");
      const language = readRequiredString(record.language, "language");
      const id = typeof record.id === "string" && record.id.trim()
        ? record.id.trim() as EmbeddingModelId
        : buildCustomModelId(source.repo, onnxModelFile);

      if (isInAppEmbeddingModelId(id)) {
        continue;
      }

      sanitized.set(id, {
        id,
        displayName,
        huggingFaceRepo: source.repo,
        huggingFaceUrl: `${HUGGING_FACE_BASE_URL}/${source.repo}`,
        onnxModelFile,
        tokenizerFiles,
        dimension,
        approximateSizeBytes,
        language,
        validationStatus: record.validationStatus === "invalid" ? "invalid" : "valid",
      });
    } catch {
      // Drop malformed persisted custom model definitions during settings sanitization.
    }
  }
  return [...sanitized.values()];
}

function parseCustomModelSource(value: unknown): { repo: string; filePath: string | null } {
  const raw = readRequiredString(value, "huggingFaceRepoOrUrl");
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    return parseHuggingFaceUrl(raw);
  }
  if (raw.includes("://")) {
    throw new Error("Only Hugging Face repositories or URLs are supported");
  }
  return { repo: normalizeHuggingFaceRepo(raw), filePath: null };
}

function parseHuggingFaceUrl(raw: string): { repo: string; filePath: string | null } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Malformed Hugging Face URL");
  }

  if (url.protocol !== "https:" || url.hostname !== "huggingface.co") {
    throw new Error("Only https://huggingface.co model URLs are supported");
  }

  const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (segments.length < 2) {
    throw new Error("Hugging Face URL must include an owner and repository name");
  }

  const repo = normalizeHuggingFaceRepo(`${segments[0]}/${segments[1]}`);
  if ((segments[2] === "resolve" || segments[2] === "blob") && segments.length >= 5) {
    return {
      repo,
      filePath: normalizeRepositoryFilePath(segments.slice(4).join("/"), DEFAULT_CUSTOM_MODEL_FILE, "onnxModelFile"),
    };
  }

  return { repo, filePath: null };
}

function normalizeHuggingFaceRepo(value: string): string {
  const repo = trimBoundarySlashes(value.trim());
  const segments = repo.split("/");
  if (segments.length !== 2 || !segments.every(isHuggingFaceRepoSegment)) {
    throw new Error("Hugging Face repo must use the form owner/repo");
  }
  return segments.join("/");
}

function trimBoundarySlashes(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value.charCodeAt(start) === 47) {
    start += 1;
  }
  while (end > start && value.charCodeAt(end - 1) === 47) {
    end -= 1;
  }
  return value.slice(start, end);
}

function isHuggingFaceRepoSegment(segment: string): boolean {
  if (segment.length === 0 || !isAsciiAlphanumeric(segment.charCodeAt(0))) {
    return false;
  }

  for (let index = 1; index < segment.length; index += 1) {
    const code = segment.charCodeAt(index);
    if (!isAsciiAlphanumeric(code) && code !== 45 && code !== 46 && code !== 95) {
      return false;
    }
  }

  return true;
}

function normalizeTokenizerFiles(value: unknown): string[] {
  const input = value === undefined ? STANDARD_MODEL_FILES.slice(1) : value;
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error("tokenizerFiles must include tokenizer.json and any required tokenizer metadata files");
  }

  const files = input.map((file, index) => normalizeRepositoryFilePath(file, "", `tokenizerFiles[${index}]`));
  if (!files.includes("tokenizer.json") && !files.some((file) => path.posix.basename(file) === "tokenizer.json")) {
    throw new Error("tokenizerFiles must include tokenizer.json");
  }

  const basenames = new Set<string>();
  for (const file of files) {
    const basename = path.posix.basename(file);
    if (basenames.has(basename)) {
      throw new Error(`Duplicate tokenizer destination file: ${basename}`);
    }
    basenames.add(basename);
  }

  return files;
}

function normalizeRepositoryFilePath(value: unknown, fallback: string, field: string): string {
  const raw = typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
  if (!raw || raw.includes("\\") || raw.startsWith("/") || raw.includes("\0") || raw.includes("?") || raw.includes("#")) {
    throw new Error(`${field} must be a relative repository file path`);
  }

  const segments = raw.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`${field} must not contain empty, current, or parent path segments`);
  }

  return segments.join("/");
}

function readRequiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} is required`);
  }
  return value.trim();
}

function readPositiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
  return value;
}

function readNonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }
  return value;
}

function buildCustomModelId(repo: string, onnxModelFile: string): EmbeddingModelId {
  const slug = sanitizeCustomModelIdSlug(stripOnnxExtension(`${repo}-${onnxModelFile}`));
  const digest = createHash("sha256").update(`${repo}:${onnxModelFile}`).digest("hex").slice(0, 8);
  return `hf-${slug}-${digest}` as EmbeddingModelId;
}

function stripOnnxExtension(value: string): string {
  return value.length >= 5 && value.slice(-5).toLowerCase() === ".onnx"
    ? value.slice(0, -5)
    : value;
}

function sanitizeCustomModelIdSlug(value: string): string {
  let output = "";
  let previousCharacterWasReplacement = false;

  for (const character of value) {
    const code = character.charCodeAt(0);
    if (isCustomModelIdSlugCharacter(code)) {
      output += character;
      previousCharacterWasReplacement = false;
      continue;
    }

    if (!previousCharacterWasReplacement) {
      output += "-";
      previousCharacterWasReplacement = true;
    }
  }

  return trimBoundaryHyphens(output).slice(0, CUSTOM_MODEL_ID_SLUG_LENGTH);
}

function trimBoundaryHyphens(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value.charCodeAt(start) === 45) {
    start += 1;
  }
  while (end > start && value.charCodeAt(end - 1) === 45) {
    end -= 1;
  }
  return value.slice(start, end);
}

function isCustomModelIdSlugCharacter(code: number): boolean {
  return isAsciiAlphanumeric(code) || code === 45 || code === 46 || code === 95;
}

function isAsciiAlphanumeric(code: number): boolean {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function customModelLocalFiles(model: CustomEmbeddingModelDefinition): string[] {
  return [
    "model.onnx",
    ...model.tokenizerFiles.map((file) => path.posix.basename(file)),
  ];
}

function getCustomSourceFilePath(model: CustomEmbeddingModelDefinition, localFileName: string): string {
  if (localFileName === "model.onnx") {
    return model.onnxModelFile;
  }

  const tokenizerFile = model.tokenizerFiles.find((file) => path.posix.basename(file) === localFileName);
  if (!tokenizerFile) {
    throw new Error(`Unknown file ${localFileName} for model ${model.id}`);
  }

  return tokenizerFile;
}
