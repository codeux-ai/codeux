import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchJson } from "../../../lib/api/fetch-json.js";
import { transcribeSpeechAudio } from "../speech-api.js";

vi.mock("../../../lib/api/fetch-json.js", () => ({
  fetchJson: vi.fn(),
}));

describe("speech-api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    vi.mocked(fetchJson).mockResolvedValueOnce(response);
    const signal = new AbortController().signal;
    const audio = new Blob(["audio"], { type: "audio/wav" });

    const result = await transcribeSpeechAudio({
      audio,
      durationSeconds: 1.4,
      language: "en",
      signal,
    });

    expect(result).toEqual(response);
    expect(fetchJson).toHaveBeenCalledWith(
      "/api/speech/transcriptions",
      {
        method: "POST",
        body: expect.any(FormData),
        signal,
      },
    );
    const body = vi.mocked(fetchJson).mock.calls[0]?.[1]?.body as FormData;
    const uploadedAudio = body.get("audio");
    expect(uploadedAudio).toBeInstanceOf(Blob);
    expect((uploadedAudio as Blob).size).toBe(audio.size);
    expect((uploadedAudio as Blob).type).toBe("audio/wav");
    expect(body.get("source")).toBe("dashboard");
    expect(body.get("mimeType")).toBe("audio/wav");
    expect(body.get("audioBytes")).toBe(String(audio.size));
    expect(body.get("durationSeconds")).toBe("1.4");
    expect(body.get("language")).toBe("en");
  });

  it("returns a typed client error when fetch fails", async () => {
    vi.mocked(fetchJson).mockRejectedValueOnce(new Error("Provider rejected audio"));

    const result = await transcribeSpeechAudio({
      audio: new Blob(["audio"], { type: "audio/wav" }),
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "client_error",
        message: "Provider rejected audio",
        retryable: true,
      },
    });
  });
});
