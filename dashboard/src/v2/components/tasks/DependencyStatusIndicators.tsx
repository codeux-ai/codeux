import type { FunctionComponent } from "preact";
import { memo } from "preact/compat";
import { ArrowRight } from "lucide-preact";
import type { DependencyIndicator } from "../../lib/tasks/task-card-view-model.js";

function getDependencyStatusCopy(dep: DependencyIndicator): string {
  switch (dep.status) {
    case "completed":
      return "Resolved";
    case "coding_completed":
      return "Coding complete";
    case "in_progress":
      return "In progress";
    case "QA_REVIEW_FAILED":
      return "QA failed";
    case "pending":
    default:
      return "Waiting";
  }
}

export const DependencyStatusIndicators: FunctionComponent<{
  indicators: DependencyIndicator[];
}> = memo(({ indicators }) => {
  if (!indicators || indicators.length === 0) return null;

  const blockerCount = indicators.filter((dep) => dep.status !== "completed").length;
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
        const isUnknown = dep.title.startsWith("Unknown Task");
        const statusText = dep.status.replace(/_/g, ' ');
        const statusCopy = getDependencyStatusCopy(dep);

        let containerClass = "bg-slate-400/[0.08] border-slate-400/20 text-slate-500"; // default for pending
        if (isUnknown) {
          containerClass = "bg-slate-400/[0.08] border-slate-400/30 text-slate-500 border-dashed";
        } else if (dep.status === "completed") {
          containerClass = "bg-status-green/[0.08] border-status-green/20 text-status-green";
        } else if (dep.status === "QA_REVIEW_FAILED") {
          containerClass = "bg-red-500/[0.08] border-red-500/20 text-red-500";
        } else if (dep.status === "coding_completed" || dep.status === "in_progress") {
          containerClass = "bg-signal-500/[0.08] border-signal-500/20 text-signal-500";
        }

        return (
          <div
            key={dep.recordId}
            role="listitem"
            className={`flex min-h-7 max-w-full items-center gap-1.5 rounded-lg border px-2 py-1 text-[9px] font-bold uppercase tracking-[0.12em] ${containerClass}`}
            title={`Depends on ${dep.title} (${statusText})`}
            aria-label={`Depends on task ${dep.id}, ${statusCopy.toLowerCase()}. Status: ${statusText}. Title: ${dep.title}`}
          >
            <span className="sr-only">Depends on task {dep.id}, {statusCopy.toLowerCase()}. Status: {statusText}. Title: {dep.title}</span>
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
