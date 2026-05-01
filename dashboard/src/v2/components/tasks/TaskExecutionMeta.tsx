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
    <div className={`flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400 ${className}`}>
      {/* Time Chip */}
      <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-void-700 px-2 py-0.5 rounded-full border border-slate-200 dark:border-white/[0.05]">
        <Clock className="w-3 h-3" strokeWidth={2} />
        <span>{time || "Not started"}</span>
      </div>

      {/* Executor Chip */}
      <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-void-700 px-2 py-0.5 rounded-full border border-slate-200 dark:border-white/[0.05]">
        {getExecutorIcon()}
        <span>{getExecutorLabel()}</span>
      </div>

      {/* Execution Mode Chip */}
      <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-void-700 px-2 py-0.5 rounded-full border border-slate-200 dark:border-white/[0.05]">
        <Settings className="w-3 h-3" strokeWidth={2} />
        <span className="capitalize">{executionMode || "Standard"}</span>
      </div>
    </div>
  );
});
