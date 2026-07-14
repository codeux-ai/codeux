import type { FunctionComponent } from "preact";
import { memo } from "preact/compat";
import { Clock, Settings, Cpu, User } from "lucide-preact";
import type { TaskExecutorType } from "../../types.js";
import { useInteractionTokens } from "../../lib/motion/tokens.js";
import { useOptionalDashboardI18n } from "../../i18n/context.js";
import { taskMessages } from "../../i18n/messages/tasks.js";

export interface TaskExecutionMetaProps {
  time?: string;
  executorType?: TaskExecutorType;
  executionMode?: string;
  className?: string;
}

export const TaskExecutionMeta: FunctionComponent<TaskExecutionMetaProps> = memo(({
  time,
  executorType,
  executionMode,
  className = "",
}) => {
  const interactionTokens = useInteractionTokens();
  const { translate } = useOptionalDashboardI18n();
  const getExecutorIcon = () => {
    switch (executorType) {
      case "docker_cli":
      case "auto":
        return <Cpu className="w-3 h-3" strokeWidth={2} aria-hidden="true" />;
      case "jules":
        return <User className="w-3 h-3" strokeWidth={2} aria-hidden="true" />;
      default:
        return <Cpu className="w-3 h-3" strokeWidth={2} aria-hidden="true" />;
    }
  };

  const getExecutorLabel = () => {
    switch (executorType) {
      case "docker_cli": return "CLI";
      case "jules": return "Jules";
      case "auto": return "Auto";
      default: return "Auto";
    }
  };

  const durationLabel = time || translate(taskMessages, "notStarted");
  const executorLabel = getExecutorLabel();
  const modeLabel = executionMode || translate(taskMessages, "standard");
  const runtimeAvailabilityLabel = time
    ? translate(taskMessages, "runtimeAvailable", { duration: durationLabel })
    : translate(taskMessages, "runtimeNotStarted");
  const showExecutorVisibly = executorType !== "auto" && executorType !== undefined;

  return (
    <div
      className={`flex flex-wrap gap-2.5 items-center text-xs font-medium text-slate-500 dark:text-slate-400 ${className}`}
      role="list"
      aria-label={translate(taskMessages, "executionMetadata")}
      aria-busy="false"
      aria-live="polite"
      style={{
        "--task-meta-control-duration": interactionTokens.controlFeedback.duration,
        "--task-meta-control-ease": interactionTokens.controlFeedback.ease,
        "--task-meta-selection-duration": interactionTokens.selectionMovement.duration,
        "--task-meta-selection-ease": interactionTokens.selectionMovement.ease,
      }}
      data-motion-control="controlFeedback"
      data-motion-selection="selectionMovement"
    >
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {translate(taskMessages, "executionAnnouncement", { runtime: runtimeAvailabilityLabel, executor: executorLabel, mode: modeLabel })}
      </span>
      <div
        className="flex min-h-7 min-w-[8.75rem] max-w-full items-center gap-1.5 bg-black/[0.03] dark:bg-white/[0.03] px-2 py-0.5 rounded-full border border-black/[0.06] dark:border-white/[0.08] transition-colors duration-[var(--task-meta-control-duration)] ease-[var(--task-meta-control-ease)]"
        role="listitem"
        aria-label={`${translate(taskMessages, "duration")}: ${durationLabel}`}
      >
        <Clock className="w-3 h-3" strokeWidth={2} aria-hidden="true" />
        <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">{translate(taskMessages, "duration")}</span>
        <span className="min-w-0 break-words font-mono" aria-live="polite">{durationLabel}</span>
      </div>

      <div
        className="flex min-h-7 min-w-[6.25rem] max-w-full items-center gap-1.5 bg-black/[0.03] dark:bg-white/[0.03] px-2 py-0.5 rounded-full border border-black/[0.06] dark:border-white/[0.08] transition-colors duration-[var(--task-meta-control-duration)] ease-[var(--task-meta-control-ease)]"
        role="listitem"
        aria-label={`${translate(taskMessages, "executor")}: ${executorLabel}`}
      >
        {getExecutorIcon()}
        <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">{translate(taskMessages, "executor")}</span>
        <span className={showExecutorVisibly ? "min-w-0 break-words" : "sr-only"}>{executorLabel}</span>
      </div>

      <div
        className="flex min-h-7 min-w-[7rem] max-w-full items-center gap-1.5 bg-black/[0.03] dark:bg-white/[0.03] px-2 py-0.5 rounded-full border border-black/[0.06] dark:border-white/[0.08] transition-colors duration-[var(--task-meta-control-duration)] ease-[var(--task-meta-control-ease)]"
        role="listitem"
        aria-label={`${translate(taskMessages, "mode")}: ${modeLabel}`}
      >
        <Settings className="w-3 h-3" strokeWidth={2} aria-hidden="true" />
        <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">{translate(taskMessages, "mode")}</span>
        <span className="min-w-0 break-words capitalize">{modeLabel}</span>
      </div>
    </div>
  );
});
