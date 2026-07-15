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
  const getActionLabel = (action: string, pending: boolean): string => labels
    ? pending
      ? labels.pendingLabel(action, resolvedSprintName)
      : labels.actionLabel(action, resolvedSprintName)
    : sprintName
      ? translate(sprintsMessages, pending ? "sprintActionPending" : "sprintAction", { action, name: sprintName })
      : translate(sprintsMessages, pending ? "sprintActionGenericPending" : "sprintActionGeneric", { action })
  ;
  const interactionTokens = useInteractionTokens();
  const canPauseResume = isActive || isPaused;
  const pauseResumeLabel = isPaused ? labels?.resume ?? translate(sprintsMessages, "resume") : labels?.pause ?? translate(sprintsMessages, "pause");
  const startStopLabel = isActive ? labels?.stop ?? translate(sprintsMessages, "stop") : labels?.start ?? translate(sprintsMessages, "start");
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
      ? labels?.pending(pauseResumeLabel) ?? translate(sprintsMessages, "primaryPending", { action: pauseResumeLabel })
    : isStartStopPending
      ? labels?.pending(startStopLabel) ?? translate(sprintsMessages, "primaryPending", { action: startStopLabel })
      : null;
  const disabledReason = isAnyPending
    ? labels?.waitForAction ?? translate(sprintsMessages, "waitCurrentAction")
    : !canPauseResume
      ? labels?.pauseUnavailable ?? translate(sprintsMessages, "pauseAfterStart")
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
            ? getActionLabel(pauseResumeLabel, true)
            : isPaused
              ? getActionLabel(labels?.resume ?? translate(sprintsMessages, "resume"), false)
              : getActionLabel(labels?.pause ?? translate(sprintsMessages, "pause"), false)
        }
        aria-busy={isPauseResumePending ? "true" : undefined}
        aria-describedby={disabledReason ? reasonId : undefined}
        disabled={!canPauseResume || isAnyPending}
        title={
          isPauseResumePending || isStartStopPending
            ? labels?.waitForActionTitle ?? translate(sprintsMessages, "waitCurrentActionNoPeriod")
            : !canPauseResume
              ? labels?.mustRunToPause ?? translate(sprintsMessages, "sprintMustRunToPause")
              : isPaused
                ? labels?.resumeExecution ?? translate(sprintsMessages, "resumeExecution")
                : labels?.pauseExecution ?? translate(sprintsMessages, "pauseExecution")
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
            ? getActionLabel(startStopLabel, true)
            : isActive
              ? getActionLabel(labels?.stop ?? translate(sprintsMessages, "stop"), false)
              : getActionLabel(labels?.start ?? translate(sprintsMessages, "start"), false)
        }
        aria-busy={isStartStopPending ? "true" : undefined}
        aria-describedby={disabledReason ? reasonId : undefined}
        disabled={isAnyPending}
        title={
          isStartStopPending || isPauseResumePending
            ? labels?.waitForActionTitle ?? translate(sprintsMessages, "waitCurrentActionNoPeriod")
            : isActive
              ? labels?.stopExecution ?? translate(sprintsMessages, "stopExecution")
              : labels?.startExecution ?? translate(sprintsMessages, "startExecution")
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
        {busyLabel ? `${busyLabel}. ${labels?.waitForAction ?? translate(sprintsMessages, "waitCurrentAction")}` : disabledReason ?? ""}
      </span>
    </>
  );
};
