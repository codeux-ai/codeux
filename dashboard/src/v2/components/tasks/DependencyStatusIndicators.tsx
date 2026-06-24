import type { FunctionComponent } from "preact";
import { memo } from "preact/compat";
import { ArrowRight } from "lucide-preact";
import type { DependencyIndicator } from "../../lib/tasks/task-card-view-model.js";

export const DependencyStatusIndicators: FunctionComponent<{
  indicators: DependencyIndicator[];
}> = memo(({ indicators }) => {
  if (!indicators || indicators.length === 0) return null;

  return (
    <div className="relative z-10 mt-3 flex flex-wrap gap-1.5">
      {indicators.map((dep) => (
        <div
          key={dep.recordId}
          className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[9px] font-bold uppercase tracking-[0.14em] ${
            dep.status === "completed"
              ? "bg-status-green/[0.08] border-status-green/20 text-status-green"
              : dep.status === "QA_REVIEW_FAILED"
              ? "bg-red-500/[0.08] border-red-500/20 text-red-500"
              : dep.status === "coding_completed" || dep.status === "in_progress"
              ? "bg-signal-500/[0.08] border-signal-500/20 text-signal-500"
              : "bg-slate-400/[0.08] border-slate-400/20 text-slate-500"
          }`}
          title={`Depends on ${dep.title} (${dep.status})`}
        >
          <span className="sr-only">Depends on task {dep.id}, status: {dep.status.replace('_', ' ')}. Title: {dep.title}</span>
          <ArrowRight className="w-2.5 h-2.5" strokeWidth={2.5} aria-hidden="true" />
          <span aria-hidden="true">{dep.id}</span>
        </div>
      ))}
    </div>
  );
});
