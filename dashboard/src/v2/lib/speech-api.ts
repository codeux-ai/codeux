import type {
  SpeechTranscriptionError,
  SpeechTranscriptionErrorCode,
  SpeechTranscriptionProvider,
  SpeechTranscriptionResult,
  SpeechModelStatus,
} from "../types.js";

export interface TranscribeSpeechAudioInput {
  audio: Blob;
  filename?: string;
  durationSeconds?: number | null;
  language?: string | null;
  projectId?: string | null;
  sprintId?: string | null;
  signal?: AbortSignal;
}

export type TranscribeSpeechAudioResult = SpeechTranscriptionResult;

const DEFAULT_AUDIO_FILENAME = "speech-input.wav";
const SPEECH_TRANSCRIPTION_ERROR_CODES = new Set<SpeechTranscriptionErrorCode>([
  "unsupported_audio",
  "missing_local_model",
  "missing_model",
  "permission_denied",
  "client_error",
  "provider_failure",
]);
const SPEECH_TRANSCRIPTION_PROVIDERS = new Set<SpeechTranscriptionProvider>([
  "local_onnx",
  "external_api",
]);

const createClientError = (message: string, retryable = false): SpeechTranscriptionError => ({
  code: "client_error",
  message,
  retryable,
});

const readErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Speech transcription failed.";
};

const isAbortError = (error: unknown): boolean => {
  return error instanceof DOMException && error.name === "AbortError";
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === "object" && value !== null
);

const isSpeechTranscriptionErrorCode = (value: unknown): value is SpeechTranscriptionErrorCode => (
  typeof value === "string" && SPEECH_TRANSCRIPTION_ERROR_CODES.has(value as SpeechTranscriptionErrorCode)
);

const isSpeechTranscriptionProvider = (value: unknown): value is SpeechTranscriptionProvider => (
  typeof value === "string" && SPEECH_TRANSCRIPTION_PROVIDERS.has(value as SpeechTranscriptionProvider)
);

const isNullableString = (value: unknown): value is string | null => (
  value === null || typeof value === "string"
);

const isNullableNumber = (value: unknown): value is number | null => (
  value === null || typeof value === "number"
);

const isSpeechTranscriptionResult = (value: unknown): value is SpeechTranscriptionResult => {
  if (!isRecord(value)) return false;
  if (value.ok === true) {
    return (
      typeof value.text === "string"
      && isSpeechTranscriptionProvider(value.provider)
      && typeof value.model === "string"
      && isNullableString(value.language)
      && isNullableNumber(value.durationSeconds)
    );
  }
  if (value.ok !== false || !isRecord(value.error)) return false;
  return (
    isSpeechTranscriptionErrorCode(value.error.code)
    && typeof value.error.message === "string"
    && typeof value.error.retryable === "boolean"
    && (value.error.provider === undefined || isSpeechTranscriptionProvider(value.error.provider))
  );
};

const readSpeechTranscriptionResult = async (response: Response): Promise<SpeechTranscriptionResult> => {
  const body = await response.json().catch(() => null);
  if (isSpeechTranscriptionResult(body)) {
    return body;
  }
  return {
    ok: false,
    error: createClientError(
      response.ok ? "Speech transcription returned an invalid response." : "Speech transcription failed.",
      response.status >= 500,
    ),
  };
};

const setOptionalFormString = (formData: FormData, key: string, value: string | null | undefined): void => {
  const trimmed = value?.trim();
  if (trimmed) {
    formData.set(key, trimmed);
  }
};

export const transcribeSpeechAudio = async (
  input: TranscribeSpeechAudioInput,
): Promise<TranscribeSpeechAudioResult> => {
  const formData = new FormData();
  const filename = input.filename ?? DEFAULT_AUDIO_FILENAME;
  formData.append("audio", input.audio, filename);
  formData.set("source", "dashboard");
  formData.set("mimeType", input.audio.type || "application/octet-stream");
  formData.set("audioBytes", String(input.audio.size));

  if (input.durationSeconds !== undefined && input.durationSeconds !== null) {
    formData.set("durationSeconds", String(input.durationSeconds));
  }
  if (input.language) {
    formData.set("language", input.language);
  }
  setOptionalFormString(formData, "projectId", input.projectId);
  setOptionalFormString(formData, "sprintId", input.sprintId);

  try {
    const response = await fetch("/api/speech/transcriptions", {
      method: "POST",
      body: formData,
      signal: input.signal,
      cache: "no-store",
    });
    return await readSpeechTranscriptionResult(response);
  } catch (error) {
    return {
      ok: false,
      error: isAbortError(error)
        ? createClientError("Speech transcription was cancelled.")
        : createClientError(readErrorMessage(error), true),
    };
  }
};

export async function listSpeechModels(): Promise<SpeechModelStatus[]> {
  const response = await fetch("/api/speech/models", { cache: "no-store" });
  if (!response.ok) throw new Error("Speech model catalog could not be loaded.");
  return await response.json() as SpeechModelStatus[];
}

export async function downloadSpeechModel(modelId: string, acceptedLicenseId: string): Promise<void> {
  const response = await fetch(`/api/speech/models/${encodeURIComponent(modelId)}/download`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ acceptedLicenseId }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error || "Speech model download could not be started.");
  }
}

export async function deleteSpeechModel(modelId: string): Promise<void> {
  const response = await fetch(`/api/speech/models/${encodeURIComponent(modelId)}`, { method: "DELETE" });
  if (!response.ok) throw new Error("Speech model could not be deleted.");
}

export async function synthesizeSpeech(
  text: string,
  projectId?: string | null,
  voice?: string | null,
  signal?: AbortSignal,
): Promise<Blob> {
  const response = await fetch("/api/speech/synthesis", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, projectId, voice }),
    signal,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: { message?: string } | string };
    const message = typeof body.error === "string" ? body.error : body.error?.message;
    throw new Error(message || "Speech synthesis failed.");
  }
  return await response.blob();
}
