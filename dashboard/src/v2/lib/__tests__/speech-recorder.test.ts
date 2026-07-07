// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isSpeechRecordingSupported,
  startSpeechRecording,
} from "../speech-recorder.js";

interface FakeAudioProcessor {
  onaudioprocess: ((event: AudioProcessingEvent) => void) | null;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

const trackStop = vi.fn();
const sourceConnect = vi.fn();
const sourceDisconnect = vi.fn();
const processorConnect = vi.fn();
const processorDisconnect = vi.fn();
const closeAudioContext = vi.fn(() => Promise.resolve());

let getUserMediaMock: ReturnType<typeof vi.fn>;
let latestProcessor: FakeAudioProcessor | null = null;

const createMediaStream = (): MediaStream => ({
  getTracks: () => [{ stop: trackStop }],
} as unknown as MediaStream);

class FakeAudioContext {
  sampleRate = 48_000;
  destination = {};
  state: AudioContextState = "running";

  createMediaStreamSource(): MediaStreamAudioSourceNode {
    return {
      connect: sourceConnect,
      disconnect: sourceDisconnect,
    } as unknown as MediaStreamAudioSourceNode;
  }

  createScriptProcessor(): ScriptProcessorNode {
    latestProcessor = {
      onaudioprocess: null,
      connect: processorConnect,
      disconnect: processorDisconnect,
    };
    return latestProcessor as unknown as ScriptProcessorNode;
  }

  close(): Promise<void> {
    this.state = "closed";
    return closeAudioContext();
  }
}

const installMediaDevices = (mock: ReturnType<typeof vi.fn>): void => {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: mock },
  });
};

const installAudioContext = (value: unknown): void => {
  Object.defineProperty(window, "AudioContext", {
    configurable: true,
    value,
  });
};

const uninstallMediaRecorder = (): void => {
  Object.defineProperty(window, "MediaRecorder", {
    configurable: true,
    value: undefined,
  });
};

const emitAudioChunk = (samples: number[]): void => {
  latestProcessor?.onaudioprocess?.({
    inputBuffer: {
      length: samples.length,
      numberOfChannels: 1,
      getChannelData: () => Float32Array.from(samples),
    },
  } as unknown as AudioProcessingEvent);
};

const readBlobAscii = async (blob: Blob, start: number, end: number): Promise<string> => {
  const bytes = new Uint8Array(await blob.slice(start, end).arrayBuffer());
  return String.fromCharCode(...bytes);
};

describe("speech-recorder", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-07T00:00:00.000Z"));
    trackStop.mockClear();
    sourceConnect.mockClear();
    sourceDisconnect.mockClear();
    processorConnect.mockClear();
    processorDisconnect.mockClear();
    closeAudioContext.mockClear();
    latestProcessor = null;
    getUserMediaMock = vi.fn().mockResolvedValue(createMediaStream());
    installMediaDevices(getUserMediaMock);
    installAudioContext(FakeAudioContext);
    uninstallMediaRecorder();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("captures mono microphone audio and returns a WAV blob", async () => {
    const startResult = await startSpeechRecording({ targetSampleRate: 16_000 });
    expect(startResult.ok).toBe(true);
    if (!startResult.ok) return;

    emitAudioChunk([0, 0.25, -0.25, 0.5, -0.5, 0.75]);
    vi.advanceTimersByTime(1_250);
    const stopResult = await startResult.session.stop();

    expect(stopResult.ok).toBe(true);
    if (!stopResult.ok) return;

    expect(getUserMediaMock).toHaveBeenCalledWith({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
    expect(stopResult.mimeType).toBe("audio/wav");
    expect(stopResult.audio.type).toBe("audio/wav");
    expect(stopResult.audio.size).toBeGreaterThan(44);
    expect(stopResult.durationSeconds).toBe(1.25);
    expect(await readBlobAscii(stopResult.audio, 0, 4)).toBe("RIFF");
    expect(await readBlobAscii(stopResult.audio, 8, 12)).toBe("WAVE");
    expect(trackStop).toHaveBeenCalledTimes(1);
    expect(sourceDisconnect).toHaveBeenCalledTimes(1);
    expect(processorDisconnect).toHaveBeenCalledTimes(1);
    expect(closeAudioContext).toHaveBeenCalledTimes(1);
  });

  it("reports unsupported browsers without requesting permission", async () => {
    installMediaDevices(undefined as unknown as ReturnType<typeof vi.fn>);
    installAudioContext(undefined);
    uninstallMediaRecorder();

    expect(isSpeechRecordingSupported()).toBe(false);
    const result = await startSpeechRecording();

    expect(result).toEqual({
      ok: false,
      error: {
        code: "unsupported",
        message: "Microphone recording is not supported in this browser.",
      },
    });
    expect(getUserMediaMock).not.toHaveBeenCalled();
  });

  it("maps denied microphone permission to a permission error", async () => {
    const denied = new DOMException("Denied", "NotAllowedError");
    getUserMediaMock.mockRejectedValueOnce(denied);

    const result = await startSpeechRecording();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("permission_denied");
    expect(result.error.message).toBe("Microphone permission was denied.");
    expect(result.error.cause).toBe(denied);
  });

  it("stops tracks and releases audio nodes when aborted", async () => {
    const controller = new AbortController();
    const startResult = await startSpeechRecording({ signal: controller.signal });
    expect(startResult.ok).toBe(true);
    if (!startResult.ok) return;

    emitAudioChunk([0.2, 0.1, 0]);
    controller.abort();
    const stopResult = await startResult.session.stop();

    expect(stopResult.ok).toBe(false);
    if (stopResult.ok) return;
    expect(stopResult.error.code).toBe("aborted");
    expect(trackStop).toHaveBeenCalledTimes(1);
    expect(sourceDisconnect).toHaveBeenCalledTimes(1);
    expect(processorDisconnect).toHaveBeenCalledTimes(1);
    expect(closeAudioContext).toHaveBeenCalledTimes(1);
  });
});
