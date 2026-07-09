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
});
