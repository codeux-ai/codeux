import type { FunctionComponent } from "preact";
import { RollingNumber } from "../ui/RollingNumber.js";
import { useProjectTasks } from "../../hooks/use-project-tasks.js";
import { useProjectData } from "../../context/project-data.js";
import { useSprints } from "../../../hooks/useSprints.js";
import type { Task } from "../../types.js";

export const TelemetryStats: FunctionComponent = () => {
    const { selectedProject } = useProjectData();
    const projectId = selectedProject?.id || null;
    const { data: sprints } = useSprints(projectId);
    const { tasks } = useProjectTasks(projectId, selectedProject ? [selectedProject] : [], sprints, null);

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
