import type { DownloadableModelLicense } from "./model-license-types.js";
import type { SettingsCredentialReference } from "./app-types.js";

export const SPEECH_PROVIDER_MODES = ["local_onnx", "external_api"] as const;
export const LOCAL_TRANSCRIPTION_MODEL_IDS = [
  "onnx-community/whisper-base.en",
  "onnx-community/whisper-tiny.en",
  "onnx-community/whisper-base",
  "onnx-community/whisper-tiny",
] as const;
export const DEFAULT_LOCAL_TRANSCRIPTION_MODEL_ID = LOCAL_TRANSCRIPTION_MODEL_IDS[0];

export type SpeechProviderMode = typeof SPEECH_PROVIDER_MODES[number];
export type SpeechTranscriptionProvider = SpeechProviderMode;

export interface ExternalTranscriptionSettings {
  baseUrl: string;
  apiKey: string;
  apiKeyCredentialRef?: SettingsCredentialReference | null;
  model: string;
  language?: string | null;
}

export interface ExternalSpeechSynthesisSettings {
  baseUrl: string;
  apiKey: string;
  apiKeyCredentialRef?: SettingsCredentialReference | null;
  model: string;
  voice: string;
  format: "mp3" | "wav" | "opus" | "aac" | "flac";
}

export interface SpeechSynthesisSettings {
  enabled: boolean;
  providerMode: SpeechProviderMode;
  localModelId: string;
  voice: string;
  speed: number;
  externalSynthesis: ExternalSpeechSynthesisSettings;
}

export interface SpeechSettings {
  enabled: boolean;
  providerMode: SpeechProviderMode;
  localModelId: string;
  /** Language hint used only by the local transcription runtime. Null enables model detection. */
  localLanguage?: string | null;
  maxAudioSeconds: number;
  externalTranscription: ExternalTranscriptionSettings;
  synthesis: SpeechSynthesisSettings;
}

export type SpeechModelKind = "transcription" | "synthesis";
export type SpeechModelAdapter = "whisper" | "kokoro" | "piper";

export interface SpeechModelFile {
  sourcePath: string;
  localName: string;
  downloadUrl?: string;
  sha256?: string;
}

export interface SpeechModelVoice {
  id: string;
  label: string;
  language: string;
  /** BCP-47 language tag used to match a voice to the user's speech language. */
  languageCode?: string;
  /** Piper speaker index for multi-speaker ONNX checkpoints. */
  speakerId?: number;
}

export interface SpeechModelLanguage {
  /** Whisper/API language code or a BCP-47 language tag for synthesis voices. */
  code: string;
  label: string;
}

export interface SpeechModelCatalogItem {
  id: string;
  kind: SpeechModelKind;
  adapter: SpeechModelAdapter;
  displayName: string;
  description: string;
  repository: string;
  sourceUrl: string;
  license: DownloadableModelLicense;
  files: SpeechModelFile[];
  sizeBytes: number;
  language: string;
  languages: SpeechModelLanguage[];
  supportsAutomaticLanguageDetection: boolean;
  sampleRateHz: number;
  voices: SpeechModelVoice[];
  defaultVoice: string | null;
  /** Language tags for which this is the catalog's preferred local model. */
  recommendedForLanguages?: string[];
}

export interface SpeechModelStatus extends SpeechModelCatalogItem {
  downloaded: boolean;
  downloading: boolean;
  downloadProgress: number;
  error: string | null;
}

export type SpeechTranscriptionErrorCode =
  | "unsupported_audio"
  | "missing_local_model"
  | "missing_model"
  | "permission_denied"
  | "client_error"
  | "provider_failure";

export interface SpeechTranscriptionRequestMetadata {
  requestId?: string;
  projectId?: string | null;
  sprintId?: string | null;
  source: "dashboard" | "electron" | "mcp" | "api";
  mimeType: string;
  audioBytes: number;
  durationSeconds?: number | null;
  language?: string | null;
  createdAt?: string;
}

export interface SpeechTranscriptionError {
  code: SpeechTranscriptionErrorCode;
  message: string;
  provider?: SpeechTranscriptionProvider;
  retryable: boolean;
}

export interface SpeechTranscriptionFallbackMetadata {
  attemptedProvider: SpeechTranscriptionProvider;
  reason: SpeechTranscriptionErrorCode;
  message: string;
}

export type SpeechTranscriptionResult =
  | {
      ok: true;
      text: string;
      provider: SpeechTranscriptionProvider;
      model: string;
      language: string | null;
      durationSeconds: number | null;
      fallback?: SpeechTranscriptionFallbackMetadata | null;
    }
  | {
      ok: false;
      error: SpeechTranscriptionError;
    };

export interface SpeechSynthesisInput {
  text: string;
  projectId?: string | null;
  sprintId?: string | null;
  voice?: string | null;
}

export type SpeechSynthesisResult =
  | {
      ok: true;
      audio: Buffer;
      contentType: string;
      provider: SpeechTranscriptionProvider;
      model: string;
      voice: string;
    }
  | {
      ok: false;
      error: SpeechTranscriptionError;
    };
