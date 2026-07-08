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

export interface DecodedSpeechAudio {
  samples: Float32Array;
  sampleRate: number;
  channelCount: number;
  format: "pcm_s16le" | "pcm_s24le" | "pcm_s32le" | "pcm_u8" | "float32le";
}

interface WaveFormat {
  audioFormat: number;
  channelCount: number;
  sampleRate: number;
  byteRate: number;
  blockAlign: number;
  bitsPerSample: number;
  dataStart: number;
  dataByteLength: number;
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

function readWaveFormat(buffer: Buffer): WaveFormat | null {
  if (buffer.length < 44) {
    return null;
  }
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    return null;
  }

  let offset = 12;
  let audioFormat: number | null = null;
  let channelCount: number | null = null;
  let sampleRate: number | null = null;
  let byteRate: number | null = null;
  let blockAlign: number | null = null;
  let bitsPerSample: number | null = null;
  let dataStart: number | null = null;
  let dataByteLength: number | null = null;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkDataStart = offset + 8;
    if (chunkDataStart + chunkSize > buffer.length) {
      break;
    }

    if (chunkId === "fmt " && chunkSize >= 16) {
      audioFormat = buffer.readUInt16LE(chunkDataStart);
      channelCount = buffer.readUInt16LE(chunkDataStart + 2);
      sampleRate = buffer.readUInt32LE(chunkDataStart + 4);
      byteRate = buffer.readUInt32LE(chunkDataStart + 8);
      blockAlign = buffer.readUInt16LE(chunkDataStart + 12);
      bitsPerSample = buffer.readUInt16LE(chunkDataStart + 14);
    } else if (chunkId === "data") {
      dataStart = chunkDataStart;
      dataByteLength = chunkSize;
    }

    offset = chunkDataStart + chunkSize + (chunkSize % 2);
  }

  if (
    audioFormat === null
    || channelCount === null
    || sampleRate === null
    || byteRate === null
    || blockAlign === null
    || bitsPerSample === null
    || dataStart === null
    || dataByteLength === null
  ) {
    return null;
  }

  return {
    audioFormat,
    channelCount,
    sampleRate,
    byteRate,
    blockAlign,
    bitsPerSample,
    dataStart,
    dataByteLength,
  };
}

export function readWaveDurationSeconds(buffer: Buffer): number | null {
  const format = readWaveFormat(buffer);
  if (!format || !format.byteRate || !format.dataByteLength) {
    return null;
  }
  return format.dataByteLength / format.byteRate;
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

const readSigned24LE = (buffer: Buffer, offset: number): number => {
  const unsigned = buffer.readUIntLE(offset, 3);
  return unsigned & 0x800000 ? unsigned | 0xff000000 : unsigned;
};

const readNormalizedSample = (buffer: Buffer, offset: number, bitsPerSample: number, audioFormat: number): number => {
  if (audioFormat === 3 && bitsPerSample === 32) {
    return Math.max(-1, Math.min(1, buffer.readFloatLE(offset)));
  }

  switch (bitsPerSample) {
    case 8:
      return (buffer.readUInt8(offset) - 128) / 128;
    case 16:
      return buffer.readInt16LE(offset) / 32768;
    case 24:
      return readSigned24LE(buffer, offset) / 8388608;
    case 32:
      return buffer.readInt32LE(offset) / 2147483648;
    default:
      throw new Error(`Unsupported WAV bit depth: ${bitsPerSample}.`);
  }
};

const resolveWaveFormatLabel = (audioFormat: number, bitsPerSample: number): DecodedSpeechAudio["format"] => {
  if (audioFormat === 3 && bitsPerSample === 32) {
    return "float32le";
  }
  switch (bitsPerSample) {
    case 8:
      return "pcm_u8";
    case 16:
      return "pcm_s16le";
    case 24:
      return "pcm_s24le";
    case 32:
      return "pcm_s32le";
    default:
      throw new Error(`Unsupported WAV bit depth: ${bitsPerSample}.`);
  }
};

export function decodeWavePcmToFloat32(buffer: Buffer): DecodedSpeechAudio {
  const format = readWaveFormat(buffer);
  if (!format) {
    throw new Error("Local ONNX transcription requires a WAV audio payload.");
  }
  if (format.audioFormat !== 1 && format.audioFormat !== 3) {
    throw new Error("Local ONNX transcription requires PCM WAV audio.");
  }
  if (format.channelCount <= 0 || format.sampleRate <= 0 || format.blockAlign <= 0) {
    throw new Error("WAV audio metadata is invalid.");
  }
  if (format.audioFormat === 3 && format.bitsPerSample !== 32) {
    throw new Error("Only 32-bit float WAV audio is supported for floating-point payloads.");
  }

  const bytesPerSample = format.bitsPerSample / 8;
  if (!Number.isInteger(bytesPerSample) || bytesPerSample <= 0) {
    throw new Error(`Unsupported WAV bit depth: ${format.bitsPerSample}.`);
  }
  const expectedBlockAlign = bytesPerSample * format.channelCount;
  if (format.blockAlign < expectedBlockAlign) {
    throw new Error("WAV audio frame layout is invalid.");
  }

  const frameCount = Math.floor(format.dataByteLength / format.blockAlign);
  if (frameCount <= 0) {
    throw new Error("WAV audio contains no samples.");
  }

  const samples = new Float32Array(frameCount);
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const frameOffset = format.dataStart + frameIndex * format.blockAlign;
    let accumulator = 0;
    for (let channelIndex = 0; channelIndex < format.channelCount; channelIndex += 1) {
      accumulator += readNormalizedSample(
        buffer,
        frameOffset + channelIndex * bytesPerSample,
        format.bitsPerSample,
        format.audioFormat,
      );
    }
    samples[frameIndex] = accumulator / format.channelCount;
  }

  return {
    samples,
    sampleRate: format.sampleRate,
    channelCount: format.channelCount,
    format: resolveWaveFormatLabel(format.audioFormat, format.bitsPerSample),
  };
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
