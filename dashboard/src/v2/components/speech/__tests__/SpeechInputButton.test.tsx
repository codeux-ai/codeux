// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpeechInputButton } from "../SpeechInputButton.js";

expect.extend(matchers);

const speechRecorderMock = vi.hoisted(() => ({
  isSpeechRecordingSupported: vi.fn(),
  startSpeechRecording: vi.fn(),
}));

const speechApiMock = vi.hoisted(() => ({
  transcribeSpeechAudio: vi.fn(),
}));

vi.mock("../../../lib/speech-recorder.js", () => speechRecorderMock);
vi.mock("../../../lib/speech-api.js", () => speechApiMock);

const createRecordingSession = () => ({
  startedAtMs: Date.now(),
  mimeType: "audio/wav",
  stop: vi.fn(),
  abort: vi.fn(),
});

const successfulTranscription = {
  ok: true,
  text: "Build the dashboard primitive.",
  provider: "local_onnx",
  model: "whisper-tiny",
  language: null,
  durationSeconds: 1.2,
} as const;

describe("SpeechInputButton", () => {
  beforeEach(() => {
    speechRecorderMock.isSpeechRecordingSupported.mockReturnValue(true);
    speechRecorderMock.startSpeechRecording.mockReset();
    speechApiMock.transcribeSpeechAudio.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("renders an unavailable disabled state for unsupported browsers", () => {
    speechRecorderMock.isSpeechRecordingSupported.mockReturnValue(false);
    const onTranscript = vi.fn();

    render(<SpeechInputButton onTranscript={onTranscript} />);

    const button = screen.getByRole("button", { name: "Start speech recording" });
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent("Unavailable");
    expect(screen.getByRole("status")).toHaveTextContent("Speech input is unavailable.");

    fireEvent.click(button);
    expect(speechRecorderMock.startSpeechRecording).not.toHaveBeenCalled();
    expect(onTranscript).not.toHaveBeenCalled();
  });

  it("reports microphone permission denial", async () => {
    const onTranscript = vi.fn();
    const onError = vi.fn();
    speechRecorderMock.startSpeechRecording.mockResolvedValueOnce({
      ok: false,
      error: {
        code: "permission_denied",
        message: "Microphone permission was denied.",
      },
    });

    render(<SpeechInputButton onTranscript={onTranscript} onError={onError} />);
    fireEvent.click(screen.getByRole("button", { name: "Start speech recording" }));

    await waitFor(() => expect(onError).toHaveBeenCalledWith({
      source: "recorder",
      error: {
        code: "permission_denied",
        message: "Microphone permission was denied.",
      },
    }));
    expect(screen.getByRole("button", { name: "Start speech recording" })).toHaveTextContent("Retry");
    expect(onTranscript).not.toHaveBeenCalled();
  });

  it("records, stops, transcribes, and returns transcript text with append mode", async () => {
    const session = createRecordingSession();
    const audio = new Blob(["wav"], { type: "audio/wav" });
    session.stop.mockResolvedValueOnce({
      ok: true,
      audio,
      mimeType: "audio/wav",
      durationSeconds: 1.2,
    });
    speechRecorderMock.startSpeechRecording.mockResolvedValueOnce({ ok: true, session });
    speechApiMock.transcribeSpeechAudio.mockResolvedValueOnce(successfulTranscription);
    const onTranscript = vi.fn();

    render(
      <SpeechInputButton
        appendMode={false}
        projectId="project-1"
        sprintId="sprint-1"
        onTranscript={onTranscript}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Start speech recording" }));

    await screen.findByRole("button", { name: "Stop speech recording" });
    expect(screen.getByRole("button", { name: "Stop speech recording" })).toHaveTextContent("Stop");

    fireEvent.click(screen.getByRole("button", { name: "Stop speech recording" }));

    await waitFor(() => expect(onTranscript).toHaveBeenCalledWith(
      "Build the dashboard primitive.",
      {
        appendMode: false,
        result: successfulTranscription,
      },
    ));

    expect(session.stop).toHaveBeenCalledTimes(1);
    expect(speechApiMock.transcribeSpeechAudio).toHaveBeenCalledWith({
      audio,
      filename: "speech-input.wav",
      durationSeconds: 1.2,
      projectId: "project-1",
      sprintId: "sprint-1",
      signal: expect.any(AbortSignal),
    });
    expect(screen.getByRole("button", { name: "Start speech recording" })).toHaveTextContent("Added");
    expect(screen.getByRole("status")).toHaveTextContent("Transcript added.");
  });

  it("reports provider error results without inserting text", async () => {
    const session = createRecordingSession();
    session.stop.mockResolvedValueOnce({
      ok: true,
      audio: new Blob(["wav"], { type: "audio/wav" }),
      mimeType: "audio/wav",
      durationSeconds: 0.8,
    });
    speechRecorderMock.startSpeechRecording.mockResolvedValueOnce({ ok: true, session });
    speechApiMock.transcribeSpeechAudio.mockResolvedValueOnce({
      ok: false,
      error: {
        code: "provider_failure",
        message: "Provider unavailable.",
        retryable: true,
      },
    });
    const onTranscript = vi.fn();
    const onError = vi.fn();

    render(<SpeechInputButton onTranscript={onTranscript} onError={onError} />);
    fireEvent.click(screen.getByRole("button", { name: "Start speech recording" }));
    await screen.findByRole("button", { name: "Stop speech recording" });
    fireEvent.click(screen.getByRole("button", { name: "Stop speech recording" }));

    await waitFor(() => expect(onError).toHaveBeenCalledWith({
      source: "transcription",
      error: {
        code: "provider_failure",
        message: "Provider unavailable.",
        retryable: true,
      },
    }));
    expect(onTranscript).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Start speech recording" })).toHaveTextContent("Retry");
  });

  it("stops and transcribes when the max duration timer expires", async () => {
    vi.useFakeTimers();
    const session = createRecordingSession();
    session.stop.mockResolvedValueOnce({
      ok: true,
      audio: new Blob(["wav"], { type: "audio/wav" }),
      mimeType: "audio/wav",
      durationSeconds: 2,
    });
    speechRecorderMock.startSpeechRecording.mockResolvedValueOnce({ ok: true, session });
    speechApiMock.transcribeSpeechAudio.mockResolvedValueOnce(successfulTranscription);
    const onTranscript = vi.fn();

    render(<SpeechInputButton maxDurationSeconds={2} onTranscript={onTranscript} />);
    fireEvent.click(screen.getByRole("button", { name: "Start speech recording" }));
    await screen.findByRole("button", { name: "Stop speech recording" });

    await vi.advanceTimersByTimeAsync(2_000);

    await waitFor(() => expect(session.stop).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onTranscript).toHaveBeenCalledTimes(1));
  });

  it("aborts active recording resources on unmount", async () => {
    const session = createRecordingSession();
    speechRecorderMock.startSpeechRecording.mockResolvedValueOnce({ ok: true, session });
    const { unmount } = render(<SpeechInputButton onTranscript={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Start speech recording" }));
    await screen.findByRole("button", { name: "Stop speech recording" });

    unmount();

    expect(session.abort).toHaveBeenCalledTimes(1);
  });
});
