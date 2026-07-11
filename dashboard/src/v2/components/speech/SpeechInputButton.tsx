import type { FunctionComponent } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Loader2, Mic, Square } from "lucide-preact";
import type { SpeechTranscriptionError, SpeechTranscriptionResult } from "../../types.js";
import { transcribeSpeechAudio } from "../../lib/speech-api.js";
import type { SpeechRecordingSession, SpeechRecorderError } from "../../lib/speech-recorder.js";
import { isSpeechRecordingSupported, startSpeechRecording } from "../../lib/speech-recorder.js";
import { SHARED_INTERACTION_CLASSES } from "../ui/Button.js";

export type SpeechInputButtonState =
  | "idle"
  | "requesting_permission"
  | "recording"
  | "transcribing"
  | "success"
  | "unsupported"
  | "error";

export interface SpeechInputButtonTranscriptDetails {
  appendMode: boolean;
  result: Extract<SpeechTranscriptionResult, { ok: true }>;
}

export type SpeechInputButtonError =
  | { source: "recorder"; error: SpeechRecorderError }
  | { source: "transcription"; error: SpeechTranscriptionError };

export interface SpeechInputButtonProps {
  disabled?: boolean;
  compact?: boolean;
  maxDurationSeconds?: number;
  appendMode?: boolean;
  projectId?: string | null;
  sprintId?: string | null;
  className?: string;
  onTranscript: (text: string, details: SpeechInputButtonTranscriptDetails) => void;
  onError?: (error: SpeechInputButtonError) => void;
}

const DEFAULT_MAX_DURATION_SECONDS = 60;

const STATUS_LABELS: Record<SpeechInputButtonState, string> = {
  idle: "Record",
  requesting_permission: "Requesting",
  recording: "Stop",
  transcribing: "Transcribing",
  success: "Added",
  unsupported: "Unavailable",
  error: "Retry",
};

const STATUS_ANNOUNCEMENTS: Record<SpeechInputButtonState, string> = {
  idle: "Speech input ready.",
  requesting_permission: "Requesting microphone permission.",
  recording: "Recording speech.",
  transcribing: "Transcribing speech.",
  success: "Transcript added.",
  unsupported: "Speech input is unavailable.",
  error: "Speech input failed.",
};

const toTranscriptionError = (error: SpeechRecorderError): SpeechInputButtonError => ({
  source: "recorder",
  error,
});

export const SpeechInputButton: FunctionComponent<SpeechInputButtonProps> = ({
  disabled = false,
  compact = false,
  maxDurationSeconds = DEFAULT_MAX_DURATION_SECONDS,
  appendMode = true,
  projectId = null,
  sprintId = null,
  className = "",
  onTranscript,
  onError,
}) => {
  const [state, setState] = useState<SpeechInputButtonState>(() => (
    isSpeechRecordingSupported() ? "idle" : "unsupported"
  ));
  const sessionRef = useRef<SpeechRecordingSession | null>(null);
  const permissionAbortRef = useRef<AbortController | null>(null);
  const transcriptionAbortRef = useRef<AbortController | null>(null);
  const maxDurationTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  const clearMaxDurationTimer = useCallback(() => {
    if (maxDurationTimerRef.current !== null) {
      window.clearTimeout(maxDurationTimerRef.current);
      maxDurationTimerRef.current = null;
    }
  }, []);

  const resetRecordingResources = useCallback(() => {
    clearMaxDurationTimer();
    permissionAbortRef.current?.abort();
    permissionAbortRef.current = null;
    transcriptionAbortRef.current?.abort();
    transcriptionAbortRef.current = null;
    sessionRef.current?.abort();
    sessionRef.current = null;
  }, [clearMaxDurationTimer]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      resetRecordingResources();
    };
  }, [resetRecordingResources]);

  useEffect(() => {
    if (disabled && (state === "requesting_permission" || state === "recording" || state === "transcribing")) {
      resetRecordingResources();
      setState(isSpeechRecordingSupported() ? "idle" : "unsupported");
    }
  }, [disabled, resetRecordingResources, state]);

  const reportRecorderError = useCallback((error: SpeechRecorderError) => {
    onError?.(toTranscriptionError(error));
    if (mountedRef.current) setState(error.code === "unsupported" ? "unsupported" : "error");
  }, [onError]);

  const reportTranscriptionError = useCallback((error: SpeechTranscriptionError) => {
    onError?.({ source: "transcription", error });
    if (mountedRef.current) setState("error");
  }, [onError]);

  const stopAndTranscribe = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;

    clearMaxDurationTimer();
    if (mountedRef.current) setState("transcribing");

    const recordingResult = await session.stop();
    sessionRef.current = null;
    permissionAbortRef.current = null;
    if (!mountedRef.current) return;

    if (!recordingResult.ok) {
      reportRecorderError(recordingResult.error);
      return;
    }

    const transcriptionAbort = new AbortController();
    transcriptionAbortRef.current = transcriptionAbort;
    const transcriptionResult = await transcribeSpeechAudio({
      audio: recordingResult.audio,
      filename: recordingResult.mimeType === "audio/wav" ? "speech-input.wav" : "speech-input.webm",
      durationSeconds: recordingResult.durationSeconds,
      projectId,
      sprintId,
      signal: transcriptionAbort.signal,
    });
    transcriptionAbortRef.current = null;
    if (!mountedRef.current) return;

    if (!transcriptionResult.ok) {
      reportTranscriptionError(transcriptionResult.error);
      return;
    }

    const transcript = transcriptionResult.text.trim();
    if (!transcript) {
      reportTranscriptionError({
        code: "client_error",
        message: "No transcript text was returned.",
        retryable: false,
      });
      return;
    }

    onTranscript(transcript, { appendMode, result: transcriptionResult });
    if (mountedRef.current) setState("success");
  }, [appendMode, clearMaxDurationTimer, onTranscript, projectId, reportRecorderError, reportTranscriptionError, sprintId]);

  const startRecording = useCallback(async () => {
    if (disabled || state === "requesting_permission" || state === "transcribing") return;
    if (!isSpeechRecordingSupported()) {
      setState("unsupported");
      onError?.({
        source: "recorder",
        error: {
          code: "unsupported",
          message: "Microphone recording is not supported in this browser.",
        },
      });
      return;
    }

    setState("requesting_permission");
    const permissionAbort = new AbortController();
    permissionAbortRef.current = permissionAbort;
    const startResult = await startSpeechRecording({ signal: permissionAbort.signal });
    if (!mountedRef.current) return;
    permissionAbortRef.current = null;

    if (!startResult.ok) {
      reportRecorderError(startResult.error);
      return;
    }

    sessionRef.current = startResult.session;
    setState("recording");
    clearMaxDurationTimer();
    maxDurationTimerRef.current = window.setTimeout(() => {
      void stopAndTranscribe();
    }, Math.max(1, maxDurationSeconds) * 1_000);
  }, [clearMaxDurationTimer, disabled, maxDurationSeconds, onError, reportRecorderError, state, stopAndTranscribe]);

  const handleClick = useCallback(() => {
    if (state === "recording") {
      void stopAndTranscribe();
      return;
    }
    void startRecording();
  }, [startRecording, state, stopAndTranscribe]);

  const icon = useMemo(() => {
    if (state === "requesting_permission" || state === "transcribing") {
      return <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" strokeWidth={2.3} />;
    }
    if (state === "recording") {
      return <Square aria-hidden="true" className="h-4 w-4" fill="currentColor" strokeWidth={2.3} />;
    }
    return <Mic aria-hidden="true" className="h-4 w-4" strokeWidth={2.3} />;
  }, [state]);

  const isBusy = state === "requesting_permission" || state === "transcribing";
  const isDisabled = disabled || state === "unsupported" || isBusy;
  const statusLabel = STATUS_LABELS[state];
  const announcement = STATUS_ANNOUNCEMENTS[state];

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={isDisabled}
        aria-label={state === "recording" ? "Stop speech recording" : "Start speech recording"}
        aria-pressed={state === "recording" ? "true" : "false"}
        aria-busy={isBusy ? "true" : "false"}
        onClick={handleClick}
        title={compact ? statusLabel : undefined}
        className={`inline-flex items-center justify-center border text-xs font-bold shadow-sm ${SHARED_INTERACTION_CLASSES} ${
          compact
            ? "h-11 w-11 min-w-11 rounded-full px-0"
            : "h-10 min-w-[8.75rem] gap-2 rounded-[var(--radius-ui)] px-3"
        } ${
          state === "recording"
            ? "border-status-red/30 bg-status-red/[0.08] text-status-red hover:bg-status-red/[0.13]"
            : "border-[color:var(--border-hairline)] bg-[var(--surface-glass)] text-slate-700 hover:bg-[var(--surface-glass-hover)] hover:text-slate-950 dark:text-slate-200 dark:hover:text-white"
        } ${className}`}
      >
        {icon}
        <span className={compact ? "sr-only" : undefined}>{statusLabel}</span>
      </button>
      <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </span>
    </span>
  );
};
