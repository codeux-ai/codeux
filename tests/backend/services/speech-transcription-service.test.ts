import { describe, expect, it, vi } from "vitest";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-defaults.js";
import type { SpeechSettings } from "../../../src/contracts/speech-types.js";
import {
  SpeechTranscriptionService,
  type LocalOnnxSpeechRuntime,
} from "../../../src/services/speech-transcription-service.js";

const audio = Buffer.from("audio-bytes");

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
        message: 'Local speech model "onnx-community/whisper-base.en" is not installed.',
        provider: "local_onnx",
        retryable: false,
      },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uses local ONNX when the selected local model is available", async () => {
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

    const result = await service.transcribe({ audio, metadata: createMetadata({ language: "en" }) });

    expect(result).toEqual({
      ok: true,
      text: "local transcript",
      provider: "local_onnx",
      model: "onnx-community/whisper-base.en",
      language: "en",
      durationSeconds: 1,
      fallback: null,
    });
    expect(localRuntime.transcribe).toHaveBeenCalledWith(expect.objectContaining({
      model: expect.objectContaining({ id: "onnx-community/whisper-base.en" }),
      language: "en",
    }));
  });

  it("falls back to an explicitly configured external API in auto mode", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      text: "external transcript",
      language: "en",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const service = new SpeechTranscriptionService({
      resolveSpeechSettings: () => speechSettings({
        providerMode: "auto",
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
      fallback: {
        attemptedProvider: "local_onnx",
        reason: "missing_local_model",
        message: 'Local speech model "onnx-community/whisper-base.en" is not installed.',
      },
    });
  });

  it("does not send audio externally in auto mode without explicit external credentials", async () => {
    const fetchImpl = vi.fn();
    const service = new SpeechTranscriptionService({
      resolveSpeechSettings: () => speechSettings({
        providerMode: "auto",
        externalTranscription: {
          baseUrl: "https://transcribe.example.test/v1/audio/transcriptions",
          apiKey: "",
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
      expect(result.error.code).toBe("client_error");
      expect(result.error.message).toContain("Install local model");
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
