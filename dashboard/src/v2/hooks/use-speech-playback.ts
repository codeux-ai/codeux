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
  play: (request: SpeechPlaybackRequest) => Promise<void>;
  stop: () => void;
}

/** Owns one audio channel for a transcript surface. Starting another clip
 * cancels in-flight synthesis and stops the previous clip before playback. */
export const useSpeechPlayback = (): SpeechPlaybackController => {
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
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

        const completed = await new Promise<boolean>((resolve) => {
          const url = URL.createObjectURL(audioBlob);
          audioUrlRef.current = url;
          const audio = new Audio(url);
          audioRef.current = audio;
          let settled = false;
          const finish = (playedToEnd: boolean): void => {
            if (settled) return;
            settled = true;
            if (audioUrlRef.current === url) {
              URL.revokeObjectURL(url);
              audioUrlRef.current = null;
            }
            if (audioRef.current === audio) audioRef.current = null;
            settleAudioRef.current = null;
            resolve(playedToEnd);
          };
          settleAudioRef.current = () => finish(false);
          audio.onended = () => finish(true);
          audio.onerror = () => finish(false);
          void audio.play().catch(() => finish(false));
        });
        if (!completed || requestSequence !== requestSequenceRef.current) return;
      }
    } catch {
      // Playback is optional; the visible transcript remains the source of truth.
    } finally {
      if (requestSequence === requestSequenceRef.current) setActiveMessageId(null);
    }
  }, [stop]);

  useEffect(() => stop, [stop]);

  return { activeMessageId, play, stop };
};
