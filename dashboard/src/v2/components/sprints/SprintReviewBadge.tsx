import type { FunctionComponent } from "preact";
import { useState, useRef } from "preact/hooks";
import { CheckCircle2, ListChecks, ChevronRight, Loader2  } from "lucide-preact";
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
  const [findingsOpen, setFindingsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltipStyle, setTooltipStyle] = useState<{ top?: number, left?: number, right?: number, bottom?: number }>({});

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

  const [dynamicAlign, setDynamicAlign] = useState<"left" | "center" | "right">(align);

  const handleMouseEnter = (e: MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const tooltipWidth = summary.findings && summary.findings.length > 0 ? 680 : 320;

    const spaceRight = window.innerWidth - rect.left;
    const spaceLeft = rect.right;

    let newAlign = align;
    if (spaceRight < tooltipWidth && spaceLeft >= tooltipWidth) {
      newAlign = "right";
    } else if (spaceLeft < tooltipWidth && spaceRight >= tooltipWidth) {
      newAlign = "left";
    }

    setDynamicAlign(newAlign);

    const style: { bottom: number, left?: number, right?: number } = {
      bottom: window.innerHeight - rect.top,
    };

    if (newAlign === "left") {
      style.left = rect.left;
    } else if (newAlign === "right") {
      style.right = window.innerWidth - rect.right;
    } else {
      style.left = rect.left + rect.width / 2;
    }

    setTooltipStyle(style);
  };

  const tooltipAlignment = dynamicAlign === "left"
    ? ""
    : dynamicAlign === "right"
      ? ""
      : "-translate-x-1/2";

  return (
    <div
      ref={containerRef}
      className="group/review relative inline-flex"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => {
        setFindingsOpen(false);
        setDynamicAlign(align);
      }}
    >
      <div
        className={`inline-flex items-center gap-1.5 rounded-full border border-signal-500/30 bg-gradient-to-r from-signal-500/15 via-signal-400/10 to-signal-500/15 backdrop-blur-md shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_0_12px_rgba(0,224,160,0.15)] text-signal-600 ${
          compact ? "px-2.5 py-1 text-[10px]" : "px-3 py-1.5 text-[10px]"
        } font-bold uppercase tracking-[0.16em] dark:text-signal-300 transition-colors duration-300 hover:border-signal-500/50`}
      >
        <CheckCircle2 className={`${compact ? "h-3 w-3" : "h-3.5 w-3.5"} transition-transform duration-300 group-hover/review:scale-110`} strokeWidth={2.5} />
        {!compact && <span>QA Reviewed</span>}
      </div>

      <div
        className={`fixed pb-3 hidden z-[99999] opacity-0 translate-y-1 transition-all duration-300 ease-out group-hover/review:block group-hover/review:opacity-100 group-hover/review:translate-y-0 ${tooltipAlignment}`}
        style={tooltipStyle}
      >
        <div
          className={`relative grid gap-4 overflow-hidden rounded-[1.5rem] border border-black/[0.08] bg-white p-4 shadow-[0_20px_48px_rgba(15,23,42,0.16),0_0_0_1px_rgba(0,0,0,0.04)] before:absolute before:inset-x-0 before:top-0 before:h-[3px] before:bg-gradient-to-r before:from-signal-500 before:via-signal-400 before:to-signal-500 dark:border-white/[0.08] dark:bg-void-800 ${
            summary.findings && summary.findings.length > 0 ? "grid-cols-[20rem_18rem]" : "grid-cols-1 w-80"
          }`}
        >
        <div className="flex flex-col gap-3 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-signal-600 dark:text-signal-300">
              <CheckCircle2 className="h-4 w-4" strokeWidth={2.5} />
              QA Review Complete
            </div>
            {summary.outcome && (
              <div className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-[0.14em] ${
                summary.outcome.toLowerCase() === "pass" || summary.outcome.toLowerCase() === "passed"
                  ? "bg-signal-500/10 text-signal-600 dark:text-signal-400 border border-signal-500/20"
                  : "bg-ember-500/10 text-ember-600 dark:text-ember-400 border border-ember-500/20"
              }`}>
                {summary.outcome}
              </div>
            )}
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

        {summary.findings && summary.findings.length > 0 && (
          <div className="flex flex-col gap-2 border-l border-black/[0.08] pl-4 dark:border-white/[0.08] min-h-0">
            <div className="flex w-full items-center justify-between rounded-xl border border-black/[0.06] bg-black/[0.02] p-3 text-left dark:border-white/[0.06] dark:bg-white/[0.02]">
              <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-600 dark:text-slate-300">
                <ListChecks className="h-3.5 w-3.5 text-signal-500" />
                {summary.findings.length} Findings
              </div>
            </div>

            <ul className="flex max-h-[16rem] flex-col gap-1 overflow-y-auto pr-2 dropdown-scrollbar">
              {summary.findings.map((finding, idx) => (
                <li key={idx} className="flex items-start gap-1.5 rounded-lg p-1.5 even:bg-slate-50/50 dark:even:bg-void-700/30">
                  <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-signal-500" strokeWidth={3} />
                  <span className="text-xs leading-snug text-slate-600 break-words dark:text-slate-400">{finding}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        </div>
      </div>
    </div>
  );
};
