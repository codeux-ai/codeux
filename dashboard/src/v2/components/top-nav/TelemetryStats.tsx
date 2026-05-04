import type { FunctionComponent } from "preact";
import { useProjectTasks } from "../../hooks/use-project-tasks.js";
import { RollingNumber } from "../ui/RollingNumber.js";
import type { Sprint, Task } from "../../types.js";

interface TelemetryStatsProps {
    projectId: string | null;
    sprints: Sprint[];
}

export const TelemetryStats: FunctionComponent<TelemetryStatsProps> = ({ projectId, sprints }) => {
    // Only TelemetryStats will re-render when task state updates, avoiding TopNav nav-wide re-renders
    const { tasks } = useProjectTasks(projectId, [], sprints, null);

    const activeTasksCount = (tasks || []).filter((t: Task) => t.status === "in_progress" || t.status === "pending").length;

    return (
        <div className="hidden lg:flex items-center gap-4 px-4 py-1.5 bg-black/[0.02] dark:bg-white/[0.02] border border-black/[0.04] dark:border-white/[0.04] rounded-xl mr-2">
            <div className="flex flex-col items-start">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Active Tasks</span>
                <div className="text-sm font-semibold text-slate-700 dark:text-slate-200 font-mono leading-tight">
                    <RollingNumber value={activeTasksCount} />
                </div>
            </div>
        </div>
    );
};
