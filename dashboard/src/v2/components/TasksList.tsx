import type { FunctionComponent } from "preact";
import { useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import { TaskRow } from "./ui/TaskRow.js";
import { FilterStrip } from "./ui/FilterStrip.js";
import { SkeletonRow } from "./ui/ListSkeletons.js";
import { deriveActiveSprintIds, filterTasksToActiveSprints } from "../lib/overview-streams.js";
import { useProjectData } from "../context/project-data.js";
import { useSprints } from "../../hooks/useSprints.js";
import { useProjectTasks } from "../hooks/use-project-tasks.js";

type TaskFilter = "All Tasks" | "Running" | "Queued" | "Completed";

const FILTER_OPTIONS = ["All Tasks", "Running", "Queued", "Completed"] as const;

export const TasksList: FunctionComponent = () => {
    const listRef = useRef<HTMLDivElement>(null);
    const [activeFilter, setActiveFilter] = useState<TaskFilter>("All Tasks");
    const { projects, selectedProject, loading: projectsLoading } = useProjectData();
    const { data: sprints, loading: sprintsLoading } = useSprints(selectedProject?.id || null);
    const { tasks, loading: tasksLoading } = useProjectTasks(selectedProject?.id || null, projects, sprints);

    const isLoading = projectsLoading || sprintsLoading || tasksLoading;

    useLayoutEffect(() => {
        if (listRef.current) {
            gsap.fromTo(
                listRef.current.children,
                { y: 30, opacity: 0, scale: 0.99 },
                { y: 0, opacity: 1, scale: 1, duration: 0.7, stagger: 0.04, ease: "power3.out", delay: 0.1 }
            );
        }
    }, [activeFilter]);

    const activeSprintIds = useMemo(() => deriveActiveSprintIds(sprints), [sprints]);
    const activeTasks = useMemo(() => filterTasksToActiveSprints(tasks, activeSprintIds), [tasks, activeSprintIds]);

    const filteredTasks = useMemo(() => activeTasks.filter(task => {
        if (activeFilter === "All Tasks") return true;
        if (activeFilter === "Running") return task.status === "in_progress";
        if (activeFilter === "Queued") return task.status === "pending";
        if (activeFilter === "Completed") return task.status === "completed";
        return true;
    }), [activeTasks, activeFilter]);

    return (
        <div className="w-full relative z-10 px-2">
            {/* Section Header */}
            <div className="flex items-center justify-between mb-12">
                <div className="flex items-center gap-8">
                    <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white font-display">Active Streams</h2>
                    <FilterStrip options={FILTER_OPTIONS} active={activeFilter} onChange={setActiveFilter} />
                </div>
                <div className="text-xs font-semibold text-slate-400 dark:text-slate-600 font-mono">
                    {filteredTasks.length} active
                </div>
            </div>

            {/* Task rows */}
            <div ref={listRef} className="flex flex-col w-full space-y-3">
                {isLoading ? (
                    <>
                        <SkeletonRow />
                        <SkeletonRow />
                        <SkeletonRow />
                        <SkeletonRow />
                        <SkeletonRow />
                    </>
                ) : filteredTasks.length > 0 ? (
                    filteredTasks.map((task) => (
                        <TaskRow key={task.id} task={task} />
                    ))
                ) : (
                    <div className="flex flex-col items-center justify-center py-12 text-center rounded-2xl border border-dashed border-slate-300 dark:border-slate-700">
                        <div className="text-sm font-semibold text-slate-500 dark:text-slate-400">No active tasks</div>
                        <div className="text-xs text-slate-400 dark:text-slate-500 mt-1">There are no tasks currently matching the selected filter in active sprints.</div>
                    </div>
                )}
            </div>
        </div>
    );
};
