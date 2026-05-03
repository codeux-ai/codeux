import type { FunctionComponent } from "preact";
import { useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import { Flip } from "gsap/Flip";

gsap.registerPlugin(Flip);
import { TaskRow } from "./ui/TaskRow.js";
import { FilterStrip } from "./ui/FilterStrip.js";
import { SkeletonRow } from "./ui/ListSkeletons.js";
import { deriveActiveSprintIds, filterTasksToActiveSprints } from "../lib/overview-streams.js";
import { useReducedMotion } from "../hooks/use-reduced-motion.js";
import { VirtualizedItem } from "./ui/VirtualizedItem.js";
type TaskFilter = "All Tasks" | "Running" | "Queued" | "Completed";

const FILTER_OPTIONS = ["All Tasks", "Running", "Queued", "Completed"] as const;

export const TasksList: FunctionComponent<{ pageData: ReturnType<typeof import("../hooks/use-overview-page-data.js").useOverviewPageData> }> = ({ pageData }) => {
    const listRef = useRef<HTMLDivElement>(null);
    const [activeFilter, setActiveFilter] = useState<TaskFilter>("All Tasks");
    const flipStateRef = useRef<any>(null);

    const handleFilterChange = (newFilter: TaskFilter) => {
        if (listRef.current) {
            flipStateRef.current = Flip.getState(listRef.current.children);
        }
        setActiveFilter(newFilter);
    };

    const handleClearFilter = () => {
        if (listRef.current) {
            flipStateRef.current = Flip.getState(listRef.current.children);
        }
        setActiveFilter("All Tasks");
    };
    const reducedMotion = useReducedMotion();
    const { sprints, tasks, isLoading } = pageData;



    const activeSprintIds = useMemo(() => deriveActiveSprintIds(sprints), [sprints]);
    const activeTasks = useMemo(() => filterTasksToActiveSprints(tasks, activeSprintIds), [tasks, activeSprintIds]);

    const filteredTasks = useMemo(() => activeTasks.filter(task => {
        if (activeFilter === "All Tasks") return true;
        if (activeFilter === "Running") return task.status === "in_progress";
        if (activeFilter === "Queued") return task.status === "pending";
        if (activeFilter === "Completed") return task.status === "completed";
        return true;
    }), [activeTasks, activeFilter]);

    const prevTasksRef = useRef(filteredTasks);
    const [renderedTasks, setRenderedTasks] = useState(filteredTasks);

    // Check during render if filteredTasks changed. If so, capture Flip state before rendering the new DOM.
    if (filteredTasks !== prevTasksRef.current) {
        if (listRef.current) {
            flipStateRef.current = Flip.getState(listRef.current.children);
        }
        prevTasksRef.current = filteredTasks;
        setRenderedTasks(filteredTasks);
    }

    const initialMountRef = useRef(true);

    useLayoutEffect(() => {
        if (listRef.current) {
            if (reducedMotion) {
                gsap.set(listRef.current.children, { y: 0, opacity: 1, scale: 1 });
            } else if (flipStateRef.current) {
                Flip.from(flipStateRef.current, {
                    targets: listRef.current.children,
                    duration: 0.3,
                    ease: "power2.out",
                    stagger: 0.02,
                    scale: true,
                    absolute: true,
                    onEnter: (elements: Element[]) => gsap.fromTo(elements, { opacity: 0, y: 10, scale: 0.95 }, { opacity: 1, y: 0, scale: 1, duration: 0.3, stagger: 0.02, ease: "power2.out" }),
                    onLeave: (elements: Element[]) => gsap.to(elements, { opacity: 0, duration: 0.2 })
                });
                flipStateRef.current = null;
            } else if (initialMountRef.current) {
                initialMountRef.current = false;
                gsap.fromTo(
                    listRef.current.children,
                    { y: 15, opacity: 0, scale: 0.99 },
                    { y: 0, opacity: 1, scale: 1, duration: 0.25, stagger: 0.04, ease: "power2.out", delay: 0.05 }
                );
            }
        }
    }, [activeFilter, reducedMotion, filteredTasks]);

    return (
        <div className="w-full relative z-10 px-2">
            {/* Section Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-8 md:mb-12 gap-6 sm:gap-8">
                <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-8">
                    <h2 className="text-xl md:text-2xl font-bold tracking-tight text-slate-900 dark:text-white font-display">Active Streams</h2>
                    <div className="w-full sm:w-auto">
                        <FilterStrip
                            options={FILTER_OPTIONS}
                            active={activeFilter}
                            onChange={handleFilterChange}
                            showClear={activeFilter !== "All Tasks"}
                            onClear={handleClearFilter}
                        />
                    </div>
                </div>
                <div className="text-xs font-semibold text-slate-400 dark:text-slate-600 font-mono hidden sm:block">
                    {renderedTasks.length} active
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
                ) : renderedTasks.length > 0 ? (
                    renderedTasks.map((task) => (
                        <VirtualizedItem key={task.id} data-flip-id={task.id} className="task-flip-item" defaultHeight={84}><TaskRow task={task} /></VirtualizedItem>
                    ))
                ) : (
                    <div data-flip-id="empty-state" className="flex flex-col items-center justify-center py-12 text-center rounded-2xl border border-dashed border-slate-300 dark:border-slate-700">
                        <svg className="w-12 h-12 mb-4 text-slate-300 dark:text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                        </svg>
                        <div className="text-sm font-semibold text-slate-500 dark:text-slate-400">No Results Found</div>
                        <div className="text-xs text-slate-400 dark:text-slate-500 mt-1">There are no tasks currently matching the selected filter in active sprints.</div>
                    </div>
                )}
            </div>
        </div>
    );
};
