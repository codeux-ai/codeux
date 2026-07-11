import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { synthesizeSpeech } from "../lib/speech-api.js";
import { speechTextFromMarkdown, splitSpeechPlaybackText } from "../lib/speech-playback.js";

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
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const settleAudioRef = useRef<(() => void) | null>(null);
  const requestSequenceRef = useRef(0);

  const stop = useCallback((): void => {
    requestSequenceRef.current += 1;
    audioRef.current?.pause();
    settleAudioRef.current?.();
    settleAudioRef.current = null;
    audioRef.current = null;
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    setActiveMessageId(null);
    setError(null);
  }, []);

  const play = useCallback(async ({ markdown, messageId, projectId }: SpeechPlaybackRequest): Promise<void> => {
    const text = speechTextFromMarkdown(markdown);
    const chunks = splitSpeechPlaybackText(text);
    if (chunks.length === 0) return;

    stop();
    const requestSequence = requestSequenceRef.current;
    setActiveMessageId(messageId);

    try {
      for (const chunk of chunks) {
        const audioBlob = await synthesizeSpeech(chunk, projectId);
        if (requestSequence !== requestSequenceRef.current) return;

        const outcome = await new Promise<{ completed: boolean; error?: string }>((resolve) => {
          const url = URL.createObjectURL(audioBlob);
          audioUrlRef.current = url;
          const audio = new Audio(url);
          audioRef.current = audio;
          let settled = false;
          const finish = (playedToEnd: boolean, playbackError?: string): void => {
            if (settled) return;
            settled = true;
            if (audioUrlRef.current === url) {
              URL.revokeObjectURL(url);
              audioUrlRef.current = null;
            }
            if (audioRef.current === audio) audioRef.current = null;
            settleAudioRef.current = null;
            resolve({ completed: playedToEnd, error: playbackError });
          };
          settleAudioRef.current = () => finish(false);
          audio.onended = () => finish(true);
          audio.onerror = () => finish(false, "The browser could not play the generated audio.");
          void audio.play().catch((playbackError: unknown) => finish(
            false,
            playbackError instanceof Error && playbackError.message
              ? playbackError.message
              : "The browser blocked audio playback. Use the voice button and try again.",
          ));
        });
        if (!outcome.completed || requestSequence !== requestSequenceRef.current) {
          if (outcome.error && requestSequence === requestSequenceRef.current) setError(outcome.error);
          return;
        }
      }
    } catch (playbackError) {
      if (requestSequence === requestSequenceRef.current) {
        setError(playbackError instanceof Error && playbackError.message
          ? playbackError.message
          : "Speech synthesis failed.");
      }
    } finally {
      if (requestSequence === requestSequenceRef.current) setActiveMessageId(null);
    }
  }, [stop]);

  useEffect(() => stop, [stop]);

  return { activeMessageId, error, play, stop };
};
