import { describe, expect, it, vi } from "vitest";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-defaults.js";
import type { SpeechSettings } from "../../../src/contracts/speech-types.js";
import {
  SpeechTranscriptionService,
  type LocalOnnxSpeechRuntime,
} from "../../../src/services/speech-transcription-service.js";

const audio = Buffer.from("audio-bytes");

function createPcm16Wav(samples: Int16Array, sampleRate = 16_000): Buffer {
  const bytesPerSample = 2;
  const channelCount = 1;
  const dataByteLength = samples.length * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataByteLength);

  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataByteLength, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channelCount, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channelCount * bytesPerSample, 28);
  buffer.writeUInt16LE(channelCount * bytesPerSample, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataByteLength, 40);
  for (let index = 0; index < samples.length; index += 1) {
    buffer.writeInt16LE(samples[index] ?? 0, 44 + index * bytesPerSample);
  }

  return buffer;
}

function speechSettings(overrides: Partial<SpeechSettings> = {}): SpeechSettings {
  return {
    ...DEFAULT_DASHBOARD_SETTINGS.speech,
    enabled: true,
    ...overrides,
    externalTranscription: {
      ...DEFAULT_DASHBOARD_SETTINGS.speech.externalTranscription,
      ...overrides.externalTranscription,
    },
  };
}

function createMetadata(overrides: Record<string, unknown> = {}) {
  return {
    source: "dashboard" as const,
    mimeType: "audio/webm",
    audioBytes: audio.length,
    projectId: "project-1",
    sprintId: null,
    durationSeconds: 1,
    ...overrides,
  };
}

function createLocalRuntime(overrides: Partial<LocalOnnxSpeechRuntime> = {}): LocalOnnxSpeechRuntime {
  return {
    isModelAvailable: vi.fn().mockResolvedValue(false),
    transcribe: vi.fn().mockResolvedValue({
      text: "local transcript",
      language: "en",
      durationSeconds: 1,
    }),
    ...overrides,
  };
}

describe("SpeechTranscriptionService", () => {
  it("returns missing_local_model for explicit local mode when the model is absent", async () => {
    const fetchImpl = vi.fn();
    const service = new SpeechTranscriptionService({
      resolveSpeechSettings: () => speechSettings({ providerMode: "local_onnx" }),
      localRuntime: createLocalRuntime(),
      fetchImpl,
    });

    const result = await service.transcribe({ audio, metadata: createMetadata() });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "missing_local_model",
        message: 'Local speech model "Xenova/wav2vec2-base-960h" is not installed.',
        provider: "local_onnx",
        retryable: false,
      },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uses local ONNX when the selected local model is available", async () => {
    const wavAudio = createPcm16Wav(new Int16Array([0, 16_384, -32_768]));
    const localRuntime = createLocalRuntime({
      isModelAvailable: vi.fn().mockResolvedValue(true),
      transcribe: vi.fn().mockResolvedValue({
        text: "local transcript",
        language: "en",
        durationSeconds: 1,
      }),
    });
    const service = new SpeechTranscriptionService({
      resolveSpeechSettings: () => speechSettings({ providerMode: "local_onnx" }),
      localRuntime,
    });

    const result = await service.transcribe({
      audio: wavAudio,
      metadata: createMetadata({
        audioBytes: wavAudio.length,
        mimeType: "audio/wav",
        language: "en",
      }),
    });

    expect(result).toEqual({
      ok: true,
      text: "local transcript",
      provider: "local_onnx",
      model: "Xenova/wav2vec2-base-960h",
      language: "en",
      durationSeconds: 1,
      fallback: null,
    });
    expect(localRuntime.transcribe).toHaveBeenCalledWith(expect.objectContaining({
      model: expect.objectContaining({ id: "Xenova/wav2vec2-base-960h" }),
      audio: expect.any(Float32Array),
      sampleRate: 16_000,
      language: "en",
    }));
    const decodedAudio = vi.mocked(localRuntime.transcribe).mock.calls[0]?.[0].audio;
    expect(decodedAudio).toBeInstanceOf(Float32Array);
    expect(decodedAudio?.length).toBe(3);
    expect(decodedAudio?.[0]).toBeCloseTo(0);
    expect(decodedAudio?.[1]).toBeCloseTo(0.5);
    expect(decodedAudio?.[2]).toBeCloseTo(-1);
  });

  it("uses the external API only when API mode is selected", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      text: "external transcript",
      language: "en",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const service = new SpeechTranscriptionService({
      resolveSpeechSettings: () => speechSettings({
        providerMode: "external_api",
        externalTranscription: {
          baseUrl: "https://transcribe.example.test/v1/audio/transcriptions",
          apiKey: "sk-test-secret-1234567890123456",
          model: "whisper-1",
          language: "en",
        },
      }),
      localRuntime: createLocalRuntime(),
      fetchImpl,
    });

    const result = await service.transcribe({ audio, fileName: "prompt.webm", metadata: createMetadata() });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://transcribe.example.test/v1/audio/transcriptions",
      expect.objectContaining({
        method: "POST",
        headers: { Authorization: "Bearer sk-test-secret-1234567890123456" },
        body: expect.any(FormData),
      }),
    );
    expect(result).toEqual({
      ok: true,
      text: "external transcript",
      provider: "external_api",
      model: "whisper-1",
      language: "en",
      durationSeconds: 1,
      fallback: null,
    });
  });

  it("does not send audio externally while local mode is selected", async () => {
    const fetchImpl = vi.fn();
    const service = new SpeechTranscriptionService({
      resolveSpeechSettings: () => speechSettings({
        providerMode: "local_onnx",
        externalTranscription: {
          baseUrl: "https://transcribe.example.test/v1/audio/transcriptions",
          apiKey: "configured-but-unused",
          model: "whisper-1",
          language: null,
        },
      }),
      localRuntime: createLocalRuntime(),
      fetchImpl,
    });

    const result = await service.transcribe({ audio, metadata: createMetadata() });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("missing_local_model");
      expect(result.error.message).toContain("Xenova/wav2vec2-base-960h");
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns sanitized provider errors from external transcription APIs", async () => {
    const rawApiKey = "sk-test-secret-1234567890123456";
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { message: `bad key ${rawApiKey}` },
    }), { status: 401, headers: { "content-type": "application/json" } }));
    const service = new SpeechTranscriptionService({
      resolveSpeechSettings: () => speechSettings({
        providerMode: "external_api",
        externalTranscription: {
          baseUrl: "https://transcribe.example.test/v1",
          apiKey: rawApiKey,
          model: "whisper-1",
          language: null,
        },
      }),
      localRuntime: createLocalRuntime(),
      fetchImpl,
    });

    const result = await service.transcribe({ audio, metadata: createMetadata() });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://transcribe.example.test/v1/audio/transcriptions",
      expect.any(Object),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("provider_failure");
      expect(result.error.provider).toBe("external_api");
      expect(result.error.message).not.toContain(rawApiKey);
      expect(result.error.message).toContain("[REDACTED]");
    }
  });

  it("enforces configured maxAudioSeconds guardrails", async () => {
    const service = new SpeechTranscriptionService({
      resolveSpeechSettings: () => speechSettings({
        providerMode: "external_api",
        maxAudioSeconds: 1,
        externalTranscription: {
          baseUrl: "https://transcribe.example.test/v1/audio/transcriptions",
          apiKey: "sk-test-secret-1234567890123456",
          model: "whisper-1",
          language: null,
        },
      }),
      fetchImpl: vi.fn(),
    });

    const result = await service.transcribe({
      audio,
      metadata: createMetadata({ durationSeconds: 2 }),
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "client_error",
        message: "Audio duration exceeds the configured 1s limit.",
        retryable: false,
      },
    });
  });
});
