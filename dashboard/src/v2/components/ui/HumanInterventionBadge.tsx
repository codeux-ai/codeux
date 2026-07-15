import type { FunctionComponent } from "preact";
import { AlertTriangle, Bot } from "lucide-preact";
import type { ExecutionHumanInterventionSummary } from "../../../types.js";
import { useOptionalDashboardI18n } from "../../i18n/context.js";
import { shellMessages } from "../../i18n/messages/shell.js";
import { sprintsMessages } from "../../i18n/messages/sprints.js";

interface HumanInterventionBadgeProps {
  summary: ExecutionHumanInterventionSummary;
  label?: string;
  compact?: boolean;
  align?: "left" | "center" | "right";
}

export const HumanInterventionBadge: FunctionComponent<HumanInterventionBadgeProps> = ({
  summary,
  label,
  compact = false,
  align = "center",
}) => {
  const { translate } = useOptionalDashboardI18n();
  void align;
  const isMergeConflict = summary.attentionType === "merge_conflict";
  const isSystemStop = !isMergeConflict && (summary.ownerType === "system" || summary.ownerType === "worker");
  const displayLabel = isMergeConflict
    ? translate(sprintsMessages, "mergeConflict")
    : isSystemStop
      ? translate(sprintsMessages, "systemStopped")
      : label ?? translate(sprintsMessages, "needsYou");
  const toneClass = isMergeConflict
    ? "border-status-red/25 bg-status-red/10 text-status-red shadow-[0_10px_24px_rgba(227,0,15,0.12)]"
    : isSystemStop
      ? "border-slate-400/25 bg-slate-400/10 text-slate-600 dark:text-slate-300 shadow-[0_10px_24px_rgba(71,85,105,0.12)]"
      : "border-status-amber/25 bg-status-amber/12 text-status-amber shadow-[0_10px_24px_rgba(245,158,11,0.12)]";
  const Icon = isSystemStop ? Bot : AlertTriangle;

  return (
    <div className="inline-flex" aria-label={`${displayLabel}: ${summary.title}`}>
      <div
        className={`inline-flex items-center gap-1.5 rounded-full border ${toneClass} ${
          compact ? "px-2.5 py-1 text-[10px]" : "px-3 py-1.5 text-[10px]"
        } font-bold uppercase tracking-[0.14em]`}
      >
        <Icon className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} strokeWidth={2.2} />
        <span>{displayLabel}</span>
        <span className="sr-only">{translate(shellMessages, "notificationSeverity", { severity: summary.severity ?? "" })}</span>
      </div>
    </div>
  );
};
