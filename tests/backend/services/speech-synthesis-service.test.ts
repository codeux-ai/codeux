import { describe, expect, it, vi } from "vitest";
import type { SpeechSettings } from "../../../src/contracts/speech-types.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-defaults.js";
import { resolvePiperSpeakerId, SpeechSynthesisService } from "../../../src/services/speech-synthesis-service.js";
import { resolveCompatibleSynthesisVoice } from "../../../src/services/speech-model-catalog.js";

function settings(overrides: Partial<SpeechSettings["synthesis"]> = {}): SpeechSettings {
  return {
    ...DEFAULT_DASHBOARD_SETTINGS.speech,
    synthesis: {
      ...DEFAULT_DASHBOARD_SETTINGS.speech.synthesis,
      enabled: true,
      ...overrides,
      externalSynthesis: {
        ...DEFAULT_DASHBOARD_SETTINGS.speech.synthesis.externalSynthesis,
        ...overrides.externalSynthesis,
      },
    },
  };
}

describe("SpeechSynthesisService", () => {
  it("maps the curated German MLS voice to its Piper speaker tensor id", () => {
    expect(resolvePiperSpeakerId("piper-de-de-mls-medium", "mls-de-default", 236)).toBe(0);
    expect(() => resolvePiperSpeakerId("piper-de-de-mls-medium", "missing-voice", 236))
      .toThrow('Piper voice "missing-voice" is not available');
    expect(() => resolvePiperSpeakerId("piper-de-de-mls-medium", "mls-de-default", 0))
      .toThrow('Piper speaker 0 is invalid');
  });

  it("falls back to the selected model default for a stale scoped voice", () => {
    expect(resolveCompatibleSynthesisVoice("piper-de-de-mls-medium", "am_michael"))
      .toBe("mls-de-default");
  });

  it("sends OpenAI-compatible external synthesis requests and returns audio", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { "content-type": "audio/mpeg" },
    }));
    const service = new SpeechSynthesisService({
      resolveSpeechSettings: () => settings({
        providerMode: "external_api",
        speed: 1.15,
        externalSynthesis: {
          baseUrl: "https://voice.example.test/v1",
          apiKey: "tts-secret-key",
          model: "voice-model",
          voice: "nova",
          format: "mp3",
        },
      }),
      fetchImpl,
    });

    const result = await service.synthesize({ text: "Hello project", projectId: "project-1" });

    expect(fetchImpl).toHaveBeenCalledWith("https://voice.example.test/v1/audio/speech", expect.objectContaining({
      method: "POST",
      headers: { Authorization: "Bearer tts-secret-key", "Content-Type": "application/json" },
      body: JSON.stringify({ model: "voice-model", input: "Hello project", voice: "nova", response_format: "mp3", speed: 1.15 }),
    }));
    expect(result).toEqual({
      ok: true,
      audio: Buffer.from([1, 2, 3]),
      contentType: "audio/mpeg",
      provider: "external_api",
      model: "voice-model",
      voice: "nova",
    });
  });

  it("fails closed when synthesis is disabled", async () => {
    const fetchImpl = vi.fn();
    const service = new SpeechSynthesisService({
      resolveSpeechSettings: () => settings({ enabled: false, providerMode: "external_api" }),
      fetchImpl,
    });

    const result = await service.synthesize({ text: "Hello" });

    expect(result).toEqual({
      ok: false,
      error: { code: "permission_denied", message: "Text-to-speech is disabled for this scope.", retryable: false },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports a missing local model without sending text externally", async () => {
    const fetchImpl = vi.fn();
    const service = new SpeechSynthesisService({
      resolveSpeechSettings: () => settings({
        providerMode: "local_onnx",
        externalSynthesis: {
          ...DEFAULT_DASHBOARD_SETTINGS.speech.synthesis.externalSynthesis,
          apiKey: "",
        },
      }),
      dataDir: "/definitely-not-installed/codeux-speech-models",
      fetchImpl,
    });

    const result = await service.synthesize({ text: "Keep this local" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("missing_local_model");
      expect(result.error.message).toContain("kokoro-82m-v1.0-q8");
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns a structured client error for an unknown local model", async () => {
    const service = new SpeechSynthesisService({
      resolveSpeechSettings: () => settings({ providerMode: "local_onnx", localModelId: "removed-tts-model" }),
    });

    const result = await service.synthesize({ text: "Keep this local" });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "client_error",
        message: 'Unknown local TTS model "removed-tts-model".',
        provider: "local_onnx",
        retryable: false,
      },
    });
  });
});
