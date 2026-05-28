import type { FunctionComponent } from "preact";
import { useProjectTasks } from "../../hooks/use-project-tasks.js";
import { RollingNumber } from "../ui/RollingNumber.js";
import type { Sprint, Task } from "../../types.js";

interface TelemetryStatsProps {
    projectId: string | null;
    sprints: Sprint[];
}

export const TelemetryStats: FunctionComponent<TelemetryStatsProps> = ({ projectId, sprints }) => {
    const { tasks } = useProjectTasks(projectId, [], sprints, null);

    const allTasks = tasks || [];
    const runningCount = allTasks.filter((t: Task) => t.status === "in_progress").length;
    const queuedCount = allTasks.filter((t: Task) => t.status === "pending").length;

    return (
        <div className="hidden items-center gap-0.5 rounded-xl border border-black/[0.04] bg-black/[0.02] px-1 dark:border-white/[0.04] dark:bg-white/[0.02] lg:flex">
            {/* Running tasks */}
            <div className="flex items-center gap-2 px-2.5 py-1.5">
                <span className="relative flex h-2 w-2">
                    {runningCount > 0 && (
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    )}
                    <span className={`relative inline-flex h-2 w-2 rounded-full ${runningCount > 0 ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-600"}`} />
                </span>
                <div className="flex items-baseline gap-1.5">
                    <span className="font-mono text-sm font-semibold leading-none text-slate-700 dark:text-slate-200">
                        <RollingNumber value={runningCount} />
                    </span>
                    <span className="text-[10px] font-medium leading-none text-slate-400">running</span>
                </div>
            </div>

            <div className="h-4 w-px bg-black/[0.06] dark:bg-white/[0.06]" />

            {/* Queued tasks */}
            <div className="flex items-center gap-2 px-2.5 py-1.5">
                <span className={`inline-flex h-2 w-2 rounded-full ${queuedCount > 0 ? "bg-amber-400" : "bg-slate-300 dark:bg-slate-600"}`} />
                <div className="flex items-baseline gap-1.5">
                    <span className="font-mono text-sm font-semibold leading-none text-slate-700 dark:text-slate-200">
                        <RollingNumber value={queuedCount} />
                    </span>
                    <span className="text-[10px] font-medium leading-none text-slate-400">queued</span>
                </div>
            </div>
        </div>
    );
};
