import type { FunctionComponent } from "preact";
import type { SubtaskMergeIndicator } from "../../../types.js";

type StatusBadgeProps =
  | { status?: string; indicator?: never }
  | { status?: never; indicator?: SubtaskMergeIndicator };

const getStatusColor = (status?: string): string => {
  switch (status) {
    case "RUNNING":
      return "bg-sky-500/10 text-sky-400 border-sky-500/20";
    case "CODING_COMPLETED":
      return "bg-cyan-500/10 text-cyan-400 border-cyan-500/20";
    case "COMPLETED":
      return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
    case "FAILED":
      return "bg-red-500/10 text-red-400 border-red-500/20";
    case "BLOCKED":
      return "bg-amber-500/10 text-amber-400 border-amber-500/20";
    case "QUOTA":
      return "bg-amber-500/10 text-amber-400 border-amber-500/20";
    default:
      return "bg-slate-800/50 text-slate-400 border-slate-700";
  }
};

const getIndicatorColor = (indicator?: SubtaskMergeIndicator): string => {
  switch (indicator) {
    case "CI":
      return "bg-cyan-500/10 text-cyan-300 border-cyan-500/20";
    case "AUTOMERGE":
      return "bg-lime-500/10 text-lime-300 border-lime-500/20";
    case "MERGED":
      return "bg-emerald-500/10 text-emerald-300 border-emerald-500/20";
    case "MERGE_BLOCKED":
      return "bg-amber-500/10 text-amber-300 border-amber-500/20";
    case "MERGE_CONFLICT":
      return "bg-red-500/10 text-red-300 border-red-500/20";
    default:
      return "bg-slate-800/50 text-slate-400 border-slate-700";
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
    <span className={`px-3 py-1 rounded-full text-[10px] font-bold border${transitionClasses} ${colorClasses}`}>
      {label}
    </span>
  );
};
