import * as fs from "fs/promises";
import * as path from "path";
import type { SpeechModelCatalogItem, SpeechModelFile } from "../contracts/speech-types.js";
import { getHomeCodeUxPath } from "../shared/config/code-ux-paths.js";
import { assertCatalogLicenseApproved } from "./model-license-policy.js";

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
  phonemizerPath: string | null;
}

const hf = (repository: string): string => `https://huggingface.co/${repository}`;
const file = (sourcePath: string, localName = sourcePath, options: Pick<SpeechModelFile, "downloadUrl" | "sha256"> = {}): SpeechModelFile => ({ sourcePath, localName, ...options });
const mit = (id: string, url: string, notice: string) => ({ id, name: "MIT", url, commercialUseAllowed: true, notice });
const apache = (id: string, url: string, notice: string) => ({ id, name: "Apache-2.0", url, commercialUseAllowed: true, notice });
const PHONEMIZER_FILES: SpeechModelFile[] = [
  file("runtime/phonemizer.cjs", "runtime/phonemizer.cjs", {
    downloadUrl: "https://cdn.jsdelivr.net/npm/phonemizer@1.2.1/dist/phonemizer.cjs",
    sha256: "24d24f118e44dc60af797881617415be24d84de53c1fc1a8f7f9974ab52531cc",
  }),
  file("licenses/phonemizer-Apache-2.0.txt", "licenses/phonemizer-Apache-2.0.txt", {
    downloadUrl: "https://cdn.jsdelivr.net/npm/phonemizer@1.2.1/LICENSE",
    sha256: "c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4",
  }),
];

export const SPEECH_MODEL_CATALOG: Record<string, SpeechModelCatalogEntry> = {
  "onnx-community/whisper-base.en": {
    id: "onnx-community/whisper-base.en",
    kind: "transcription",
    adapter: "whisper",
    displayName: "Whisper Base English ONNX",
    description: "Downloadable English Whisper bundle. Local encoder-decoder generation is not available yet; use API mode for Whisper transcription.",
    repository: "onnx-community/whisper-base.en",
    sourceUrl: hf("onnx-community/whisper-base.en"),
    license: mit("openai-whisper-mit-v1", "https://github.com/openai/whisper/blob/main/LICENSE", "MIT-licensed Whisper weights converted to ONNX."),
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
    description: "Compact downloadable Whisper bundle. Local encoder-decoder generation is not available yet; use API mode for Whisper transcription.",
    repository: "onnx-community/whisper-tiny.en",
    sourceUrl: hf("onnx-community/whisper-tiny.en"),
    license: mit("openai-whisper-mit-v1", "https://github.com/openai/whisper/blob/main/LICENSE", "MIT-licensed Whisper weights converted to ONNX."),
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
    license: mit("fairseq-wav2vec2-mit-v1", "https://github.com/facebookresearch/fairseq/blob/main/LICENSE", "MIT-licensed wav2vec 2.0 model converted to ONNX."),
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
    description: "Natural multi-voice synthesis with an 8-bit ONNX checkpoint and five lightweight English voices (~0.5 MB each).",
    repository: "onnx-community/Kokoro-82M-v1.0-ONNX",
    sourceUrl: hf("onnx-community/Kokoro-82M-v1.0-ONNX"),
    license: apache("kokoro-apache-2.0-phonemizer-1.2.1", "https://huggingface.co/hexgrad/Kokoro-82M/blob/main/README.md", "Apache-2.0 Kokoro weights and voices. The separately executed phonemizer package is Apache-2.0 and contains the open-source eSpeak NG engine."),
    files: [
      file("onnx/model_quantized.onnx", "model.onnx"),
      file("tokenizer.json"),
      file("voices/af_heart.bin"),
      file("voices/af_bella.bin"),
      file("voices/af_sky.bin"),
      file("voices/am_michael.bin"),
      file("voices/bf_emma.bin"),
      ...PHONEMIZER_FILES,
    ],
    modelFile: "model.onnx",
    labelsFile: "tokenizer.json",
    sizeBytes: 98_000_000,
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
  "piper-en-us-ljspeech-medium": {
    id: "piper-en-us-ljspeech-medium",
    kind: "synthesis",
    adapter: "piper",
    displayName: "Piper LJSpeech Medium",
    description: "Fast American English voice trained from scratch with public-domain LJSpeech data.",
    repository: "rhasspy/piper-voices",
    sourceUrl: `${hf("rhasspy/piper-voices")}/tree/main/en/en_US/ljspeech/medium`,
    license: mit("piper-ljspeech-mit-public-domain-v1", `${hf("rhasspy/piper-voices")}/blob/main/en/en_US/ljspeech/medium/MODEL_CARD`, "MIT-licensed Piper voice repository; LJSpeech training data is public domain and the voice was trained from scratch."),
    files: [
      file("en/en_US/ljspeech/medium/en_US-ljspeech-medium.onnx", "model.onnx"),
      file("en/en_US/ljspeech/medium/en_US-ljspeech-medium.onnx.json", "config.json"),
      file("en/en_US/ljspeech/medium/MODEL_CARD", "licenses/MODEL_CARD.txt"),
      ...PHONEMIZER_FILES,
    ],
    modelFile: "model.onnx",
    configFile: "config.json",
    sizeBytes: 64_900_000,
    language: "English (US)",
    sampleRateHz: 22050,
    voices: [{ id: "ljspeech", label: "LJSpeech", language: "English (US)" }],
    defaultVoice: "ljspeech",
  },
  "piper-en-gb-cori-medium": {
    id: "piper-en-gb-cori-medium",
    kind: "synthesis",
    adapter: "piper",
    displayName: "Piper Cori Medium",
    description: "Efficient British English voice trained from scratch with public-domain LibriVox data.",
    repository: "rhasspy/piper-voices",
    sourceUrl: `${hf("rhasspy/piper-voices")}/tree/main/en/en_GB/cori/medium`,
    license: mit("piper-cori-mit-public-domain-v1", `${hf("rhasspy/piper-voices")}/blob/main/en/en_GB/cori/medium/MODEL_CARD`, "MIT-licensed Piper voice repository; LibriVox training data is public domain and the voice was trained from scratch."),
    files: [
      file("en/en_GB/cori/medium/en_GB-cori-medium.onnx", "model.onnx"),
      file("en/en_GB/cori/medium/en_GB-cori-medium.onnx.json", "config.json"),
      file("en/en_GB/cori/medium/MODEL_CARD", "licenses/MODEL_CARD.txt"),
      ...PHONEMIZER_FILES,
    ],
    modelFile: "model.onnx",
    configFile: "config.json",
    sizeBytes: 64_900_000,
    language: "English (UK)",
    sampleRateHz: 22050,
    voices: [{ id: "cori", label: "Cori", language: "English (UK)" }],
    defaultVoice: "cori",
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
    license: { id: "unverified", name: "Unverified", url: "https://huggingface.co/", commercialUseAllowed: false, notice: "Custom model terms have not been verified." },
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
    phonemizerPath: entry.files.some((item) => item.localName === "runtime/phonemizer.cjs") ? path.join(modelDir, "runtime/phonemizer.cjs") : null,
  };
}

for (const model of Object.values(SPEECH_MODEL_CATALOG)) {
  assertCatalogLicenseApproved(model.license, model.id);
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
