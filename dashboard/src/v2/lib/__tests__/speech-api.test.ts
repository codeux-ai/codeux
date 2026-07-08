import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { transcribeSpeechAudio } from "../speech-api.js";

const createJsonResponse = (body: unknown, init: ResponseInit = {}): Response => (
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  })
);

describe("speech-api", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts a multipart audio upload to the speech transcription endpoint", async () => {
    const response = {
      ok: true,
      text: "Ship it",
      provider: "local_onnx",
      model: "whisper-tiny",
      language: null,
      durationSeconds: 1.4,
    } as const;
    vi.mocked(fetch).mockResolvedValueOnce(createJsonResponse(response));
    const signal = new AbortController().signal;
    const audio = new Blob(["audio"], { type: "audio/wav" });

    const result = await transcribeSpeechAudio({
      audio,
      durationSeconds: 1.4,
      language: "en",
      projectId: "project-1",
      sprintId: "sprint-1",
      signal,
    });

    expect(result).toEqual(response);
    expect(fetch).toHaveBeenCalledWith(
      "/api/speech/transcriptions",
      {
        method: "POST",
        body: expect.any(FormData),
        signal,
        cache: "no-store",
      },
    );
    const body = vi.mocked(fetch).mock.calls[0]?.[1]?.body;
    expect(body).toBeInstanceOf(FormData);
    if (!(body instanceof FormData)) {
      throw new Error("Expected speech upload body to be FormData.");
    }
    const uploadedAudio = body.get("audio");
    expect(uploadedAudio).toBeInstanceOf(Blob);
    expect((uploadedAudio as Blob).size).toBe(audio.size);
    expect((uploadedAudio as Blob).type).toBe("audio/wav");
    expect(body.get("source")).toBe("dashboard");
    expect(body.get("mimeType")).toBe("audio/wav");
    expect(body.get("audioBytes")).toBe(String(audio.size));
    expect(body.get("durationSeconds")).toBe("1.4");
    expect(body.get("language")).toBe("en");
    expect(body.get("projectId")).toBe("project-1");
    expect(body.get("sprintId")).toBe("sprint-1");
  });

  it("returns structured speech errors from non-2xx JSON responses", async () => {
    const responses = [
      {
        status: 400,
        result: {
          ok: false,
          error: {
            code: "missing_local_model",
            message: "Download the local speech model before using local transcription.",
            provider: "local_onnx",
            retryable: false,
          },
        },
      },
      {
        status: 403,
        result: {
          ok: false,
          error: {
            code: "permission_denied",
            message: "Speech transcription is disabled for this scope.",
            retryable: false,
          },
        },
      },
      {
        status: 502,
        result: {
          ok: false,
          error: {
            code: "provider_failure",
            message: "External transcription provider unavailable.",
            provider: "external_api",
            retryable: true,
          },
        },
      },
    ] as const;

    for (const response of responses) {
      vi.mocked(fetch).mockResolvedValueOnce(createJsonResponse(response.result, { status: response.status }));

      const result = await transcribeSpeechAudio({
        audio: new Blob(["audio"], { type: "audio/wav" }),
      });

      expect(result).toEqual(response.result);
    }
  });

  it("returns a cancellation result when the request is aborted", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new DOMException("The operation was aborted.", "AbortError"));

    const result = await transcribeSpeechAudio({
      audio: new Blob(["audio"], { type: "audio/wav" }),
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "client_error",
        message: "Speech transcription was cancelled.",
        retryable: false,
      },
    });
  });

  it("returns a retryable client error for network failures", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const result = await transcribeSpeechAudio({
      audio: new Blob(["audio"], { type: "audio/wav" }),
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "client_error",
        message: "Failed to fetch",
        retryable: true,
      },
    });
  });
});
