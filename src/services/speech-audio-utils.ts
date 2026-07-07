import type { SpeechTranscriptionErrorCode, SpeechTranscriptionRequestMetadata } from "../contracts/speech-types.js";

export const MAX_SPEECH_AUDIO_BYTES = 25 * 1024 * 1024;

const SUPPORTED_AUDIO_MIME_TYPES = new Set([
  "audio/aac",
  "audio/flac",
  "audio/m4a",
  "audio/mp3",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
  "audio/x-m4a",
  "audio/x-wav",
  "video/mp4",
  "video/webm",
]);

export interface SpeechAudioValidationInput {
  audioBytes: number;
  mimeType: string;
  durationSeconds?: number | null;
  maxAudioSeconds: number;
}

export interface SpeechAudioValidationError {
  code: SpeechTranscriptionErrorCode;
  message: string;
}

export function normalizeAudioMimeType(value: string | undefined | null): string {
  return (value || "").split(";")[0]?.trim().toLowerCase() || "";
}

export function isSupportedSpeechAudioMimeType(value: string | undefined | null): boolean {
  return SUPPORTED_AUDIO_MIME_TYPES.has(normalizeAudioMimeType(value));
}

export function parseOptionalDurationSeconds(value: unknown): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function readWaveDurationSeconds(buffer: Buffer): number | null {
  if (buffer.length < 44) {
    return null;
  }
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    return null;
  }

  let offset = 12;
  let byteRate: number | null = null;
  let dataBytes: number | null = null;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkDataStart = offset + 8;
    if (chunkDataStart + chunkSize > buffer.length) {
      break;
    }
    if (chunkId === "fmt " && chunkSize >= 16) {
      byteRate = buffer.readUInt32LE(chunkDataStart + 8);
    } else if (chunkId === "data") {
      dataBytes = chunkSize;
    }
    offset = chunkDataStart + chunkSize + (chunkSize % 2);
  }

  if (!byteRate || !dataBytes) {
    return null;
  }
  return dataBytes / byteRate;
}

export function resolveKnownAudioDurationSeconds(args: {
  buffer: Buffer;
  mimeType: string;
  metadataDurationSeconds?: number | null;
}): number | null {
  if (args.metadataDurationSeconds !== undefined && args.metadataDurationSeconds !== null) {
    return args.metadataDurationSeconds;
  }
  const mimeType = normalizeAudioMimeType(args.mimeType);
  if (mimeType === "audio/wav" || mimeType === "audio/x-wav") {
    return readWaveDurationSeconds(args.buffer);
  }
  return null;
}

export function validateSpeechAudio(input: SpeechAudioValidationInput): SpeechAudioValidationError | null {
  if (input.audioBytes <= 0) {
    return { code: "unsupported_audio", message: "Audio upload is empty." };
  }
  if (input.audioBytes > MAX_SPEECH_AUDIO_BYTES) {
    return {
      code: "unsupported_audio",
      message: `Audio upload exceeds the ${Math.floor(MAX_SPEECH_AUDIO_BYTES / 1024 / 1024)}MB limit.`,
    };
  }
  if (!isSupportedSpeechAudioMimeType(input.mimeType)) {
    return { code: "unsupported_audio", message: "Unsupported audio type." };
  }
  if (
    input.durationSeconds !== undefined
    && input.durationSeconds !== null
    && input.durationSeconds > input.maxAudioSeconds
  ) {
    return {
      code: "client_error",
      message: `Audio duration exceeds the configured ${input.maxAudioSeconds}s limit.`,
    };
  }
  return null;
}

export function buildSpeechRequestMetadata(args: {
  body: Record<string, unknown>;
  mimeType: string;
  audioBytes: number;
  durationSeconds: number | null;
}): SpeechTranscriptionRequestMetadata {
  const optionalString = (value: unknown): string | null => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  };
  const source = optionalString(args.body.source);
  return {
    requestId: optionalString(args.body.requestId) || undefined,
    projectId: optionalString(args.body.projectId),
    sprintId: optionalString(args.body.sprintId),
    source: source === "electron" || source === "mcp" || source === "api" ? source : "dashboard",
    mimeType: normalizeAudioMimeType(args.mimeType),
    audioBytes: args.audioBytes,
    durationSeconds: args.durationSeconds,
    language: optionalString(args.body.language),
    createdAt: new Date().toISOString(),
  };
}
