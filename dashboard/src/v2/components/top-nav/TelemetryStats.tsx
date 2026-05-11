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
        <div className="mr-2 hidden h-9 items-center gap-4 rounded-xl border border-black/[0.04] bg-black/[0.02] px-3.5 dark:border-white/[0.04] dark:bg-white/[0.02] lg:flex">
            <div className="flex flex-col items-start justify-center gap-0.5">
                <span className="text-[9px] font-bold uppercase leading-none tracking-wider text-slate-400">Active Tasks</span>
                <div className="font-mono text-sm font-semibold leading-none text-slate-700 dark:text-slate-200">
                    <RollingNumber value={activeTasksCount} />
                </div>
            </div>
        </div>
    );
};
