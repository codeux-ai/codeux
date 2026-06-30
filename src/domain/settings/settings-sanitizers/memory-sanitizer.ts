import type { DashboardSettings } from "../../../contracts/app-types.js";
import type { EmbeddingModelId, EmbeddingProviderMode, MemoryRemediationMode, MemorySettings } from "../../../contracts/memory-types.js";
import { EMBEDDING_MODEL_IDS } from "../../../contracts/memory-types.js";
import { readBoolean, readInteger } from "../../../shared/config/value-readers.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../repositories/settings-defaults.js";

const readEmbeddingModelId = (value: unknown, provider: EmbeddingProviderMode): EmbeddingModelId | null => {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  const trimmed = value.trim();
  if (provider === "external_api") {
    return trimmed as EmbeddingModelId;
  }
  if (EMBEDDING_MODEL_IDS.includes(trimmed as any)) {
    return trimmed as EmbeddingModelId;
  }
  return null;
};

const readEmbeddingProvider = (value: unknown, fallback: EmbeddingProviderMode): EmbeddingProviderMode => (
  value === "external_api" || value === "in_app" ? value : fallback
);

const readRemediationMode = (value: unknown, fallback: MemoryRemediationMode): MemoryRemediationMode => (
  value === "off" || value === "deterministic" || value === "ai" ? value : fallback
);

const readTrimmedString = (value: unknown, fallback: string): string => (
  typeof value === "string" ? value.trim() : fallback
);

const readNullablePositiveInteger = (value: unknown, fallback: number | null): number | null => {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  const parsed = readInteger(value, fallback ?? 0);
  return parsed > 0 ? parsed : null;
};

export const sanitizeMemory = (
  input: Partial<DashboardSettings> | undefined,
): MemorySettings => {
  const memInput = (input?.memory && typeof input.memory === "object"
    ? input.memory
    : {}) as Partial<MemorySettings>;

  const defaults = DEFAULT_DASHBOARD_SETTINGS.memory;
  const embeddingProvider = readEmbeddingProvider(memInput.embeddingProvider, defaults.embeddingProvider);
  const externalInput = memInput.externalEmbedding && typeof memInput.externalEmbedding === "object"
    ? memInput.externalEmbedding as Partial<MemorySettings["externalEmbedding"]>
    : {};

  return {
    enabled: readBoolean(memInput.enabled, defaults.enabled),
    embeddingProvider,
    embeddingModel: readEmbeddingModelId(memInput.embeddingModel, embeddingProvider),
    externalEmbedding: {
      baseUrl: readTrimmedString(externalInput.baseUrl, defaults.externalEmbedding.baseUrl),
      apiKey: readTrimmedString(externalInput.apiKey, defaults.externalEmbedding.apiKey),
      model: readTrimmedString(externalInput.model, defaults.externalEmbedding.model),
      dimensions: readNullablePositiveInteger(externalInput.dimensions, defaults.externalEmbedding.dimensions),
    },
    autoCaptureSprint: readBoolean(memInput.autoCaptureSprint, defaults.autoCaptureSprint),
    autoCaptureAgent: readBoolean(memInput.autoCaptureAgent, defaults.autoCaptureAgent),
    autoPromote: readBoolean(memInput.autoPromote, defaults.autoPromote),
    promotionThreshold: Math.min(1, Math.max(0, typeof memInput.promotionThreshold === "number"
      ? memInput.promotionThreshold
      : defaults.promotionThreshold)),
    remediationMode: readRemediationMode(memInput.remediationMode, defaults.remediationMode),
    remediationMaxPromotions: Math.max(1, Math.min(100, readInteger(memInput.remediationMaxPromotions, defaults.remediationMaxPromotions))),
    maxSprintMemories: Math.max(10, readInteger(memInput.maxSprintMemories, defaults.maxSprintMemories)),
    maxProjectMemories: Math.max(10, readInteger(memInput.maxProjectMemories, defaults.maxProjectMemories)),
    mapMaxEdgesPerNode: Math.max(1, Math.min(20, readInteger(memInput.mapMaxEdgesPerNode, defaults.mapMaxEdgesPerNode))),
    workerLearningsInstruction: typeof memInput.workerLearningsInstruction === "string"
      ? memInput.workerLearningsInstruction
      : defaults.workerLearningsInstruction,
  };
};
