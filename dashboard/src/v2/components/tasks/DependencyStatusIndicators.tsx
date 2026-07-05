import type { FunctionComponent } from "preact";
import { memo } from "preact/compat";
import { ArrowRight } from "lucide-preact";
import { getDependencyPresentation, type DependencyIndicator } from "../../lib/tasks/task-card-view-model.js";

function getDependencyStatusCopy(dep: DependencyIndicator): string {
  if (dep.stateLabel) {
    return dep.stateLabel;
  }

  if (dep.isKnown === false || dep.title.startsWith("Unknown Task")) {
    return "Unknown";
  }

  switch (dep.status) {
    case "completed":
      return "Resolved";
    case "coding_completed":
      return "Ready for QA";
    case "in_progress":
      return "In progress";
    case "QA_REVIEW_FAILED":
      return "QA failed";
    case "pending":
    default:
      return "Blocked";
  }
}

function isDependencyBlocking(dep: DependencyIndicator): boolean {
  return dep.isBlocking ?? dep.status !== "completed";
}

function getDependencyToneClass(dep: DependencyIndicator): string {
  if (dep.isKnown === false || dep.title.startsWith("Unknown Task")) {
    return "bg-slate-400/[0.08] border-slate-400/30 text-slate-600 dark:text-slate-300 border-dashed";
  }

  switch (dep.status) {
    case "completed":
      return "bg-status-green/[0.08] border-status-green/20 text-status-green";
    case "QA_REVIEW_FAILED":
      return "bg-status-red/[0.08] border-status-red/25 text-status-red";
    case "coding_completed":
      return "bg-cyan-500/[0.08] border-cyan-500/25 text-cyan-700 dark:text-cyan-400";
    case "in_progress":
      return "bg-signal-500/[0.08] border-signal-500/20 text-signal-600 dark:text-signal-400";
    case "pending":
    default:
      return "bg-status-amber/[0.08] border-status-amber/25 text-status-amber";
  }
}

export const DependencyStatusIndicators: FunctionComponent<{
  indicators: DependencyIndicator[];
}> = memo(({ indicators }) => {
  if (!indicators || indicators.length === 0) return null;

  const blockerCount = indicators.filter(isDependencyBlocking).length;
  const summary = blockerCount === 0
    ? `Dependencies resolved: ${indicators.length} clear`
    : `Blocked: ${blockerCount} ${blockerCount === 1 ? "dependency needs" : "dependencies need"} completion`;

  return (
    <div
      className="relative z-10 mt-3 flex flex-wrap items-center gap-1.5"
      role="list"
      aria-label={`${summary}. Task dependencies`}
      aria-live="polite"
    >
      <div
        role="listitem"
        className={`flex min-h-7 max-w-full items-center gap-1.5 rounded-lg border px-2 py-1 text-[9px] font-bold uppercase tracking-[0.12em] ${
          blockerCount === 0
            ? "border-status-green/20 bg-status-green/[0.08] text-status-green"
            : "border-status-amber/25 bg-status-amber/[0.08] text-status-amber"
        }`}
        aria-label={summary}
      >
        {summary}
      </div>
      {indicators.map((dep) => {
        const statusText = dep.status.replace(/_/g, ' ');
        const statusCopy = getDependencyStatusCopy(dep);
        const stateDescription = dep.stateDescription ?? getDependencyPresentation(dep.status, dep.isKnown !== false && !dep.title.startsWith("Unknown Task")).stateDescription;
        const containerClass = getDependencyToneClass(dep);

        return (
          <div
            key={dep.recordId}
            role="listitem"
            className={`flex min-h-7 max-w-full items-center gap-1.5 rounded-lg border px-2 py-1 text-[9px] font-bold uppercase tracking-[0.12em] ${containerClass}`}
            title={`Depends on ${dep.title} (${statusCopy}; ${statusText})`}
            aria-label={`Depends on task ${dep.id}, ${statusCopy.toLowerCase()}. ${stateDescription}. Status: ${statusText}. Title: ${dep.title}`}
          >
            <span className="sr-only">Depends on task {dep.id}, {statusCopy.toLowerCase()}. {stateDescription}. Status: {statusText}. Title: {dep.title}</span>
            <ArrowRight className="w-2.5 h-2.5" strokeWidth={2.5} aria-hidden="true" />
            <span aria-hidden="true" className="shrink-0">{dep.id}</span>
            <span aria-hidden="true" className="rounded-full bg-current/10 px-1.5 py-0.5 text-[8px] opacity-90">{statusCopy}</span>
            <span aria-hidden="true" className="min-w-0 max-w-[9rem] truncate text-[8px] normal-case opacity-80">{dep.title}</span>
          </div>
        );
      })}
    </div>
  );
});
