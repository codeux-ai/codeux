import { type FunctionComponent } from "preact";
import { AlertTriangle, CheckCircle2, CircleAlert, Sparkles } from "lucide-preact";
import { ChatWidgetFrame, type ExecutionStatus } from "./ChatWidgetFrame.js";
import type { SelfReflectionCriterionState, SelfReflectionWidgetState } from "../../../lib/chat-widget-view-models.js";

export interface SelfReflectionWidgetProps {
  reflection: SelfReflectionWidgetState;
}

const stateTone = (passed: boolean | null, hasError = false): string => {
  if (hasError || passed === false) {
    return "border-status-red/30 bg-status-red/10 text-status-red";
  }
  if (passed === true) {
    return "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  }
  return "border-slate-300/60 bg-slate-200/45 text-slate-700 dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-300";
};

const frameStatus = (reflection: SelfReflectionWidgetState): ExecutionStatus => {
  if (reflection.errorMessage || reflection.passed === false) {
    return "failed";
  }
  if (reflection.passed === true) {
    return "completed";
  }
  return "queued";
};

const StateIcon: FunctionComponent<{ passed: boolean | null; hasError?: boolean }> = ({ passed, hasError = false }) => {
  if (hasError) {
    return <CircleAlert className="h-3.5 w-3.5" aria-hidden="true" />;
  }
  if (passed === true) {
    return <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />;
  }
  if (passed === false) {
    return <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />;
  }
  return <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />;
};

const StarRating: FunctionComponent<{ criterion: SelfReflectionCriterionState }> = ({ criterion }) => {
  const filled = criterion.starRating ?? 0;

  return (
    <span
      role="img"
      aria-label={criterion.starLabel}
      className="inline-flex shrink-0 items-center gap-0.5 font-mono text-[13px] leading-none text-amber-500"
    >
      {Array.from({ length: 5 }, (_, index) => (
        <span key={index} aria-hidden="true" className={index < filled ? "text-amber-500" : "text-slate-300 dark:text-slate-600"}>
          {index < filled ? "★" : "☆"}
        </span>
      ))}
    </span>
  );
};

const ReflectionCriterionCard: FunctionComponent<{ criterion: SelfReflectionCriterionState }> = ({ criterion }) => (
  <li className="min-w-0 rounded-lg border border-black/[0.05] bg-white/65 p-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
    <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="break-words text-[13px] font-semibold text-slate-900 dark:text-slate-100">{criterion.label}</div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
          <StarRating criterion={criterion} />
          <span className="font-mono font-semibold tabular-nums text-slate-700 dark:text-slate-200">{criterion.scoreLabel}</span>
          <span>{criterion.thresholdLabel}</span>
        </div>
      </div>
      <span className={`inline-flex w-fit shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-bold ${stateTone(criterion.passed)}`}>
        <StateIcon passed={criterion.passed} />
        <span>{criterion.stateLabel}</span>
      </span>
    </div>

    {criterion.rationale ? (
      <p className="mt-2 whitespace-pre-wrap break-words text-[12.5px] leading-6 text-slate-600 dark:text-slate-300">
        {criterion.rationale}
      </p>
    ) : null}

    {criterion.improvementInstructions ? (
      <div className="mt-2 rounded-md border border-status-amber/25 bg-status-amber/10 px-2.5 py-2 text-[12px] leading-5 text-slate-700 dark:text-slate-200">
        <span className="font-semibold text-status-amber">Improvement: </span>
        <span className="whitespace-pre-wrap break-words">{criterion.improvementInstructions}</span>
      </div>
    ) : null}
  </li>
);

export const SelfReflectionWidget: FunctionComponent<SelfReflectionWidgetProps> = ({ reflection }) => (
  <ChatWidgetFrame
    status={frameStatus(reflection)}
    header={
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Reflection</span>
        <span className="min-w-0 break-words font-semibold text-slate-800 dark:text-slate-100">{reflection.purposeLabel}</span>
      </div>
    }
  >
    <section aria-label={reflection.ariaLabel} className="min-w-0 space-y-3">
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex w-fit items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-bold ${stateTone(reflection.passed, Boolean(reflection.errorMessage))}`}>
              <StateIcon passed={reflection.passed} hasError={Boolean(reflection.errorMessage)} />
              <span>{reflection.stateLabel}</span>
            </span>
            {reflection.attemptLabel ? (
              <span className="rounded-md border border-black/[0.06] bg-black/[0.025] px-2 py-1 font-mono text-[11px] font-semibold text-slate-500 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-400">
                {reflection.attemptLabel}
              </span>
            ) : null}
          </div>
          {reflection.finalDecisionLabel ? (
            <div className="break-words text-[12.5px] text-slate-600 dark:text-slate-300">
              Final decision: <span className="font-semibold text-slate-800 dark:text-slate-100">{reflection.finalDecisionLabel}</span>
            </div>
          ) : null}
        </div>
      </div>

      {reflection.errorMessage ? (
        <div role="alert" className="rounded-lg border border-status-red/25 bg-status-red/10 px-3 py-2 text-[12.5px] leading-6 text-slate-700 dark:text-slate-200">
          <span className="font-semibold text-status-red">Reflection error: </span>
          <span className="whitespace-pre-wrap break-words">{reflection.errorMessage}</span>
        </div>
      ) : null}

      {reflection.criteria.length > 0 ? (
        <ul className="space-y-2">
          {reflection.criteria.map((criterion) => (
            <ReflectionCriterionCard key={criterion.id} criterion={criterion} />
          ))}
        </ul>
      ) : (
        <div className="rounded-lg border border-dashed border-black/[0.08] px-3 py-2 text-[12.5px] text-slate-500 dark:border-white/[0.08] dark:text-slate-400">
          No criterion scores were recorded for this reflection.
        </div>
      )}
    </section>
  </ChatWidgetFrame>
);
