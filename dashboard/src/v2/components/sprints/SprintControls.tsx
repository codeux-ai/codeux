import type { FunctionComponent } from "preact";
import { Loader2, Pause, Play, Square } from "lucide-preact";
import { useInteractionTokens } from "../../lib/motion/tokens.js";

export interface SprintControlsProps {
  sprintName?: string;
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
  sprintName = "sprint",
}) => {
  const interactionTokens = useInteractionTokens();
  const canPauseResume = isActive || isPaused;
  const pauseResumeLabel = isPaused ? "Resume" : "Pause";
  const startStopLabel = isActive ? "Stop" : "Start";
  const isAnyPending = isPauseResumePending || isStartStopPending;
  const controlFeedbackStyle = {
    transitionDuration: interactionTokens.controlFeedback.duration,
    transitionTimingFunction: interactionTokens.controlFeedback.ease,
  };
  const asyncFeedbackStyle = {
    transitionDuration: interactionTokens.asyncFeedback.duration,
    transitionTimingFunction: interactionTokens.asyncFeedback.ease,
  };
  const busyLabel = isPauseResumePending
    ? `${pauseResumeLabel} pending`
    : isStartStopPending
      ? `${startStopLabel} pending`
      : null;
  const disabledReason = isAnyPending
    ? "Wait for the current sprint action to finish."
    : !canPauseResume
      ? "Pause is available after the sprint starts."
      : null;
  const reasonId = `sprint-controls-${sprintName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-reason`;
  const handlePauseResume = () => {
    if (!canPauseResume || isAnyPending) {
      return;
    }
    onPauseResume();
  };
  const handleStartStop = () => {
    if (isAnyPending) {
      return;
    }
    onStartStop();
  };

  return (
    <>
      <button
        type="button"
        onClick={handlePauseResume}
        aria-label={
          isPauseResumePending
            ? `${pauseResumeLabel} ${sprintName} is pending`
            : isPaused
              ? `Resume ${sprintName}`
              : `Pause ${sprintName}`
        }
        aria-busy={isPauseResumePending ? "true" : undefined}
        aria-describedby={disabledReason ? reasonId : undefined}
        disabled={!canPauseResume || isAnyPending}
        title={
          isPauseResumePending || isStartStopPending
            ? "Wait for the current sprint action to finish"
            : !canPauseResume
              ? "Sprint must be running to pause"
              : isPaused
                ? "Resume sprint execution"
                : "Pause sprint execution"
        }
        className={`inline-flex min-h-8 min-w-[6.75rem] flex-1 flex-nowrap items-center justify-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-bold leading-tight no-underline decoration-transparent transition-colors hover:no-underline focus:no-underline focus-visible:ring-2 focus-visible:ring-signal-500/30 sm:flex-none ${
          isPaused
            ? "border-signal-500/20 bg-signal-500/[0.08] text-signal-600 hover:bg-signal-500/[0.12] dark:text-signal-300"
            : "border-status-amber/25 bg-status-amber/10 text-status-amber hover:bg-status-amber/15"
        } disabled:cursor-not-allowed disabled:opacity-50`}
        style={isPauseResumePending ? asyncFeedbackStyle : controlFeedbackStyle}
      >
        <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center">
          {isPauseResumePending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" strokeWidth={2.2} />
        ) : isPaused ? (
          <Play className="h-3.5 w-3.5" fill="currentColor" />
        ) : (
          <Pause className="h-3.5 w-3.5" fill="currentColor" />
          )}
        </span>
        <span className="inline-flex min-w-[3.75rem] justify-center">{pauseResumeLabel}</span>
      </button>

      <button
        type="button"
        onClick={handleStartStop}
        aria-label={
          isStartStopPending
            ? `${startStopLabel} ${sprintName} is pending`
            : isActive
              ? `Stop ${sprintName}`
              : `Start ${sprintName}`
        }
        aria-busy={isStartStopPending ? "true" : undefined}
        aria-describedby={disabledReason ? reasonId : undefined}
        disabled={isAnyPending}
        title={
          isStartStopPending || isPauseResumePending
            ? "Wait for the current sprint action to finish"
            : isActive
              ? "Stop sprint execution"
              : "Start sprint execution"
        }
        className={`inline-flex min-h-8 min-w-[6.75rem] flex-1 flex-nowrap items-center justify-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-bold leading-tight no-underline decoration-transparent transition-colors hover:no-underline focus:no-underline focus-visible:ring-2 focus-visible:ring-signal-500/30 sm:flex-none ${
          isActive
            ? "border-status-red/20 bg-status-red/[0.1] text-status-red hover:bg-status-red/[0.14]"
            : "border-signal-500/20 bg-signal-500/[0.08] text-signal-600 hover:bg-signal-500/[0.12] dark:text-signal-300"
        } disabled:cursor-not-allowed disabled:opacity-50`}
        style={isStartStopPending ? asyncFeedbackStyle : controlFeedbackStyle}
      >
        <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center">
          {isStartStopPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" strokeWidth={2.2} />
        ) : isActive ? (
          <Square className="h-3.5 w-3.5" fill="currentColor" />
        ) : (
          <Play className="h-3.5 w-3.5" fill="currentColor" />
          )}
        </span>
        <span className="inline-flex min-w-[3.75rem] justify-center">{startStopLabel}</span>
      </button>
      <span
        id={reasonId}
        role={busyLabel ? "status" : undefined}
        aria-live="polite"
        className={busyLabel ? "basis-full text-left text-[11px] font-bold leading-4 text-signal-600 dark:text-signal-300" : "sr-only"}
      >
        {busyLabel ? `${busyLabel}. Wait for the current sprint action to finish.` : disabledReason ?? ""}
      </span>
    </>
  );
};
