import type { FunctionComponent } from "preact";
import { Loader2, Pause, Play, Square } from "lucide-preact";
import { useInteractionTokens } from "../../lib/motion/tokens.js";
import { useDashboardI18n } from "../../i18n/index.js";
import { sprintsMessages } from "../../i18n/messages/sprints.js";

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

export const SprintControls: FunctionComponent<SprintControlsProps> = ({
  isActive,
  isPaused,
  isStartStopPending,
  isPauseResumePending,
  onStartStop,
  onPauseResume,
  sprintName,
  labels,
}) => {
  const { translate } = useDashboardI18n();
  const resolvedSprintName = sprintName ?? translate(sprintsMessages, "sprint").toLocaleLowerCase();
  const resolvedLabels: SprintControlsLabels = labels ?? {
    pause: translate(sprintsMessages, "pause"),
    resume: translate(sprintsMessages, "resume"),
    start: translate(sprintsMessages, "start"),
    stop: translate(sprintsMessages, "stop"),
    pending: (action) => translate(sprintsMessages, "primaryPending", { action }),
    pendingLabel: (action, name) => translate(
      sprintsMessages,
      sprintName ? "sprintActionPending" : "sprintActionGenericPending",
      sprintName ? { action, name } : { action },
    ),
    actionLabel: (action, name) => translate(
      sprintsMessages,
      sprintName ? "sprintAction" : "sprintActionGeneric",
      sprintName ? { action, name } : { action },
    ),
    waitForAction: translate(sprintsMessages, "waitCurrentAction"),
    waitForActionTitle: translate(sprintsMessages, "waitCurrentActionNoPeriod"),
    pauseUnavailable: translate(sprintsMessages, "pauseAfterStart"),
    mustRunToPause: translate(sprintsMessages, "sprintMustRunToPause"),
    resumeExecution: translate(sprintsMessages, "resumeExecution"),
    pauseExecution: translate(sprintsMessages, "pauseExecution"),
    stopExecution: translate(sprintsMessages, "stopExecution"),
    startExecution: translate(sprintsMessages, "startExecution"),
  };
  const interactionTokens = useInteractionTokens();
  const canPauseResume = isActive || isPaused;
  const pauseResumeLabel = isPaused ? resolvedLabels.resume : resolvedLabels.pause;
  const startStopLabel = isActive ? resolvedLabels.stop : resolvedLabels.start;
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
    ? resolvedLabels.pending(pauseResumeLabel)
    : isStartStopPending
      ? resolvedLabels.pending(startStopLabel)
      : null;
  const disabledReason = isAnyPending
    ? resolvedLabels.waitForAction
    : !canPauseResume
      ? resolvedLabels.pauseUnavailable
      : null;
  const reasonId = `sprint-controls-${resolvedSprintName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-reason`;
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
            ? resolvedLabels.pendingLabel(pauseResumeLabel, resolvedSprintName)
            : isPaused
              ? resolvedLabels.actionLabel(resolvedLabels.resume, resolvedSprintName)
              : resolvedLabels.actionLabel(resolvedLabels.pause, resolvedSprintName)
        }
        aria-busy={isPauseResumePending ? "true" : undefined}
        aria-describedby={disabledReason ? reasonId : undefined}
        disabled={!canPauseResume || isAnyPending}
        title={
          isPauseResumePending || isStartStopPending
            ? resolvedLabels.waitForActionTitle
            : !canPauseResume
              ? resolvedLabels.mustRunToPause
              : isPaused
                ? resolvedLabels.resumeExecution
                : resolvedLabels.pauseExecution
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
            ? resolvedLabels.pendingLabel(startStopLabel, resolvedSprintName)
            : isActive
              ? resolvedLabels.actionLabel(resolvedLabels.stop, resolvedSprintName)
              : resolvedLabels.actionLabel(resolvedLabels.start, resolvedSprintName)
        }
        aria-busy={isStartStopPending ? "true" : undefined}
        aria-describedby={disabledReason ? reasonId : undefined}
        disabled={isAnyPending}
        title={
          isStartStopPending || isPauseResumePending
            ? resolvedLabels.waitForActionTitle
            : isActive
              ? resolvedLabels.stopExecution
              : resolvedLabels.startExecution
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
        {busyLabel ? `${busyLabel}. ${resolvedLabels.waitForAction}` : disabledReason ?? ""}
      </span>
    </>
  );
};
