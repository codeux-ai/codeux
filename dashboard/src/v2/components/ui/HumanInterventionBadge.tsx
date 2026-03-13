import type { FunctionComponent } from "preact";
import { AlertTriangle } from "lucide-preact";
import type { ExecutionHumanInterventionSummary } from "../../../types.js";
import { formatHumanInterventionTooltip } from "../../../lib/execution-intervention.js";

interface HumanInterventionBadgeProps {
  summary: ExecutionHumanInterventionSummary;
  label?: string;
  compact?: boolean;
  align?: "left" | "center" | "right";
}

export const HumanInterventionBadge: FunctionComponent<HumanInterventionBadgeProps> = ({
  summary,
  label = "Needs you",
  compact = false,
  align = "center",
}) => {
  const tooltipAlignment = align === "left"
    ? "left-0"
    : align === "right"
      ? "right-0"
      : "left-1/2 -translate-x-1/2";

  return (
    <div className="group/intervention relative inline-flex" title={formatHumanInterventionTooltip(summary)}>
      <div
        className={`inline-flex items-center gap-1.5 rounded-full border border-status-amber/25 bg-status-amber/12 text-status-amber shadow-[0_10px_24px_rgba(245,158,11,0.12)] ${
          compact ? "px-2.5 py-1 text-[10px]" : "px-3 py-1.5 text-[10px]"
        } font-bold uppercase tracking-[0.14em]`}
      >
        <AlertTriangle className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} strokeWidth={2.2} />
        <span>{label}</span>
      </div>

      <div
        className={`pointer-events-none absolute top-[calc(100%+0.75rem)] z-40 w-80 max-w-[80vw] rounded-[1.3rem] border border-status-amber/20 bg-white/94 p-4 text-left shadow-[0_20px_44px_rgba(15,23,42,0.14)] backdrop-blur-xl opacity-0 transition-all duration-200 group-hover/intervention:translate-y-0 group-hover/intervention:opacity-100 dark:border-status-amber/20 dark:bg-void-800/94 ${
          compact ? "translate-y-1" : "translate-y-2"
        } ${tooltipAlignment}`}
      >
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-status-amber">
          <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2.1} />
          Human Intervention
        </div>
        <div className="mt-2 text-sm font-semibold tracking-tight text-slate-900 dark:text-white">
          {summary.title}
        </div>
        <p className="mt-2 text-[12px] leading-relaxed text-slate-600 dark:text-slate-300">
          {summary.reason}
        </p>
        <div className="mt-3 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
          What to do
        </div>
        <p className="mt-1 text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">
          {summary.instructions}
        </p>
      </div>
    </div>
  );
};
