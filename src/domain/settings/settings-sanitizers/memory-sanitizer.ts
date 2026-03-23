import type { DashboardSettings } from "../../../contracts/app-types.js";
import type { EmbeddingModelId, MemorySettings } from "../../../contracts/memory-types.js";
import { EMBEDDING_MODEL_IDS } from "../../../contracts/memory-types.js";
import { readBoolean, readInteger } from "../../../shared/config/value-readers.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../repositories/settings-defaults.js";

const readEmbeddingModelId = (value: unknown): EmbeddingModelId | null => {
  if (typeof value === "string" && EMBEDDING_MODEL_IDS.includes(value as EmbeddingModelId)) {
    return value as EmbeddingModelId;
  }
  return null;
};

export const sanitizeMemory = (
  input: Partial<DashboardSettings> | undefined,
): MemorySettings => {
  const memInput = (input?.memory && typeof input.memory === "object"
    ? input.memory
    : {}) as Partial<MemorySettings>;

  const defaults = DEFAULT_DASHBOARD_SETTINGS.memory;

  return {
    enabled: readBoolean(memInput.enabled, defaults.enabled),
    embeddingModel: readEmbeddingModelId(memInput.embeddingModel),
    autoCaptureSprint: readBoolean(memInput.autoCaptureSprint, defaults.autoCaptureSprint),
    autoCaptureAgent: readBoolean(memInput.autoCaptureAgent, defaults.autoCaptureAgent),
    autoPromote: readBoolean(memInput.autoPromote, defaults.autoPromote),
    promotionThreshold: Math.min(1, Math.max(0, typeof memInput.promotionThreshold === "number"
      ? memInput.promotionThreshold
      : defaults.promotionThreshold)),
    maxSprintMemories: Math.max(10, readInteger(memInput.maxSprintMemories, defaults.maxSprintMemories)),
    maxProjectMemories: Math.max(10, readInteger(memInput.maxProjectMemories, defaults.maxProjectMemories)),
    mapMaxEdgesPerNode: Math.max(1, Math.min(20, readInteger(memInput.mapMaxEdgesPerNode, defaults.mapMaxEdgesPerNode))),
    workerLearningsInstruction: typeof memInput.workerLearningsInstruction === "string"
      ? memInput.workerLearningsInstruction
      : defaults.workerLearningsInstruction,
  };
};
