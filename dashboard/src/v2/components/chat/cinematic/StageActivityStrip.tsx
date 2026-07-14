import type { FunctionComponent } from "preact";
import type { CinematicActivityCue } from "../../../lib/cinematic-activity.js";
import { useDashboardI18n } from "../../../i18n/context.js";
import { chatMessages } from "../../../i18n/messages/chat.js";

export interface StageActivityStripProps {
  backgroundActivityCount: number;
  backgroundCue: CinematicActivityCue | null;
  foregroundCue: CinematicActivityCue | null;
}

const toneClasses: Record<CinematicActivityCue["tone"], string> = {
  active: "bg-signal-500",
  complete: "bg-emerald-500",
  error: "bg-status-red",
};

const CueCopy: FunctionComponent<{
  cue: CinematicActivityCue;
}> = ({ cue }) => (
  <>
    <span className="flex items-center gap-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.13em] text-slate-400 dark:text-slate-500">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${toneClasses[cue.tone]}`} aria-hidden="true" />
      {cue.label}
    </span>
    <q className="mt-1 block text-[11px] font-medium leading-4 text-slate-600 no-underline dark:text-slate-300">
      {cue.quote}
    </q>
  </>
);

/** Compact thought-area activity that keeps runtime cues separate from avatar identity. */
export const StageActivityStrip: FunctionComponent<StageActivityStripProps> = ({
  backgroundActivityCount,
  backgroundCue,
  foregroundCue,
}) => {
  const { formatNumber, translate } = useDashboardI18n();
  const primaryCue = foregroundCue ?? backgroundCue;
  if (!primaryCue) return null;

  return (
    <div className="pointer-events-none absolute left-1/2 -top-1 z-20 w-[min(78vw,280px)] -translate-x-1/2 md:top-24 md:w-[208px] md:-translate-x-[163%] lg:top-24 xl:top-24 xl:-translate-x-[165%] 2xl:-translate-x-[195%]">
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="rounded-2xl border border-black/[0.06] bg-white/92 px-3.5 py-2.5 shadow-[0_8px_32px_rgba(0,0,0,0.10)] backdrop-blur-md dark:border-white/10 dark:bg-void-800/92"
      >
        <CueCopy cue={primaryCue} />
        {foregroundCue && backgroundCue && (
          <div className="mt-2 border-t border-black/[0.05] pt-1.5 dark:border-white/[0.07]">
            <span className="block truncate font-mono text-[9px] uppercase tracking-[0.11em] text-slate-400 dark:text-slate-500">
              {translate(chatMessages, "otherActive", { count: formatNumber(backgroundActivityCount), label: backgroundCue.label })}
            </span>
          </div>
        )}
        {primaryCue.tone === "active" && (
          <span aria-hidden="true" className="mt-1.5 flex items-center gap-0.5">
            <span className="stage-thinking-dot h-1 w-1 rounded-full bg-signal-500 motion-reduce:animate-none" />
            <span className="stage-thinking-dot h-1 w-1 rounded-full bg-signal-500 [animation-delay:150ms] motion-reduce:animate-none" />
            <span className="stage-thinking-dot h-1 w-1 rounded-full bg-signal-500 [animation-delay:300ms] motion-reduce:animate-none" />
          </span>
        )}
      </div>
      <div aria-hidden="true" className="ml-6 mt-1 h-2.5 w-2.5 rounded-full border border-black/[0.05] bg-white/90 dark:border-white/10 dark:bg-void-800/90" />
      <div aria-hidden="true" className="ml-4 mt-0.5 h-1.5 w-1.5 rounded-full border border-black/[0.05] bg-white/85 dark:border-white/10 dark:bg-void-800/85" />
    </div>
  );
};
