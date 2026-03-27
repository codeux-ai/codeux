import type { FunctionComponent } from "preact";
import type { SubtaskMergeIndicator } from "../../../types.js";

type StatusBadgeProps =
  | { status?: string; indicator?: never }
  | { status?: never; indicator?: SubtaskMergeIndicator };

import { AlertCircle, CheckCircle2, CircleDashed, PlayCircle, XCircle } from "lucide-preact";

const getStatusColor = (status?: string): string => {
  switch (status) {
    case "RUNNING":
      return "bg-sky-50 dark:bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-200 dark:border-sky-500/20";
    case "CODING_COMPLETED":
      return "bg-cyan-50 dark:bg-cyan-500/10 text-cyan-800 dark:text-cyan-400 border-cyan-200 dark:border-cyan-500/20";
    case "COMPLETED":
      return "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20";
    case "FAILED":
      return "bg-red-50 dark:bg-red-500/10 text-red-800 dark:text-red-400 border-red-200 dark:border-red-500/20";
    case "BLOCKED":
      return "bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-400 border-amber-200 dark:border-amber-500/20";
    case "QUOTA":
      return "bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-400 border-amber-200 dark:border-amber-500/20";
    default:
      return "bg-slate-100 dark:bg-slate-800/50 text-slate-700 dark:text-slate-400 border-slate-200 dark:border-slate-700";
  }
};

const getIndicatorColor = (indicator?: SubtaskMergeIndicator): string => {
  switch (indicator) {
    case "CI":
      return "bg-cyan-50 dark:bg-cyan-500/10 text-cyan-800 dark:text-cyan-300 border-cyan-200 dark:border-cyan-500/20";
    case "AUTOMERGE":
      return "bg-lime-50 dark:bg-lime-500/10 text-lime-800 dark:text-lime-300 border-lime-200 dark:border-lime-500/20";
    case "MERGED":
      return "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/20";
    case "MERGE_BLOCKED":
      return "bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-500/20";
    case "MERGE_CONFLICT":
      return "bg-red-50 dark:bg-red-500/10 text-red-800 dark:text-red-300 border-red-200 dark:border-red-500/20";
    default:
      return "bg-slate-100 dark:bg-slate-800/50 text-slate-700 dark:text-slate-400 border-slate-200 dark:border-slate-700";
  }
};

const getStatusIcon = (status?: string, indicator?: SubtaskMergeIndicator) => {
  if (indicator) {
    switch (indicator) {
      case "CI":
        return <PlayCircle className="w-3 h-3 mr-1.5 inline-block" strokeWidth={2.5} aria-hidden="true" />;
      case "AUTOMERGE":
      case "MERGED":
        return <CheckCircle2 className="w-3 h-3 mr-1.5 inline-block" strokeWidth={2.5} aria-hidden="true" />;
      case "MERGE_BLOCKED":
      case "MERGE_CONFLICT":
        return <XCircle className="w-3 h-3 mr-1.5 inline-block" strokeWidth={2.5} aria-hidden="true" />;
      default:
        return null;
    }
  }

  switch (status) {
    case "RUNNING":
      return <PlayCircle className="w-3 h-3 mr-1.5 inline-block" strokeWidth={2.5} aria-hidden="true" />;
    case "CODING_COMPLETED":
    case "COMPLETED":
      return <CheckCircle2 className="w-3 h-3 mr-1.5 inline-block" strokeWidth={2.5} aria-hidden="true" />;
    case "FAILED":
      return <XCircle className="w-3 h-3 mr-1.5 inline-block" strokeWidth={2.5} aria-hidden="true" />;
    case "BLOCKED":
    case "QUOTA":
      return <AlertCircle className="w-3 h-3 mr-1.5 inline-block" strokeWidth={2.5} aria-hidden="true" />;
    default:
      return <CircleDashed className="w-3 h-3 mr-1.5 inline-block" strokeWidth={2.5} aria-hidden="true" />;
  }
};

export const StatusBadge: FunctionComponent<StatusBadgeProps> = ({ status, indicator }) => {
  const value = indicator ?? status;
  if (!value) {
    return null;
  }
  const label = value === "CODING_COMPLETED" ? "CODING COMPLETED" : value.replaceAll("_", " ");

  const colorClasses = indicator ? getIndicatorColor(indicator) : getStatusColor(status);
  const transitionClasses = indicator ? "" : " transition-all duration-500";

  return (
    <span className={`inline-flex items-center px-3 py-1 rounded-full text-[10px] font-bold border${transitionClasses} ${colorClasses}`}>
      {getStatusIcon(status, indicator)}
      <span>{label}</span>
    </span>
  );
};
