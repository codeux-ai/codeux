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
        return <Cpu className="w-3 h-3" strokeWidth={2} aria-hidden="true" />;
      case "jules":
        return <User className="w-3 h-3" strokeWidth={2} aria-hidden="true" />;
      default:
        return <Cpu className="w-3 h-3" strokeWidth={2} aria-hidden="true" />;
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

  const chipClass = "inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-black/[0.06] bg-black/[0.03] px-2 py-0.5 dark:border-white/[0.08] dark:bg-white/[0.03]";

  return (
    <div className={`flex min-w-0 flex-wrap items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400 ${className}`}>
      <div className={chipClass}>
        <Clock className="w-3 h-3" strokeWidth={2} aria-hidden="true" />
        <span className="sr-only">Duration: </span>
        <span className="min-w-0 break-words">{time || "Not started"}</span>
      </div>

      <div className={chipClass}>
        {getExecutorIcon()}
        <span className="sr-only">Executor: </span>
        <span className="min-w-0 break-words">{getExecutorLabel()}</span>
      </div>

      <div className={chipClass}>
        <Settings className="w-3 h-3" strokeWidth={2} aria-hidden="true" />
        <span className="sr-only">Mode: </span>
        <span className="min-w-0 break-words capitalize">{executionMode || "Standard"}</span>
      </div>
    </div>
  );
});
