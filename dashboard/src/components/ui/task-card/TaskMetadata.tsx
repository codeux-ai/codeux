import type { FunctionComponent } from "preact";
import type { Subtask } from "../../../types.js";
import { StatusBadge } from "./StatusBadge.js";

interface TaskMetadataProps {
  task: Pick<Subtask, "status" | "merge_indicator" | "session_id" | "session_name" | "provider">;
}

export const TaskMetadata: FunctionComponent<TaskMetadataProps> = ({ task }) => {
  const hasSession = Boolean(task.session_id || task.session_name);
  const sessionLabel = (task.session_id || task.session_name || "").replace(/^sessions\//, "");
  const providerLabel = task.provider ? task.provider.toUpperCase() : "JULES";

  return (
    <div className="flex flex-col items-end gap-3">
      <StatusBadge status={task.status} />
      {task.merge_indicator && <StatusBadge indicator={task.merge_indicator} />}
      {hasSession && <div className="text-[9px] font-mono text-slate-600">{sessionLabel.substring(0, 12)}...</div>}
      <div className="text-[9px] font-mono text-slate-600">{providerLabel}</div>
    </div>
  );
};
