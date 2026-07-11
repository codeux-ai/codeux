import * as fs from "fs/promises";
import * as path from "path";
import type { SpeechModelCatalogItem } from "../contracts/speech-types.js";
import { getHomeCodeUxPath } from "../shared/config/code-ux-paths.js";

export interface SpeechModelCatalogEntry extends SpeechModelCatalogItem {
  modelFile: string;
  labelsFile?: string;
  configFile?: string;
}

export interface SpeechModelPaths {
  modelDir: string;
  modelPath: string;
  labelsPath: string | null;
  configPath: string | null;
}

const hf = (repository: string): string => `https://huggingface.co/${repository}`;
const file = (sourcePath: string, localName = sourcePath): { sourcePath: string; localName: string } => ({ sourcePath, localName });

export const SPEECH_MODEL_CATALOG: Record<string, SpeechModelCatalogEntry> = {
  "onnx-community/whisper-base.en": {
    id: "onnx-community/whisper-base.en",
    kind: "transcription",
    adapter: "whisper",
    displayName: "Whisper Base English ONNX",
    description: "Balanced English speech recognition bundle with quantized encoder and merged decoder weights.",
    repository: "onnx-community/whisper-base.en",
    sourceUrl: hf("onnx-community/whisper-base.en"),
    files: [
      file("onnx/encoder_model_int8.onnx", "encoder_model.onnx"),
      file("onnx/decoder_model_merged_int8.onnx", "decoder_model_merged.onnx"),
      file("tokenizer.json"),
      file("preprocessor_config.json"),
      file("generation_config.json"),
    ],
    modelFile: "encoder_model.onnx",
    labelsFile: "tokenizer.json",
    sizeBytes: 320_000_000,
    language: "English",
    sampleRateHz: 16000,
    voices: [],
    defaultVoice: null,
  },
  "onnx-community/whisper-tiny.en": {
    id: "onnx-community/whisper-tiny.en",
    kind: "transcription",
    adapter: "whisper",
    displayName: "Whisper Tiny English ONNX",
    description: "Compact English Whisper bundle for lower-resource systems and fast microphone transcription.",
    repository: "onnx-community/whisper-tiny.en",
    sourceUrl: hf("onnx-community/whisper-tiny.en"),
    files: [
      file("onnx/encoder_model_int8.onnx", "encoder_model.onnx"),
      file("onnx/decoder_model_merged_int8.onnx", "decoder_model_merged.onnx"),
      file("tokenizer.json"),
      file("preprocessor_config.json"),
      file("generation_config.json"),
    ],
    modelFile: "encoder_model.onnx",
    labelsFile: "tokenizer.json",
    sizeBytes: 180_000_000,
    language: "English",
    sampleRateHz: 16000,
    voices: [],
    defaultVoice: null,
  },
  "Xenova/wav2vec2-base-960h": {
    id: "Xenova/wav2vec2-base-960h",
    kind: "transcription",
    adapter: "waveform_ctc",
    displayName: "Wav2Vec2 Base English ONNX",
    description: "Single-session English CTC transcription model for direct CPU waveform inference.",
    repository: "Xenova/wav2vec2-base-960h",
    sourceUrl: hf("Xenova/wav2vec2-base-960h"),
    files: [
      file("onnx/model_quantized.onnx", "model.onnx"),
      file("tokenizer.json"),
    ],
    modelFile: "model.onnx",
    labelsFile: "tokenizer.json",
    sizeBytes: 95_500_000,
    language: "English",
    sampleRateHz: 16000,
    voices: [],
    defaultVoice: null,
  },
  "kokoro-82m-v1.0-q8": {
    id: "kokoro-82m-v1.0-q8",
    kind: "synthesis",
    adapter: "kokoro",
    displayName: "Kokoro 82M v1.0 Q8",
    description: "Natural, lightweight multi-voice synthesis with an 8-bit ONNX checkpoint and five bundled English voices.",
    repository: "onnx-community/Kokoro-82M-v1.0-ONNX",
    sourceUrl: hf("onnx-community/Kokoro-82M-v1.0-ONNX"),
    files: [
      file("onnx/model_quantized.onnx", "model.onnx"),
      file("tokenizer.json"),
      file("voices/af_heart.bin"),
      file("voices/af_bella.bin"),
      file("voices/af_sky.bin"),
      file("voices/am_michael.bin"),
      file("voices/bf_emma.bin"),
    ],
    modelFile: "model.onnx",
    labelsFile: "tokenizer.json",
    sizeBytes: 95_000_000,
    language: "English",
    sampleRateHz: 24000,
    voices: [
      { id: "af_heart", label: "Heart", language: "English (US)" },
      { id: "af_bella", label: "Bella", language: "English (US)" },
      { id: "af_sky", label: "Sky", language: "English (US)" },
      { id: "am_michael", label: "Michael", language: "English (US)" },
      { id: "bf_emma", label: "Emma", language: "English (UK)" },
    ],
    defaultVoice: "af_heart",
  },
  "piper-en-us-lessac-medium": {
    id: "piper-en-us-lessac-medium",
    kind: "synthesis",
    adapter: "piper",
    displayName: "Piper Lessac Medium",
    description: "Fast, low-power American English voice optimized for CPU and embedded use.",
    repository: "rhasspy/piper-voices",
    sourceUrl: `${hf("rhasspy/piper-voices")}/tree/main/en/en_US/lessac/medium`,
    files: [
      file("en/en_US/lessac/medium/en_US-lessac-medium.onnx", "model.onnx"),
      file("en/en_US/lessac/medium/en_US-lessac-medium.onnx.json", "config.json"),
    ],
    modelFile: "model.onnx",
    configFile: "config.json",
    sizeBytes: 63_300_000,
    language: "English (US)",
    sampleRateHz: 22050,
    voices: [{ id: "lessac", label: "Lessac", language: "English (US)" }],
    defaultVoice: "lessac",
  },
  "piper-en-gb-alba-medium": {
    id: "piper-en-gb-alba-medium",
    kind: "synthesis",
    adapter: "piper",
    displayName: "Piper Alba Medium",
    description: "Efficient British English voice for local CPU synthesis.",
    repository: "rhasspy/piper-voices",
    sourceUrl: `${hf("rhasspy/piper-voices")}/tree/main/en/en_GB/alba/medium`,
    files: [
      file("en/en_GB/alba/medium/en_GB-alba-medium.onnx", "model.onnx"),
      file("en/en_GB/alba/medium/en_GB-alba-medium.onnx.json", "config.json"),
    ],
    modelFile: "model.onnx",
    configFile: "config.json",
    sizeBytes: 63_300_000,
    language: "English (UK)",
    sampleRateHz: 22050,
    voices: [{ id: "alba", label: "Alba", language: "English (UK)" }],
    defaultVoice: "alba",
  },
};

export function sanitizeModelIdForPath(modelId: string): string {
  const trimmed = modelId.trim().toLowerCase();
  return trimmed.replace(/\//g, "--").replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "unknown-model";
}

export function resolveSpeechModelEntry(modelId: string): SpeechModelCatalogEntry {
  return SPEECH_MODEL_CATALOG[modelId] ?? {
    id: modelId,
    kind: "transcription",
    adapter: "waveform_ctc",
    displayName: modelId,
    description: "Custom local ONNX speech model.",
    repository: modelId,
    sourceUrl: modelId.includes("/") ? hf(modelId) : "",
    files: [file("model.onnx")],
    modelFile: "model.onnx",
    labelsFile: "labels.json",
    sizeBytes: 0,
    language: "Unknown",
    sampleRateHz: 16000,
    voices: [],
    defaultVoice: null,
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
    configPath: entry.configFile ? path.join(modelDir, entry.configFile) : null,
  };
}

export async function isSpeechModelAvailable(modelId: string, dataDir?: string): Promise<boolean> {
  const entry = resolveSpeechModelEntry(modelId);
  const { modelDir } = getSpeechModelPaths(modelId, dataDir);
  try {
    const files = await Promise.all(entry.files.map((item) => fs.stat(path.join(modelDir, item.localName))));
    return files.every((stat) => stat.isFile());
  } catch {
    return false;
  }
}
