import type { FunctionComponent } from "preact";
import { CheckCircle2, Loader2 } from "lucide-preact";
import type { SprintReviewSummary } from "../../types.js";

interface SprintReviewBadgeProps {
  summary: SprintReviewSummary;
  compact?: boolean;
  align?: "left" | "center" | "right";
}

export const SprintReviewBadge: FunctionComponent<SprintReviewBadgeProps> = ({
  summary,
  compact = false,
  align = "center",
}) => {
  if (summary.status === 'running') {
    return (
      <div className="relative inline-flex animate-pulse">
        <div
          className={`inline-flex items-center gap-1.5 rounded-full border border-signal-500/20 bg-signal-500/8 text-signal-600 shadow-[0_10px_24px_rgba(0,224,160,0.12)] ${
            compact ? "px-2.5 py-1 text-[10px]" : "px-3 py-1.5 text-[10px]"
          } font-bold uppercase tracking-[0.14em] dark:text-signal-300`}
        >
          <Loader2 className={`animate-spin ${compact ? "h-3 w-3" : "h-3.5 w-3.5"}`} strokeWidth={2.5} />
          {!compact && <span>Reviewing...</span>}
        </div>
      </div>
    );
  }

  const tooltipAlignment = align === "left"
    ? "left-0"
    : align === "right"
      ? "right-0"
      : "left-1/2 -translate-x-1/2";

  return (
    <div className="group/review relative inline-flex">
      <div
        className={`inline-flex items-center gap-1.5 rounded-full border border-signal-500/25 bg-signal-500/12 text-signal-600 shadow-[0_10px_24px_rgba(0,224,160,0.12)] ${
          compact ? "px-2.5 py-1 text-[10px]" : "px-3 py-1.5 text-[10px]"
        } font-bold uppercase tracking-[0.14em] dark:text-signal-300`}
      >
        <CheckCircle2 className={`${compact ? "h-3 w-3" : "h-3.5 w-3.5"}`} strokeWidth={2.5} />
        {!compact && <span>QA Reviewed</span>}
      </div>

      <div
        className={`absolute bottom-full mb-3 hidden w-72 flex-col gap-3 rounded-[1.25rem] border border-black/[0.08] bg-white p-4 shadow-[0_16px_36px_rgba(15,23,42,0.14)] opacity-0 transition-all duration-300 group-hover/review:flex group-hover/review:opacity-100 dark:border-white/[0.08] dark:bg-void-800 ${tooltipAlignment}`}
      >
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-signal-600 dark:text-signal-300">
          <CheckCircle2 className="h-4 w-4" strokeWidth={2.5} />
          QA Reviewed
        </div>

        {summary.summary && (
          <div className="text-sm font-medium leading-relaxed text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
            {summary.summary}
          </div>
        )}

        {summary.reviewer && (
          <div className="mt-1 flex items-center justify-between border-t border-black/[0.08] pt-3 text-[11px] font-medium text-slate-500 dark:border-white/[0.08] dark:text-slate-400">
            <span>Reviewed by {summary.reviewer}</span>
            {summary.finishedAt && (
              <span>{new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "numeric" }).format(new Date(summary.finishedAt))}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
