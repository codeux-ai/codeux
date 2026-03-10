import type { FunctionComponent } from "preact";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import { Target, Plus, Upload, Download, Trash2, CalendarDays, Layers3, Play, Square } from "lucide-preact";
import { SprintBubble } from "./components/ui/SprintBubble.js";
import { AddSprintModal } from "./components/ui/AddSprintModal.js";
import { SprintMarkdownModal } from "./components/ui/SprintMarkdownModal.js";
import type { SprintStatus } from "./types.js";
import { useProjectData } from "./context/project-data.js";
import { useProjectSprints } from "./hooks/use-project-sprints.js";
import { useProjectExecution } from "./hooks/use-project-execution.js";
import { createSprint, deleteSprint, exportSprintMarkdown, fetchProjectExecution, importSprintMarkdown } from "./lib/project-api.js";
import { buildTaskBundle, parseTaskBundle } from "./lib/markdown-transfer.js";
import { cancelSprintRun, orchestrateSprint } from "../lib/api/dashboard-api.js";

const ACCENT_CYCLE = ['text-signal-500', 'text-ember-500', 'text-status-green'] as const;

export const SprintsPage: FunctionComponent = () => {
    const mainRef      = useRef<HTMLDivElement>(null);
    const bubblesRef   = useRef<HTMLDivElement>(null);
    const [showModal, setShowModal] = useState(false);
    const [showImportModal, setShowImportModal] = useState(false);
    const [pendingActionIds, setPendingActionIds] = useState<Set<string>>(new Set());
    const [optimisticStatuses, setOptimisticStatuses] = useState<Record<string, SprintStatus>>({});
    const [suppressedRunningSprintIds, setSuppressedRunningSprintIds] = useState<Set<string>>(new Set());
    const [exportState, setExportState] = useState<{
        sprintLabel: string;
        sprintMarkdown: string;
        tasksMarkdown: string;
    } | null>(null);
    const { selectedProject } = useProjectData();
    const { sprints, refresh } = useProjectSprints(selectedProject?.id || null);
    const { execution, refresh: refreshExecution } = useProjectExecution(selectedProject?.id || null);

    useLayoutEffect(() => {
        if (mainRef.current) {
            gsap.fromTo(mainRef.current.children,
                { opacity: 0, y: 40 },
                { opacity: 1, y: 0, stagger: 0.12, duration: 1, ease: "power4.out", delay: 0.15 }
            );
        }
    }, []);

    const nextId = `SPR-${String((sprints.at(-1)?.number ?? sprints.length) + 1).padStart(2, '0')}`;

    const actualActiveRunsBySprintId = useMemo(() => {
        const map = new Map<string, { id: string; status: string }>();
        for (const run of execution.sprintRuns) {
            if (run.status !== "running" && run.status !== "queued") {
                continue;
            }
            if (!map.has(run.sprintId)) {
                map.set(run.sprintId, { id: run.id, status: run.status });
            }
        }
        return map;
    }, [execution.sprintRuns]);

    useEffect(() => {
        setSuppressedRunningSprintIds((current) => {
            let changed = false;
            const next = new Set<string>();
            for (const sprintId of current) {
                if (actualActiveRunsBySprintId.has(sprintId)) {
                    next.add(sprintId);
                } else {
                    changed = true;
                }
            }
            return changed ? next : current;
        });
    }, [actualActiveRunsBySprintId]);

    const activeRunsBySprintId = useMemo(() => {
        const map = new Map<string, { id: string; status: string }>();
        for (const [sprintId, run] of actualActiveRunsBySprintId.entries()) {
            if (suppressedRunningSprintIds.has(sprintId)) {
                continue;
            }
            map.set(sprintId, run);
        }
        return map;
    }, [actualActiveRunsBySprintId, suppressedRunningSprintIds]);

    const displaySprints = useMemo(() => (
        sprints.map((sprint) => ({
            ...sprint,
            status: optimisticStatuses[sprint.id]
                || (suppressedRunningSprintIds.has(sprint.id) && sprint.status === "running" ? "cancelled" : sprint.status),
        }))
    ), [optimisticStatuses, sprints, suppressedRunningSprintIds]);

    const handleSprintToggle = (sprintId: string) => {
        if (!selectedProject) return;
        const activeRun = activeRunsBySprintId.get(sprintId);
        const sprint = displaySprints.find((item) => item.id === sprintId);
        if (!sprint) return;

        if (activeRun) {
            const stopActionId = `sprint-stop:${activeRun.id}`;
            void runSprintAction(stopActionId, sprintId, async () => {
                await cancelSprintRun(activeRun.id);
            }, { optimisticStatus: "cancelled" });
            return;
        }

        const startActionId = `sprint-start:${sprintId}`;
        if (pendingActionIds.has(startActionId)) {
            return;
        }
        setSuppressedRunningSprintIds((current) => {
            if (!current.has(sprintId)) {
                return current;
            }
            const next = new Set(current);
            next.delete(sprintId);
            return next;
        });
        void runSprintAction(startActionId, sprintId, async () => {
            await orchestrateSprint(selectedProject.id, sprintId);
        }, { waitForActiveRun: true });
    };

    const runSprintAction = async (
        actionId: string,
        sprintId: string,
        operation: () => Promise<void>,
        options: {
            optimisticStatus?: SprintStatus;
            waitForActiveRun?: boolean;
        } = {},
    ) => {
        setPendingActionIds((current) => new Set(current).add(actionId));
        if (options.optimisticStatus) {
            setOptimisticStatuses((current) => ({ ...current, [sprintId]: options.optimisticStatus! }));
        }
        try {
            await operation();
            if (options.optimisticStatus === "cancelled") {
                setSuppressedRunningSprintIds((current) => new Set(current).add(sprintId));
            }
            if (options.waitForActiveRun && selectedProject) {
                for (let attempt = 0; attempt < 8; attempt += 1) {
                    const snapshot = await fetchProjectExecution(selectedProject.id);
                    if (snapshot.sprintRuns.some((run) => run.sprintId === sprintId && (run.status === "running" || run.status === "queued"))) {
                        break;
                    }
                    await new Promise((resolve) => window.setTimeout(resolve, 250));
                }
            }
            await Promise.all([refresh(), refreshExecution()]);
            setOptimisticStatuses((current) => {
                const next = { ...current };
                delete next[sprintId];
                return next;
            });
        } catch (error) {
            setOptimisticStatuses((current) => {
                const next = { ...current };
                delete next[sprintId];
                return next;
            });
            await Promise.all([refresh(), refreshExecution()]);
            window.alert(error instanceof Error ? error.message : String(error));
        } finally {
            setPendingActionIds((current) => {
                const next = new Set(current);
                next.delete(actionId);
                return next;
            });
        }
    };

    const handleAddSprint = async (sprint: {
        name: string;
        goal: string;
        startDate: string;
        endDate: string;
        status: "idle";
    }) => {
        if (!selectedProject) return;
        await createSprint(selectedProject.id, {
            name: sprint.name,
            startDate: sprint.startDate,
            endDate: sprint.endDate,
            goal: sprint.goal,
            status: sprint.status,
        });
        await refresh();
        // Animate the new cell in
        requestAnimationFrame(() => {
            if (!bubblesRef.current) return;
            const cells = Array.from(bubblesRef.current.children);
            const newCell = cells[cells.length - 2]; // second-to-last (last is the add-cell)
            if (newCell) {
                gsap.fromTo(newCell,
                    { scale: 0.7, opacity: 0, rotation: -8 },
                    { scale: 1, opacity: 1, rotation: 0, duration: 0.8, ease: "elastic.out(1, 0.6)" }
                );
            }
        });
    };

    const handleDeleteSprint = async (sprintId: string) => {
        await deleteSprint(sprintId);
        await refresh();
    };

    const handleOpenExport = async (sprintId: string, sprintName: string) => {
        if (!selectedProject) return;
        const bundle = await exportSprintMarkdown(selectedProject.id, sprintId);
        setExportState({
            sprintLabel: sprintName,
            sprintMarkdown: bundle.sprint.markdown,
            tasksMarkdown: buildTaskBundle(bundle.tasks),
        });
    };

    const handleImportSprint = async (payload: { sprintMarkdown: string; tasksMarkdown: string }) => {
        if (!selectedProject) return;
        await importSprintMarkdown(selectedProject.id, {
            sprintMarkdown: payload.sprintMarkdown,
            tasks: parseTaskBundle(payload.tasksMarkdown),
        });
        await refresh();
    };

    return (
        <>
            <div ref={mainRef} className="max-w-[1920px] mx-auto px-8 md:px-20 py-24 flex flex-col gap-20 relative z-10">

                {/* Page Header */}
                <div className="flex items-end justify-between">
                    <div className="flex flex-col gap-5">
                        <div className="flex items-center gap-2.5 text-signal-500 font-bold tracking-[0.15em] uppercase text-xs font-mono">
                            <Target className="w-4 h-4" strokeWidth={2.5} />
                            Iteration Cycles
                        </div>
                        <h1 className="text-5xl md:text-7xl font-black tracking-tighter text-slate-900 dark:text-white leading-[0.92] font-display">
                            Active <br />
                            <span className="text-signal-500">Sprints.</span>
                        </h1>
                        <p className="text-lg text-slate-500 dark:text-slate-500 font-medium max-w-xl mt-2 leading-relaxed">
                            {selectedProject
                                ? `Iteration cycles for ${selectedProject.name}.`
                                : "Select a project to manage sprint structure."}
                        </p>
                    </div>

                    {/* New Sprint button */}
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => setShowImportModal(true)}
                            disabled={!selectedProject}
                            className="group flex items-center gap-2.5 px-5 py-3.5 bg-black/[0.04] dark:bg-white/[0.04] hover:bg-black/[0.06] dark:hover:bg-white/[0.06] border border-black/[0.08] dark:border-white/[0.08] text-slate-700 dark:text-slate-200 font-bold text-sm rounded-2xl transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <Upload className="w-4 h-4 transition-transform duration-300 group-hover:-translate-y-0.5" />
                            Import Markdown
                        </button>
                        <button
                            onClick={() => setShowModal(true)}
                            disabled={!selectedProject}
                            className="group flex items-center gap-2.5 px-6 py-3.5 bg-signal-500 hover:bg-signal-400 text-void-900 font-bold text-sm rounded-2xl transition-all duration-300 shadow-[0_4px_20px_rgba(0,224,160,0.25)] hover:shadow-[0_8px_32px_rgba(0,224,160,0.45)] hover:-translate-y-px shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <Plus className="w-4 h-4 group-hover:rotate-90 transition-transform duration-300" />
                            New Sprint
                        </button>
                    </div>
                </div>

                {/* Organic Sprint Bubbles */}
                <div ref={bubblesRef} className="flex flex-wrap gap-14 justify-center lg:justify-start">
                    {sprints.map((sprint, index) => (
                        (() => {
                            const displaySprint = displaySprints[index];
                            const activeRun = activeRunsBySprintId.get(displaySprint.id);
                            const pendingActionId = activeRun ? `sprint-stop:${activeRun.id}` : `sprint-start:${displaySprint.id}`;
                            return (
                        <SprintBubble
                            key={displaySprint.id}
                            sprint={displaySprint}
                            isEven={index % 2 === 0}
                            accentColor={ACCENT_CYCLE[index % 3]}
                            primaryBusy={pendingActionIds.has(pendingActionId)}
                            onPrimaryAction={() => { handleSprintToggle(displaySprint.id); }}
                        />
                            );
                        })()
                    ))}

                    {/* Ghost "Add Sprint" cell */}
                    <button
                        onClick={() => setShowModal(true)}
                        disabled={!selectedProject}
                        className="group relative cursor-pointer perspective-1000 flex items-center justify-center shrink-0 w-72 h-72 lg:w-80 lg:h-80"
                    >
                        {/* Morphing dashed border */}
                        <div
                            className="absolute inset-0 border-2 border-dashed border-signal-500/25 group-hover:border-signal-500/60 transition-all duration-500 animate-organic"
                            style={{ borderRadius: '40% 60% 70% 30% / 40% 50% 60% 50%' }}
                        />
                        {/* Subtle glow fill on hover */}
                        <div
                            className="absolute inset-0 bg-signal-500/0 group-hover:bg-signal-500/[0.04] transition-all duration-500 animate-organic-reverse"
                            style={{ borderRadius: '40% 60% 70% 30% / 40% 50% 60% 50%' }}
                        />

                        {/* Center content */}
                        <div className="relative z-10 flex flex-col items-center gap-4">
                            <div className="w-14 h-14 rounded-full border-2 border-dashed border-signal-500/30 group-hover:border-signal-500 group-hover:bg-signal-500/10 flex items-center justify-center transition-all duration-400">
                                <Plus className="w-6 h-6 text-signal-500/40 group-hover:text-signal-500 group-hover:scale-110 group-hover:rotate-90 transition-all duration-400" />
                            </div>
                            <div className="flex flex-col items-center gap-1">
                                <span className="text-xs font-bold uppercase tracking-[0.2em] text-slate-300 dark:text-slate-600 group-hover:text-signal-500 transition-colors duration-300">
                                    New Sprint
                                </span>
                                <span className="text-[9px] font-mono text-slate-200 dark:text-slate-700 group-hover:text-slate-400 transition-colors duration-300">
                                    {nextId.toUpperCase()}
                                </span>
                            </div>
                        </div>
                    </button>
                </div>

                {!selectedProject && (
                    <div className="px-6 py-8 rounded-[1.75rem] border border-black/[0.06] dark:border-white/[0.06] bg-white/55 dark:bg-void-800/55 text-slate-500 dark:text-slate-400 text-sm max-w-xl">
                        Projects now scope the whole dashboard. Create or select a project in the top navigation before adding sprints.
                    </div>
                )}

                {selectedProject && (
                    <div className="relative overflow-hidden rounded-[2rem] border border-black/[0.06] dark:border-white/[0.06] bg-white/60 dark:bg-void-800/60 backdrop-blur-2xl p-8 shadow-[0_8px_30px_rgba(0,0,0,0.04)] dark:shadow-[0_8px_30px_rgba(0,0,0,0.22)]">
                        <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_90%_60%_at_100%_0%,rgba(255,184,0,0.06),transparent_60%)]" />
                        <div className="relative z-10 flex items-center justify-between gap-6 mb-6">
                            <div>
                                <div className="flex items-center gap-2 text-ember-500 font-bold tracking-[0.16em] uppercase text-[10px] font-mono mb-2">
                                    <Layers3 className="w-3.5 h-3.5" strokeWidth={2.4} />
                                    Sprint Registry
                                </div>
                                <h2 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white font-display">
                                    Manage sprint records and markdown transfer.
                                </h2>
                            </div>
                            <div className="text-xs text-slate-400 font-mono">
                                {sprints.length} sprint{sprints.length === 1 ? "" : "s"}
                            </div>
                        </div>

                        <div className="grid grid-cols-1 gap-3">
                            {sprints.length === 0 ? (
                                <div className="px-5 py-6 rounded-2xl border border-dashed border-black/[0.08] dark:border-white/[0.08] text-sm text-slate-400">
                                    No sprints yet. Create one or import markdown to seed this project.
                                </div>
                            ) : displaySprints.map((sprint) => {
                                const activeRun = activeRunsBySprintId.get(sprint.id);
                                const startActionId = `sprint-start:${sprint.id}`;
                                const stopActionId = activeRun ? `sprint-stop:${activeRun.id}` : `sprint-stop:${sprint.id}`;
                                const startPending = pendingActionIds.has(startActionId);
                                const stopPending = pendingActionIds.has(stopActionId);
                                const isRunning = sprint.status === "running";

                                return (
                                <div
                                    key={sprint.id}
                                    className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 px-5 py-4 rounded-[1.4rem] border border-black/[0.05] dark:border-white/[0.06] bg-black/[0.02] dark:bg-white/[0.02]"
                                >
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2 mb-1.5">
                                            <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-slate-400">
                                                {sprint.number ? `Sprint ${sprint.number}` : sprint.slug}
                                            </span>
                                            <span className={`w-2 h-2 rounded-full ${
                                                sprint.status === "running" ? "bg-status-green" :
                                                sprint.status === "paused" ? "bg-status-amber" :
                                                sprint.status === "completed" ? "bg-signal-500" :
                                                sprint.status === "failed" ? "bg-status-red" :
                                                sprint.status === "cancelled" ? "bg-slate-400" :
                                                "bg-slate-400"
                                            }`} />
                                        </div>
                                        <div className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">
                                            {sprint.name}
                                        </div>
                                        <div className="flex items-center gap-4 mt-2 text-xs text-slate-400">
                                            <span className="inline-flex items-center gap-1.5">
                                                <CalendarDays className="w-3.5 h-3.5" strokeWidth={2} />
                                                {sprint.date}
                                            </span>
                                            <span>{sprint.tasksCount} tasks</span>
                                            <span>{sprint.completion}% complete</span>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-2 self-start lg:self-auto">
                                        <button
                                            onClick={() => { handleSprintToggle(sprint.id); }}
                                            disabled={!selectedProject || startPending || stopPending}
                                            className={`group relative inline-flex items-center gap-2 overflow-hidden px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-[0.12em] transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed ${
                                                isRunning
                                                    ? "bg-status-red/[0.10] hover:bg-status-red/[0.16] text-status-red border border-status-red/20 shadow-[0_8px_24px_rgba(227,0,15,0.12)]"
                                                    : "bg-signal-500/[0.10] hover:bg-signal-500/[0.16] text-signal-600 dark:text-signal-400 border border-signal-500/20 shadow-[0_8px_24px_rgba(0,224,160,0.16)]"
                                            }`}
                                        >
                                            <span className={`absolute inset-0 opacity-0 transition-opacity duration-300 ${isRunning ? "group-hover:opacity-100 bg-[radial-gradient(circle_at_center,rgba(227,0,15,0.18),transparent_70%)]" : "group-hover:opacity-100 bg-[radial-gradient(circle_at_center,rgba(0,224,160,0.16),transparent_70%)]"}`} />
                                            <span className={`relative flex items-center justify-center w-6 h-6 rounded-full ${isRunning ? "bg-status-red/15" : "bg-signal-500/15"}`}>
                                                {isRunning ? (
                                                    <Square className={`w-3.5 h-3.5 ${stopPending ? "animate-pulse" : "group-hover:scale-110"} transition-transform duration-300`} strokeWidth={2.4} />
                                                ) : (
                                                    <Play className={`w-3.5 h-3.5 ${startPending ? "animate-pulse" : "group-hover:translate-x-0.5 group-hover:scale-110"} transition-transform duration-300`} strokeWidth={2.4} />
                                                )}
                                            </span>
                                            <span className="relative">
                                                {startPending
                                                    ? "Igniting"
                                                    : stopPending
                                                        ? "Stopping"
                                                        : isRunning
                                                            ? "Stop"
                                                            : "Start"}
                                            </span>
                                        </button>
                                        <button
                                            onClick={() => { void handleOpenExport(sprint.id, sprint.name); }}
                                            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-ember-500/[0.08] hover:bg-ember-500/[0.14] text-ember-600 dark:text-ember-400 text-xs font-bold uppercase tracking-[0.12em] transition-colors"
                                        >
                                            <Download className="w-3.5 h-3.5" strokeWidth={2.3} />
                                            Export
                                        </button>
                                        <button
                                            onClick={() => { void handleDeleteSprint(sprint.id); }}
                                            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-status-red/[0.08] hover:bg-status-red/[0.14] text-status-red text-xs font-bold uppercase tracking-[0.12em] transition-colors"
                                        >
                                            <Trash2 className="w-3.5 h-3.5" strokeWidth={2.3} />
                                            Delete
                                        </button>
                                    </div>
                                </div>
                            )})}
                        </div>
                    </div>
                )}
            </div>

            {/* Modal */}
            {showModal && (
                <AddSprintModal
                    nextId={nextId}
                    onClose={() => setShowModal(false)}
                    onAdd={(sprint) => { void handleAddSprint(sprint); }}
                />
            )}

            {showImportModal && (
                <SprintMarkdownModal
                    mode="import"
                    onClose={() => setShowImportModal(false)}
                    onImport={(payload) => { void handleImportSprint(payload); }}
                />
            )}

            {exportState && (
                <SprintMarkdownModal
                    mode="export"
                    sprintLabel={exportState.sprintLabel}
                    sprintMarkdown={exportState.sprintMarkdown}
                    tasksMarkdown={exportState.tasksMarkdown}
                    onClose={() => setExportState(null)}
                />
            )}
        </>
    );
};
