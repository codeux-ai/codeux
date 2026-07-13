import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { synthesizeSpeech } from "../lib/speech-api.js";
import { speechTextFromMarkdown, splitSpeechPlaybackText } from "../lib/speech-playback.js";

const SPEECH_PREFETCH_AHEAD = 2;

interface SpeechPlaybackRun {
  abortController: AbortController;
  activeAudio: HTMLAudioElement | null;
  activeUrl: string | null;
  cancelled: boolean;
  settleAudio: (() => void) | null;
}

interface SynthesisOutcome {
  blob?: Blob;
  error?: unknown;
}

interface AudioOutcome {
  completed: boolean;
  error?: string;
}

const readPlaybackError = (error: unknown, fallback: string): string => (
  error instanceof Error && error.message ? error.message : fallback
);

const cancelPlaybackRun = (run: SpeechPlaybackRun): void => {
  if (run.cancelled) return;
  run.cancelled = true;
  run.abortController.abort();
  run.activeAudio?.pause();
  run.settleAudio?.();
  run.settleAudio = null;
  run.activeAudio = null;
  if (run.activeUrl) {
    URL.revokeObjectURL(run.activeUrl);
    run.activeUrl = null;
  }
};

const playAudioBlob = (run: SpeechPlaybackRun, blob: Blob): Promise<AudioOutcome> => (
  new Promise<AudioOutcome>((resolve) => {
    const url = URL.createObjectURL(blob);
    run.activeUrl = url;
    const audio = new Audio(url);
    run.activeAudio = audio;
    let settled = false;

    const finish = (completed: boolean, error?: string): void => {
      if (settled) return;
      settled = true;
      audio.onended = null;
      audio.onerror = null;
      URL.revokeObjectURL(url);
      if (run.activeUrl === url) run.activeUrl = null;
      if (run.activeAudio === audio) run.activeAudio = null;
      if (run.settleAudio === cancelAudio) run.settleAudio = null;
      resolve({ completed, error });
    };
    const cancelAudio = (): void => finish(false);

    run.settleAudio = cancelAudio;
    audio.onended = () => finish(true);
    audio.onerror = () => finish(false, "The browser could not play the generated audio.");
    try {
      void audio.play().catch((error: unknown) => finish(
        false,
        readPlaybackError(error, "The browser blocked audio playback. Use the voice button and try again."),
      ));
    } catch (error) {
      finish(
        false,
        readPlaybackError(error, "The browser blocked audio playback. Use the voice button and try again."),
      );
    }
  })
);

export interface SpeechPlaybackRequest {
  markdown: string;
  messageId: string;
  projectId: string | null;
}

export interface SpeechPlaybackController {
  activeMessageId: string | null;
  error: string | null;
  play: (request: SpeechPlaybackRequest) => Promise<void>;
  stop: () => void;
}

/** Owns one audio channel for a transcript surface. Starting another clip
 * cancels in-flight synthesis and stops the previous clip before playback. */
export const useSpeechPlayback = (): SpeechPlaybackController => {
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const currentRunRef = useRef<SpeechPlaybackRun | null>(null);

  const stop = useCallback((): void => {
    const currentRun = currentRunRef.current;
    currentRunRef.current = null;
    if (currentRun) cancelPlaybackRun(currentRun);
    setActiveMessageId(null);
    setError(null);
  }, []);

  const play = useCallback(async ({ markdown, messageId, projectId }: SpeechPlaybackRequest): Promise<void> => {
    const text = speechTextFromMarkdown(markdown);
    const chunks = splitSpeechPlaybackText(text);
    if (chunks.length === 0) return;

    stop();
    const run: SpeechPlaybackRun = {
      abortController: new AbortController(),
      activeAudio: null,
      activeUrl: null,
      cancelled: false,
      settleAudio: null,
    };
    currentRunRef.current = run;
    setActiveMessageId(messageId);

    const isCurrentRun = (): boolean => currentRunRef.current === run && !run.cancelled;
    const failRun = (playbackError: unknown, fallback: string): void => {
      if (!isCurrentRun()) return;
      currentRunRef.current = null;
      cancelPlaybackRun(run);
      setError(readPlaybackError(playbackError, fallback));
      setActiveMessageId(null);
    };
    const synthesisByIndex = new Map<number, Promise<SynthesisOutcome>>();
    const startSynthesis = (index: number): void => {
      if (!isCurrentRun() || synthesisByIndex.has(index) || index >= chunks.length) return;
      const synthesis = synthesizeSpeech(
        chunks[index],
        projectId,
        undefined,
        run.abortController.signal,
      ).then(
        (blob): SynthesisOutcome => ({ blob }),
        (synthesisError): SynthesisOutcome => {
          failRun(synthesisError, "Speech synthesis failed.");
          return { error: synthesisError };
        },
      );
      synthesisByIndex.set(index, synthesis);
    };
    const prefetchAfter = (index: number): void => {
      const lastPrefetchIndex = Math.min(chunks.length - 1, index + SPEECH_PREFETCH_AHEAD);
      for (let prefetchIndex = index + 1; prefetchIndex <= lastPrefetchIndex; prefetchIndex += 1) {
        startSynthesis(prefetchIndex);
      }
    };

    // Only the first sentence is requested before playback. Later chunks begin
    // synthesizing once the current audio has started, bounded by the lookahead.
    startSynthesis(0);

    try {
      for (let index = 0; index < chunks.length; index += 1) {
        const synthesis = synthesisByIndex.get(index);
        if (!synthesis) return;
        const synthesisOutcome = await synthesis;
        synthesisByIndex.delete(index);
        if (!isCurrentRun() || !synthesisOutcome.blob) return;

        const audioOutcomePromise = playAudioBlob(run, synthesisOutcome.blob);
        prefetchAfter(index);
        const audioOutcome = await audioOutcomePromise;
        if (!isCurrentRun()) return;
        if (!audioOutcome.completed) {
          failRun(audioOutcome.error, "The browser could not play the generated audio.");
          return;
        }
      }
    } catch (playbackError) {
      failRun(playbackError, "Speech playback failed.");
    } finally {
      if (currentRunRef.current === run) {
        currentRunRef.current = null;
        setActiveMessageId(null);
      }
    }
  }, [stop]);

  useEffect(() => () => {
    const currentRun = currentRunRef.current;
    currentRunRef.current = null;
    if (currentRun) cancelPlaybackRun(currentRun);
  }, []);

  return { activeMessageId, error, play, stop };
};
