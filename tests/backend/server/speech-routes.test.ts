import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { SpeechTranscriptionResult } from "../../../src/contracts/speech-types.js";
import { registerSpeechRoutes } from "../../../src/server/speech-routes.js";
import { shouldParseDashboardJsonBody } from "../../../src/server/dashboard-middleware.js";
import { MAX_SPEECH_AUDIO_BYTES } from "../../../src/services/speech-audio-utils.js";
import type { SpeechTranscriptionService } from "../../../src/services/speech-transcription-service.js";

function createApp(result: SpeechTranscriptionResult) {
  const service: Pick<SpeechTranscriptionService, "transcribe"> = {
    transcribe: vi.fn().mockResolvedValue(result),
  };
  const app = express();
  registerSpeechRoutes(app, { speechTranscriptionService: service });
  return { app, service };
}

describe("speech routes", () => {
  it("does not let the dashboard JSON parser claim multipart speech uploads", () => {
    expect(shouldParseDashboardJsonBody({
      method: "POST",
      url: "/api/speech/transcriptions",
      headers: { "content-type": "multipart/form-data; boundary=abc" },
    } as any)).toBe(false);
  });

  it("accepts one multipart audio upload and forwards dashboard metadata", async () => {
    const { app, service } = createApp({
      ok: true,
      text: "Transcribed prompt",
      provider: "external_api",
      model: "whisper-1",
      language: "en",
      durationSeconds: 1.5,
      fallback: null,
    });

    const response = await request(app)
      .post("/api/speech/transcriptions")
      .field("projectId", "project-1")
      .field("sprintId", "sprint-1")
      .field("durationSeconds", "1.5")
      .field("language", "en")
      .attach("audio", Buffer.from("audio-bytes"), {
        filename: "prompt.webm",
        contentType: "audio/webm",
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ok: true,
      text: "Transcribed prompt",
      provider: "external_api",
      model: "whisper-1",
      language: "en",
      durationSeconds: 1.5,
      fallback: null,
    });
    expect(service.transcribe).toHaveBeenCalledWith(expect.objectContaining({
      audio: expect.any(Buffer),
      fileName: "prompt.webm",
      metadata: expect.objectContaining({
        projectId: "project-1",
        sprintId: "sprint-1",
        source: "dashboard",
        mimeType: "audio/webm",
        audioBytes: "audio-bytes".length,
        durationSeconds: 1.5,
        language: "en",
      }),
    }));
  });

  it("rejects missing audio before calling the transcription service", async () => {
    const { app, service } = createApp({
      ok: true,
      text: "unused",
      provider: "local_onnx",
      model: "model",
      language: null,
      durationSeconds: null,
    });

    const response = await request(app)
      .post("/api/speech/transcriptions")
      .field("projectId", "project-1");

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("unsupported_audio");
    expect(service.transcribe).not.toHaveBeenCalled();
  });

  it("rejects unsupported MIME types before calling the transcription service", async () => {
    const { app, service } = createApp({
      ok: true,
      text: "unused",
      provider: "local_onnx",
      model: "model",
      language: null,
      durationSeconds: null,
    });

    const response = await request(app)
      .post("/api/speech/transcriptions")
      .attach("audio", Buffer.from("not-audio"), {
        filename: "prompt.txt",
        contentType: "text/plain",
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("unsupported_audio");
    expect(service.transcribe).not.toHaveBeenCalled();
  });

  it("rejects route-level maxAudioSeconds violations before transcription", async () => {
    const { app, service } = createApp({
      ok: true,
      text: "unused",
      provider: "local_onnx",
      model: "model",
      language: null,
      durationSeconds: null,
    });

    const response = await request(app)
      .post("/api/speech/transcriptions")
      .field("durationSeconds", "3")
      .field("maxAudioSeconds", "2")
      .attach("audio", Buffer.from("audio-bytes"), {
        filename: "prompt.webm",
        contentType: "audio/webm",
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("client_error");
    expect(service.transcribe).not.toHaveBeenCalled();
  });

  it("maps structured local setup failures to a 400 response", async () => {
    const { app } = createApp({
      ok: false,
      error: {
        code: "missing_local_model",
        message: "Local speech model is not installed.",
        provider: "local_onnx",
        retryable: false,
      },
    });

    const response = await request(app)
      .post("/api/speech/transcriptions")
      .attach("audio", Buffer.from("audio-bytes"), {
        filename: "prompt.webm",
        contentType: "audio/webm",
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toEqual({
      code: "missing_local_model",
      message: "Local speech model is not installed.",
      provider: "local_onnx",
      retryable: false,
    });
  });

  it("maps oversized multipart audio uploads to 413", async () => {
    const { app, service } = createApp({
      ok: true,
      text: "unused",
      provider: "local_onnx",
      model: "model",
      language: null,
      durationSeconds: null,
    });

    const response = await request(app)
      .post("/api/speech/transcriptions")
      .attach("audio", Buffer.alloc(MAX_SPEECH_AUDIO_BYTES + 1), {
        filename: "large.webm",
        contentType: "audio/webm",
      });

    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe("unsupported_audio");
    expect(service.transcribe).not.toHaveBeenCalled();
  });

  it("returns synthesized audio with provider metadata", async () => {
    const app = express();
    app.use(express.json());
    const transcribe = vi.fn();
    const synthesize = vi.fn().mockResolvedValue({
      ok: true,
      audio: Buffer.from("wave-bytes"),
      contentType: "audio/wav",
      provider: "local_onnx",
      model: "kokoro-82m-v1.0-q8",
      voice: "af_heart",
    });
    registerSpeechRoutes(app, {
      speechTranscriptionService: { transcribe },
      speechSynthesisService: { synthesize },
    });

    const response = await request(app).post("/api/speech/synthesis").send({ text: "Hello", projectId: "project-1" });

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("audio/wav");
    expect(response.headers["x-codeux-speech-provider"]).toBe("local_onnx");
    expect(response.body).toEqual(Buffer.from("wave-bytes"));
    expect(synthesize).toHaveBeenCalledWith({ text: "Hello", projectId: "project-1", sprintId: null, voice: null });
  });

  it("rejects a speech-model download without the current license acceptance", async () => {
    const app = express();
    app.use(express.json());
    const downloadModel = vi.fn().mockResolvedValue(undefined);
    const validateDownloadAcceptance = vi.fn((_modelId: string, acceptedLicenseId?: string) => {
      if (acceptedLicenseId !== "mit-v1") throw new Error("Accept the MIT terms before downloading.");
    });
    registerSpeechRoutes(app, {
      speechTranscriptionService: { transcribe: vi.fn() },
      speechModelManager: {
        listModels: vi.fn(),
        hasModel: vi.fn().mockReturnValue(true),
        validateDownloadAcceptance,
        downloadModel,
        cancelDownload: vi.fn(),
        deleteModel: vi.fn(),
      },
    });

    const rejected = await request(app).post("/api/speech/models/test-model/download").send({});
    expect(rejected.status).toBe(400);
    expect(downloadModel).not.toHaveBeenCalled();

    const accepted = await request(app).post("/api/speech/models/test-model/download").send({ acceptedLicenseId: "mit-v1" });
    expect(accepted.status).toBe(200);
    expect(downloadModel).toHaveBeenCalledWith("test-model", "mit-v1");
  });
});
