import type { FunctionComponent } from "preact";
import { Loader2, Pause, Play, Square } from "lucide-preact";

export interface SprintControlsProps {
  isActive: boolean;
  isPaused: boolean;
  isStartStopPending: boolean;
  isPauseResumePending: boolean;
  onStartStop: () => void;
  onPauseResume: () => void;
}

export const SprintControls: FunctionComponent<SprintControlsProps> = ({
  isActive,
  isPaused,
  isStartStopPending,
  isPauseResumePending,
  onStartStop,
  onPauseResume,
}) => {
  const canPauseResume = isActive || isPaused;

  return (
    <>
      <button
        type="button"
        onClick={onPauseResume}
        disabled={!canPauseResume || isPauseResumePending || isStartStopPending}
        title={
          isPauseResumePending || isStartStopPending
            ? "Wait for the current action to finish"
            : !canPauseResume
              ? "Sprint must be running to pause"
              : isPaused
                ? "Resume sprint"
                : "Pause sprint"
        }
        className={`inline-flex h-10 min-w-[6.25rem] flex-1 items-center justify-center gap-2 rounded-xl border px-4 text-xs font-bold transition-colors focus-visible:ring-2 focus-visible:ring-signal-500/30 sm:flex-none ${
          isPaused
            ? "border-signal-500/20 bg-signal-500/[0.08] text-signal-600 hover:bg-signal-500/[0.12] dark:text-signal-300"
            : "border-status-amber/25 bg-status-amber/10 text-status-amber hover:bg-status-amber/15"
        } disabled:cursor-not-allowed disabled:opacity-50`}
      >
        {isPauseResumePending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.2} />
        ) : isPaused ? (
          <Play className="h-3.5 w-3.5" fill="currentColor" />
        ) : (
          <Pause className="h-3.5 w-3.5" fill="currentColor" />
        )}
        {isPauseResumePending ? (isPaused ? "Resuming..." : "Pausing...") : (isPaused ? "Resume" : "Pause")}
      </button>

      <button
        type="button"
        onClick={onStartStop}
        disabled={isStartStopPending || isPauseResumePending}
        title={
          isStartStopPending || isPauseResumePending
            ? "Wait for the current action to finish"
            : isActive
              ? "Stop sprint execution"
              : "Start sprint execution"
        }
        className={`inline-flex h-10 min-w-[6rem] flex-1 items-center justify-center gap-2 rounded-xl border px-4 text-xs font-bold transition-colors focus-visible:ring-2 focus-visible:ring-signal-500/30 sm:flex-none ${
          isActive
            ? "border-status-red/20 bg-status-red/[0.1] text-status-red hover:bg-status-red/[0.14]"
            : "border-signal-500/20 bg-signal-500/[0.08] text-signal-600 hover:bg-signal-500/[0.12] dark:text-signal-300"
        } disabled:cursor-not-allowed disabled:opacity-50`}
      >
        {isStartStopPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.2} />
        ) : isActive ? (
          <Square className="h-3.5 w-3.5" fill="currentColor" />
        ) : (
          <Play className="h-3.5 w-3.5" fill="currentColor" />
        )}
        {isStartStopPending ? (isActive ? "Stopping..." : "Starting...") : (isActive ? "Stop" : "Start")}
      </button>
    </>
  );
};
