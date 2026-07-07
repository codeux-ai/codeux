export const SPEECH_PROVIDER_MODES = ["auto", "local_onnx", "external_api"] as const;

export type SpeechProviderMode = typeof SPEECH_PROVIDER_MODES[number];
export type SpeechTranscriptionProvider = Exclude<SpeechProviderMode, "auto">;

export interface ExternalTranscriptionSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  language?: string | null;
}

export interface SpeechSettings {
  enabled: boolean;
  providerMode: SpeechProviderMode;
  localModelId: string;
  maxAudioSeconds: number;
  externalTranscription: ExternalTranscriptionSettings;
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
