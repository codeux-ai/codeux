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
  labels?: SprintControlsLabels;
}

export interface SprintControlsLabels {
  pause: string;
  resume: string;
  start: string;
  stop: string;
  pending: (action: string) => string;
  pendingLabel: (action: string, sprintName: string) => string;
  actionLabel: (action: string, sprintName: string) => string;
  waitForAction: string;
  waitForActionTitle: string;
  pauseUnavailable: string;
  mustRunToPause: string;
  resumeExecution: string;
  pauseExecution: string;
  stopExecution: string;
  startExecution: string;
}

const DEFAULT_LABELS: SprintControlsLabels = {
  pause: "Pause",
  resume: "Resume",
  start: "Start",
  stop: "Stop",
  pending: (action) => `${action} pending`,
  pendingLabel: (action, sprintName) => `${action} ${sprintName} is pending`,
  actionLabel: (action, sprintName) => `${action} ${sprintName}`,
  waitForAction: "Wait for the current sprint action to finish.",
  waitForActionTitle: "Wait for the current sprint action to finish",
  pauseUnavailable: "Pause is available after the sprint starts.",
  mustRunToPause: "Sprint must be running to pause",
  resumeExecution: "Resume sprint execution",
  pauseExecution: "Pause sprint execution",
  stopExecution: "Stop sprint execution",
  startExecution: "Start sprint execution",
};

export const SprintControls: FunctionComponent<SprintControlsProps> = ({
  isActive,
  isPaused,
  isStartStopPending,
  isPauseResumePending,
  onStartStop,
  onPauseResume,
  sprintName = "sprint",
  labels = DEFAULT_LABELS,
}) => {
  const interactionTokens = useInteractionTokens();
  const canPauseResume = isActive || isPaused;
  const pauseResumeLabel = isPaused ? labels.resume : labels.pause;
  const startStopLabel = isActive ? labels.stop : labels.start;
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
    ? labels.pending(pauseResumeLabel)
    : isStartStopPending
      ? labels.pending(startStopLabel)
      : null;
  const disabledReason = isAnyPending
    ? labels.waitForAction
    : !canPauseResume
      ? labels.pauseUnavailable
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
            ? labels.pendingLabel(pauseResumeLabel, sprintName)
            : isPaused
              ? labels.actionLabel(labels.resume, sprintName)
              : labels.actionLabel(labels.pause, sprintName)
        }
        aria-busy={isPauseResumePending ? "true" : undefined}
        aria-describedby={disabledReason ? reasonId : undefined}
        disabled={!canPauseResume || isAnyPending}
        title={
          isPauseResumePending || isStartStopPending
            ? labels.waitForActionTitle
            : !canPauseResume
              ? labels.mustRunToPause
              : isPaused
                ? labels.resumeExecution
                : labels.pauseExecution
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
            ? labels.pendingLabel(startStopLabel, sprintName)
            : isActive
              ? labels.actionLabel(labels.stop, sprintName)
              : labels.actionLabel(labels.start, sprintName)
        }
        aria-busy={isStartStopPending ? "true" : undefined}
        aria-describedby={disabledReason ? reasonId : undefined}
        disabled={isAnyPending}
        title={
          isStartStopPending || isPauseResumePending
            ? labels.waitForActionTitle
            : isActive
              ? labels.stopExecution
              : labels.startExecution
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
        {busyLabel ? `${busyLabel}. ${labels.waitForAction}` : disabledReason ?? ""}
      </span>
    </>
  );
};
