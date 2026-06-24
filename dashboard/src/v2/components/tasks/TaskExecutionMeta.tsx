import type { FunctionComponent } from "preact";
import { memo } from "preact/compat";
import { Clock, Settings, Cpu, User } from "lucide-preact";
import type { TaskExecutorType } from "../../types.js";

export interface TaskExecutionMetaProps {
  time?: string;
  executorType?: TaskExecutorType;
  executionMode?: string;
  className?: string;
}

export const TaskExecutionMeta: FunctionComponent<TaskExecutionMetaProps> = memo(({
  time,
  executorType,
  executionMode,
  className = "",
}) => {
  const getExecutorIcon = () => {
    switch (executorType) {
      case "docker_cli":
      case "auto":
        return <Cpu className="w-3 h-3" strokeWidth={2} />;
      case "jules":
        return <User className="w-3 h-3" strokeWidth={2} />;
      default:
        return <Cpu className="w-3 h-3" strokeWidth={2} />;
    }
  };

  const getExecutorLabel = () => {
    switch (executorType) {
      case "docker_cli": return "CLI";
      case "jules": return "Jules";
      case "auto": return "Auto";
      default: return "Auto";
    }
  };

  return (
    <div className={`flex gap-2.5 items-center text-xs font-medium text-slate-500 dark:text-slate-400 ${className}`}>
      {/* Time Chip */}
      <div className="flex items-center gap-1.5 bg-black/[0.03] dark:bg-white/[0.03] px-2 py-0.5 rounded-full border border-black/[0.06] dark:border-white/[0.08]">
        <Clock className="w-3 h-3" strokeWidth={2} aria-hidden="true" />
        <span className="sr-only">Duration: </span>
        <span>{time || "Not started"}</span>
      </div>

      {/* Executor Chip */}
      <div className="flex items-center gap-1.5 bg-black/[0.03] dark:bg-white/[0.03] px-2 py-0.5 rounded-full border border-black/[0.06] dark:border-white/[0.08]">
        {getExecutorIcon()}
        <span className="sr-only">Executor: </span>
        <span>{getExecutorLabel()}</span>
      </div>

      {/* Execution Mode Chip */}
      <div className="flex items-center gap-1.5 bg-black/[0.03] dark:bg-white/[0.03] px-2 py-0.5 rounded-full border border-black/[0.06] dark:border-white/[0.08]">
        <Settings className="w-3 h-3" strokeWidth={2} aria-hidden="true" />
        <span className="sr-only">Mode: </span>
        <span className="capitalize">{executionMode || "Standard"}</span>
      </div>
    </div>
  );
});
