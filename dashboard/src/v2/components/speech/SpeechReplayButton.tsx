import type { FunctionComponent } from "preact";
import { RotateCcw } from "lucide-preact";

export interface SpeechReplayButtonProps {
  busy?: boolean;
  label: string;
  onReplay: () => void;
}

/** Intentionally quiet transcript action: discoverable to pointer, keyboard,
 * and assistive-technology users without competing with message content. */
export const SpeechReplayButton: FunctionComponent<SpeechReplayButtonProps> = ({
  busy = false,
  label,
  onReplay,
}) => (
  <button
    type="button"
    aria-label={label}
    aria-busy={busy}
    title={label}
    onClick={onReplay}
    className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-black/[0.05] hover:text-signal-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 dark:text-slate-500 dark:hover:bg-white/[0.07] dark:hover:text-signal-300"
  >
    <RotateCcw className={`h-2.5 w-2.5 ${busy ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden="true" />
  </button>
);
