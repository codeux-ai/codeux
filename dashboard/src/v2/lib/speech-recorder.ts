export type SpeechRecorderErrorCode =
  | "unsupported"
  | "permission_denied"
  | "recording_failed"
  | "empty_audio"
  | "aborted";

export interface SpeechRecorderError {
  code: SpeechRecorderErrorCode;
  message: string;
  cause?: unknown;
}

export interface SpeechRecorderStopResult {
  ok: true;
  audio: Blob;
  mimeType: string;
  durationSeconds: number;
}

export interface SpeechRecorderFailure {
  ok: false;
  error: SpeechRecorderError;
}

export type SpeechRecorderResult = SpeechRecorderStopResult | SpeechRecorderFailure;

export interface SpeechRecordingSession {
  readonly startedAtMs: number;
  readonly mimeType: string;
  stop: () => Promise<SpeechRecorderResult>;
  abort: (reason?: string) => void;
}

export interface StartSpeechRecordingOptions {
  signal?: AbortSignal;
  targetSampleRate?: number;
}

export type StartSpeechRecordingResult =
  | { ok: true; session: SpeechRecordingSession }
  | SpeechRecorderFailure;

const DEFAULT_TARGET_SAMPLE_RATE = 16_000;
const WAV_MIME_TYPE = "audio/wav";

type AudioContextConstructor = typeof AudioContext;

interface BrowserWindowWithAudio {
  AudioContext?: AudioContextConstructor;
  webkitAudioContext?: AudioContextConstructor;
}

const createRecorderError = (
  code: SpeechRecorderErrorCode,
  message: string,
  cause?: unknown,
): SpeechRecorderError => ({ code, message, cause });

const readNow = (): number => Date.now();

const getMediaDevices = (): MediaDevices | null => {
  if (typeof navigator === "undefined") return null;
  return navigator.mediaDevices ?? null;
};

const getAudioContextConstructor = (): AudioContextConstructor | null => {
  if (typeof window === "undefined") return null;
  const audioWindow = window as unknown as BrowserWindowWithAudio;
  return audioWindow.AudioContext ?? audioWindow.webkitAudioContext ?? null;
};

const getMediaRecorderConstructor = (): typeof MediaRecorder | null => {
  if (typeof window === "undefined") return null;
  return window.MediaRecorder ?? null;
};

export const isSpeechRecordingSupported = (): boolean => {
  const mediaDevices = getMediaDevices();
  if (!mediaDevices?.getUserMedia) return false;
  return Boolean(getAudioContextConstructor() || getMediaRecorderConstructor());
};

const isPermissionDeniedError = (error: unknown): boolean => {
  if (!(error instanceof DOMException)) return false;
  return error.name === "NotAllowedError" || error.name === "PermissionDeniedError" || error.name === "SecurityError";
};

const stopStreamTracks = (stream: MediaStream): void => {
  for (const track of stream.getTracks()) {
    track.stop();
  }
};

const safelyDisconnect = (node: { disconnect: () => void } | null): void => {
  try {
    node?.disconnect();
  } catch {
    // Some browser audio nodes throw when disconnect is called after graph teardown.
  }
};

const createAudioConstraints = (): MediaStreamConstraints => ({
  audio: {
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
  },
});

export const startSpeechRecording = async (
  options: StartSpeechRecordingOptions = {},
): Promise<StartSpeechRecordingResult> => {
  if (options.signal?.aborted) {
    return {
      ok: false,
      error: createRecorderError("aborted", "Speech recording was cancelled."),
    };
  }

  const mediaDevices = getMediaDevices();
  if (!mediaDevices?.getUserMedia) {
    return {
      ok: false,
      error: createRecorderError("unsupported", "Microphone recording is not supported in this browser."),
    };
  }

  const AudioContextCtor = getAudioContextConstructor();
  const MediaRecorderCtor = getMediaRecorderConstructor();
  if (!AudioContextCtor && !MediaRecorderCtor) {
    return {
      ok: false,
      error: createRecorderError("unsupported", "Audio recording is not supported in this browser."),
    };
  }

  let stream: MediaStream;
  try {
    stream = await mediaDevices.getUserMedia(createAudioConstraints());
  } catch (error) {
    return {
      ok: false,
      error: isPermissionDeniedError(error)
        ? createRecorderError("permission_denied", "Microphone permission was denied.", error)
        : createRecorderError("recording_failed", "Could not start microphone recording.", error),
    };
  }

  if (options.signal?.aborted) {
    stopStreamTracks(stream);
    return {
      ok: false,
      error: createRecorderError("aborted", "Speech recording was cancelled."),
    };
  }

  if (AudioContextCtor) {
    return createWebAudioRecordingSession(stream, AudioContextCtor, options);
  }

  if (MediaRecorderCtor) {
    return createMediaRecorderSession(stream, MediaRecorderCtor, options.signal);
  }

  stopStreamTracks(stream);
  return {
    ok: false,
    error: createRecorderError("unsupported", "Audio recording is not supported in this browser."),
  };
};

const createWebAudioRecordingSession = (
  stream: MediaStream,
  AudioContextCtor: AudioContextConstructor,
  options: StartSpeechRecordingOptions,
): StartSpeechRecordingResult => {
  const targetSampleRate = options.targetSampleRate ?? DEFAULT_TARGET_SAMPLE_RATE;
  let audioContext: AudioContext | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let processor: ScriptProcessorNode | null = null;
  let stopped = false;
  let aborted = false;
  let cleanedUp = false;
  const startedAtMs = readNow();
  const chunks: Float32Array[] = [];

  const cleanup = (): void => {
    if (cleanedUp) return;
    cleanedUp = true;
    safelyDisconnect(processor);
    safelyDisconnect(source);
    if (audioContext && audioContext.state !== "closed") {
      void audioContext.close().catch(() => undefined);
    }
    stopStreamTracks(stream);
    options.signal?.removeEventListener("abort", abortFromSignal);
  };

  const abortFromSignal = (): void => {
    aborted = true;
    cleanup();
  };

  try {
    audioContext = new AudioContextCtor();
    source = audioContext.createMediaStreamSource(stream);
    processor = audioContext.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (event: AudioProcessingEvent) => {
      if (stopped || aborted) return;
      chunks.push(readMonoChannel(event.inputBuffer));
    };
    source.connect(processor);
    processor.connect(audioContext.destination);
    options.signal?.addEventListener("abort", abortFromSignal, { once: true });
  } catch (error) {
    cleanup();
    return {
      ok: false,
      error: createRecorderError("recording_failed", "Could not initialize microphone recording.", error),
    };
  }

  return {
    ok: true,
    session: {
      startedAtMs,
      mimeType: WAV_MIME_TYPE,
      abort: () => {
        if (stopped || aborted) return;
        aborted = true;
        cleanup();
      },
      stop: async () => {
        if (stopped) {
          return {
            ok: false,
            error: createRecorderError("recording_failed", "Speech recording has already stopped."),
          };
        }
        stopped = true;
        cleanup();

        if (aborted) {
          return {
            ok: false,
            error: createRecorderError("aborted", "Speech recording was cancelled."),
          };
        }

        if (chunks.length === 0 || !audioContext) {
          return {
            ok: false,
            error: createRecorderError("empty_audio", "No microphone audio was captured."),
          };
        }

        const merged = mergeFloat32Chunks(chunks);
        const downsampled = downsampleAudio(merged, audioContext.sampleRate, targetSampleRate);
        const audio = encodePcm16Wav(downsampled, Math.min(audioContext.sampleRate, targetSampleRate));
        return {
          ok: true,
          audio,
          mimeType: WAV_MIME_TYPE,
          durationSeconds: readDurationSeconds(startedAtMs),
        };
      },
    },
  };
};

const createMediaRecorderSession = (
  stream: MediaStream,
  MediaRecorderCtor: typeof MediaRecorder,
  signal?: AbortSignal,
): StartSpeechRecordingResult => {
  let recorder: MediaRecorder;
  const chunks: Blob[] = [];
  let stopped = false;
  let aborted = false;
  let cleanedUp = false;
  const startedAtMs = readNow();

  const cleanup = (): void => {
    if (cleanedUp) return;
    cleanedUp = true;
    stopStreamTracks(stream);
    signal?.removeEventListener("abort", abortFromSignal);
  };

  const abortFromSignal = (): void => {
    aborted = true;
    if (recorder.state !== "inactive") {
      recorder.stop();
    } else {
      cleanup();
    }
  };

  try {
    recorder = new MediaRecorderCtor(stream);
    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.start();
    signal?.addEventListener("abort", abortFromSignal, { once: true });
  } catch (error) {
    cleanup();
    return {
      ok: false,
      error: createRecorderError("recording_failed", "Could not initialize microphone recording.", error),
    };
  }

  return {
    ok: true,
    session: {
      startedAtMs,
      mimeType: recorder.mimeType || "audio/webm",
      abort: () => {
        if (stopped || aborted) return;
        aborted = true;
        if (recorder.state !== "inactive") {
          recorder.stop();
        } else {
          cleanup();
        }
      },
      stop: async () => {
        if (stopped) {
          return {
            ok: false,
            error: createRecorderError("recording_failed", "Speech recording has already stopped."),
          };
        }
        stopped = true;

        const stoppedResult = await new Promise<SpeechRecorderResult>((resolve) => {
          recorder.onstop = () => {
            cleanup();
            if (aborted) {
              resolve({
                ok: false,
                error: createRecorderError("aborted", "Speech recording was cancelled."),
              });
              return;
            }
            if (chunks.length === 0) {
              resolve({
                ok: false,
                error: createRecorderError("empty_audio", "No microphone audio was captured."),
              });
              return;
            }
            const mimeType = recorder.mimeType || chunks[0]?.type || "audio/webm";
            resolve({
              ok: true,
              audio: new Blob(chunks, { type: mimeType }),
              mimeType,
              durationSeconds: readDurationSeconds(startedAtMs),
            });
          };
          recorder.onerror = (event) => {
            cleanup();
            resolve({
              ok: false,
              error: createRecorderError("recording_failed", "Microphone recording failed.", event),
            });
          };
          if (recorder.state === "inactive") {
            recorder.onstop?.(new Event("stop"));
          } else {
            recorder.stop();
          }
        });

        return stoppedResult;
      },
    },
  };
};

const readDurationSeconds = (startedAtMs: number): number => {
  const elapsedMs = Math.max(0, readNow() - startedAtMs);
  return Math.round((elapsedMs / 1_000) * 100) / 100;
};

const readMonoChannel = (inputBuffer: AudioBuffer): Float32Array => {
  const channelCount = Math.max(1, inputBuffer.numberOfChannels);
  const frameCount = inputBuffer.length;
  if (channelCount === 1) {
    return new Float32Array(inputBuffer.getChannelData(0));
  }

  const mono = new Float32Array(frameCount);
  for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
    const channel = inputBuffer.getChannelData(channelIndex);
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      mono[frameIndex] += channel[frameIndex] / channelCount;
    }
  }
  return mono;
};

const mergeFloat32Chunks = (chunks: Float32Array[]): Float32Array => {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Float32Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
};

const downsampleAudio = (
  samples: Float32Array,
  sourceSampleRate: number,
  targetSampleRate: number,
): Float32Array => {
  if (targetSampleRate >= sourceSampleRate) {
    return samples;
  }

  const ratio = sourceSampleRate / targetSampleRate;
  const outputLength = Math.max(1, Math.floor(samples.length / ratio));
  const output = new Float32Array(outputLength);
  let inputOffset = 0;

  for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
    const nextInputOffset = Math.round((outputIndex + 1) * ratio);
    let accumulator = 0;
    let count = 0;
    for (let inputIndex = inputOffset; inputIndex < nextInputOffset && inputIndex < samples.length; inputIndex += 1) {
      accumulator += samples[inputIndex];
      count += 1;
    }
    output[outputIndex] = count > 0 ? accumulator / count : 0;
    inputOffset = nextInputOffset;
  }

  return output;
};

const encodePcm16Wav = (samples: Float32Array, sampleRate: number): Blob => {
  const bytesPerSample = 2;
  const channelCount = 1;
  const dataByteLength = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataByteLength);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataByteLength, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channelCount * bytesPerSample, true);
  view.setUint16(32, channelCount * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataByteLength, true);

  let offset = 44;
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    const value = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    view.setInt16(offset, value, true);
    offset += bytesPerSample;
  }

  return new Blob([buffer], { type: WAV_MIME_TYPE });
};

const writeAscii = (view: DataView, offset: number, value: string): void => {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
};
