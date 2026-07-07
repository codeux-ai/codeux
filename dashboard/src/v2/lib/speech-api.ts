import type { SpeechTranscriptionError, SpeechTranscriptionResult } from "../types.js";
import { fetchJson } from "../../lib/api/fetch-json.js";

export interface TranscribeSpeechAudioInput {
  audio: Blob;
  filename?: string;
  durationSeconds?: number | null;
  language?: string | null;
  signal?: AbortSignal;
}

export type TranscribeSpeechAudioResult = SpeechTranscriptionResult;

const DEFAULT_AUDIO_FILENAME = "speech-input.wav";

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

  try {
    return await fetchJson<SpeechTranscriptionResult>("/api/speech/transcriptions", {
      method: "POST",
      body: formData,
      signal: input.signal,
    });
  } catch (error) {
    return {
      ok: false,
      error: isAbortError(error)
        ? createClientError("Speech transcription was cancelled.")
        : createClientError(readErrorMessage(error), true),
    };
  }
};
