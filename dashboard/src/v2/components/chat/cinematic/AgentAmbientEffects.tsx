import type { FunctionComponent } from "preact";
import type { AgentAmbientCue } from "./use-agent-mood.js";

export interface AgentAmbientEffectsProps {
  cue: AgentAmbientCue | null;
  motionEnabled: boolean;
}

/**
 * Decorative stage dressing for one bounded idle cue. The visible label is
 * deliberately outside a live region so recurring idle beats do not produce
 * repeated screen-reader announcements; the avatar's stable mood caption
 * remains the semantic status source.
 */
export const AgentAmbientEffects: FunctionComponent<AgentAmbientEffectsProps> = ({ cue, motionEnabled }) => {
  if (!cue || !motionEnabled) return null;

  return (
    <div
      className="pointer-events-none absolute inset-0 z-20"
      data-testid="agent-ambient-effects"
      data-cue={cue.kind}
    >
      <div
        className="stage-cue-label absolute left-1/2 top-[10%] -translate-x-1/2 rounded-full border border-signal-500/20 bg-white/85 px-3 py-1.5 text-[11px] font-semibold text-slate-600 shadow-lg backdrop-blur-md dark:bg-void-800/85 dark:text-slate-300"
        data-testid="agent-ambient-cue-label"
      >
        {cue.label}
      </div>
      <div aria-hidden="true" className="absolute inset-0">
        <span className="stage-cue-spark absolute left-[27%] top-[32%] text-sm text-signal-500/70">✦</span>
        <span className="stage-cue-spark absolute right-[27%] top-[25%] text-[10px] text-purple-400/70 [animation-delay:180ms]">✦</span>
        {cue.showNotes && (
          <div data-testid="agent-ambient-notes">
            <span className="stage-music-note absolute left-[31%] top-[42%] text-lg text-signal-500">♪</span>
            <span className="stage-music-note absolute right-[31%] top-[35%] text-xl text-purple-400 [animation-delay:240ms]">♫</span>
            <span className="stage-music-note absolute right-[27%] top-[47%] text-sm text-signal-400 [animation-delay:480ms]">♪</span>
          </div>
        )}
      </div>
    </div>
  );
};
