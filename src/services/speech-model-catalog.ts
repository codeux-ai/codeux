import * as fs from "fs/promises";
import * as path from "path";
import { getHomeCodeUxPath } from "../shared/config/code-ux-paths.js";

export interface SpeechModelCatalogEntry {
  id: string;
  displayName: string;
  modelFile: string;
  labelsFile?: string;
  sampleRateHz: number;
}

export interface SpeechModelPaths {
  modelDir: string;
  modelPath: string;
  labelsPath: string | null;
}

export const SPEECH_MODEL_CATALOG: Record<string, SpeechModelCatalogEntry> = {
  "onnx-community/whisper-base.en": {
    id: "onnx-community/whisper-base.en",
    displayName: "Whisper Base English ONNX",
    modelFile: "model.onnx",
    labelsFile: "labels.json",
    sampleRateHz: 16000,
  },
  "onnx-community/whisper-tiny.en": {
    id: "onnx-community/whisper-tiny.en",
    displayName: "Whisper Tiny English ONNX",
    modelFile: "model.onnx",
    labelsFile: "labels.json",
    sampleRateHz: 16000,
  },
};

function sanitizeModelIdForPath(modelId: string): string {
  const trimmed = modelId.trim().toLowerCase();
  return trimmed.replace(/\//g, "--").replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "unknown-model";
}

export function resolveSpeechModelEntry(modelId: string): SpeechModelCatalogEntry {
  return SPEECH_MODEL_CATALOG[modelId] ?? {
    id: modelId,
    displayName: modelId,
    modelFile: "model.onnx",
    labelsFile: "labels.json",
    sampleRateHz: 16000,
  };
}

export function getSpeechModelCacheRoot(dataDir?: string): string {
  return dataDir || getHomeCodeUxPath("models", "speech");
}

export function getSpeechModelPaths(modelId: string, dataDir?: string): SpeechModelPaths {
  const entry = resolveSpeechModelEntry(modelId);
  const modelDir = path.join(getSpeechModelCacheRoot(dataDir), sanitizeModelIdForPath(entry.id));
  return {
    modelDir,
    modelPath: path.join(modelDir, entry.modelFile),
    labelsPath: entry.labelsFile ? path.join(modelDir, entry.labelsFile) : null,
  };
}

export async function isSpeechModelAvailable(modelId: string, dataDir?: string): Promise<boolean> {
  const paths = getSpeechModelPaths(modelId, dataDir);
  try {
    const stat = await fs.stat(paths.modelPath);
    return stat.isFile();
  } catch {
    return false;
  }
}
