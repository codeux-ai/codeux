import type { FunctionComponent } from "preact";
import { lazy, Suspense } from "preact/compat";
import { useLayoutEffect, useRef, useState, useEffect, useMemo } from "preact/hooks";
import gsap from "gsap";
import {
    Zap, Clock, CheckCircle2, XCircle, AlertTriangle,
    Activity, ChevronDown, Radio,
    Play, RotateCcw, Bot, Workflow, PauseCircle,
    Ship, BarChart3,
} from "lucide-preact";
import { SprintStatsDeck, useLiveTaskTimingSummaries } from "./components/SprintStatsDeck.js";
import { WaveFluid } from "./components/ui/WaveFluid.js";
import { BorderTrace } from "./components/ui/BorderTrace.js";
import { HumanInterventionBadge } from "./components/ui/HumanInterventionBadge.js";
import { useDashboardRuntimeData } from "../hooks/use-dashboard-runtime-data.js";
import { usePreviewSessions } from "./hooks/use-preview-sessions.js";
import { useLiveSessionActions } from "./hooks/use-live-session-actions.js";
import { formatTime } from "../lib/time.js";
import { renderMarkdown } from "../lib/markdown.js";
import type { Subtask, ExecutionRuntimeEventSummary } from "../types.js";
import { deriveLiveSessionRuntimeState } from "./lib/live-session-runtime.js";
import { getTaskProgressPhase } from "../lib/task-progress.js";

import { IntelPanel } from "./components/ui/IntelPanel.js";
import { CollapsiblePanel } from "./components/ui/CollapsiblePanel.js";
import { ExecutionTimelineProvider, useExecutionTimeline } from "../hooks/ExecutionTimelineContext.js";
import { ExecutionTimeline } from "./components/ExecutionTimeline.js";
import { ExecutionRuntimePanel } from "./components/live-session/ExecutionRuntimePanel.js";
import { StatsHeader } from "./components/StatsHeader.js";
import { SprintProtocol } from "./components/SprintProtocol.js";
import { IdleRuntimeState } from "./components/ui/IdleRuntimeState.js";
import { SkeletonPanel } from "./components/ui/ListSkeletons.js";
import {
    EMPTY_RUNTIME_STATS,
} from "./lib/live-session-config.js";
import { LiveTaskCard, TaskDuration, QuotaCountdown } from "./components/LiveTaskCard.js";
import { LiveTransportBanner } from "./components/live-session/LiveTransportBanner.js";
import { RuntimeEventFeed } from "./components/RuntimeEventFeed.js";
import { GitCIStatusPanel } from "./components/GitCIStatusPanel.js";
import { deriveLiveDurationDisplay } from "./lib/live-duration-display.js";
import { useProjectData } from "./context/project-data.js";



const SprintBoatRace = lazy(() => import("./components/SprintBoatRace.js").then(m => ({ default: m.SprintBoatRace })));
const SprintDag = lazy(() => import("./components/SprintDag.js").then(m => ({ default: m.SprintDag })));






















/* ─── Header View Type ──────────────────────────────────────────────────── */

type HeaderView = "stats" | "race" | "dag";

/* ─── Filter Type ────────────────────────────────────────────────────────── */

type TaskFilter = "All" | "Running" | "Completed" | "Failed" | "Pending";

const FILTER_STATUS_MAP: Record<TaskFilter, string | null> = {
    All: null, Running: "RUNNING", Completed: "COMPLETED", Failed: "FAILED", Pending: "PENDING",
};

const TASK_FILTERS: TaskFilter[] = ["All", "Running", "Completed", "Failed", "Pending"];
const EMPTY_RUNTIME_EVENTS: ExecutionRuntimeEventSummary[] = [];
const EMPTY_LIVE_SESSION_RUNTIME_STATE = {
    liveSprintRun: null,
    pausedInterventionRun: null,
    hasActiveSprint: false,
    hasSprintContext: false,
} as const;

/* ─── Main Page ──────────────────────────────────────────────────────────── */

export const LiveSessionPage: FunctionComponent = () => {

    const contentRef = useRef<HTMLDivElement>(null);
    const { selectedProjectId } = useProjectData();
    const {
        error,
        execution,
        gitStatus,
        gitStatusError,
        initialLoadComplete,
        transportState,
        isRecovering,
        snapshotUpdatedAt,
        refreshRuntimeStatus,
        refreshGitStatus,
        selectedSprintId,
        status,
        tasksWithLiveActivities,
    } = useDashboardRuntimeData(selectedProjectId);
    const realtimeProjectId = selectedProjectId || execution.projectId || status.project_id || null;
    const sprintScopeId = selectedSprintId || status.sprint_id || null;
    const { selectedSession } = usePreviewSessions({
        projectId: realtimeProjectId,
        selectedSprintId: sprintScopeId
    });
    const sprintScopeReady = Boolean(selectedSprintId || sprintScopeId || initialLoadComplete);

    const {
        rerunningIds,
        pendingActionIds,
        handleRerun,
        handleOrchestrateSprint,
        handlePauseSprintRun,
        handleCancelSprintRun,
        handleForceCancelSprintRun,
        handleCancelTaskDispatch,
        handleForceCancelTaskDispatch,
        handleRetryTaskDispatch,
        handleClaimAttentionItem,
        handleResolveAttentionItem,
        handleDismissAttentionItem,
    } = useLiveSessionActions(refreshRuntimeStatus, refreshGitStatus);

    const [activeFilter, setFilter] = useState<TaskFilter>("All");
    const [headerView, setHeaderView] = useState<HeaderView>("dag");

    /* GSAP entrance */
    useLayoutEffect(() => {

        if (contentRef.current) {
            gsap.fromTo(
                Array.from(contentRef.current.children),
                { opacity: 0, y: 50 },
                { opacity: 1, y: 0, stagger: 0.08, duration: 1, ease: "power4.out", delay: 0.2 },
            );
        }
    }, []);

    const runtimeState = useMemo(
        () => sprintScopeReady
            ? deriveLiveSessionRuntimeState(status, execution, sprintScopeId)
            : EMPTY_LIVE_SESSION_RUNTIME_STATE,
        [execution.attentionItems.length, execution.sprintRuns, execution.taskDispatches.length, status.sprint_id, status.subtasks?.length, status.timestamp, execution, sprintScopeId, sprintScopeReady, status],
    );
    const liveSprintRun = runtimeState.liveSprintRun;
    const pausedInterventionRun = runtimeState.pausedInterventionRun;
    const pausedIntervention = pausedInterventionRun?.humanIntervention || null;
    const hasLiveSprint = runtimeState.hasActiveSprint;

    const rawHasSprintContext = runtimeState.hasSprintContext;
    const sprintDispatches = useMemo(() => {
        if (!sprintScopeReady) {
            return [];
        }
        return sprintScopeId
            ? execution.taskDispatches.filter((d) => d.sprintId === sprintScopeId)
            : execution.taskDispatches;
    }, [execution.taskDispatches, sprintScopeId, sprintScopeReady]);

    const sprintEvents = useMemo(() => {
        if (!sprintScopeReady) {
            return [];
        }
        return sprintScopeId
            ? execution.recentEvents.filter((e) => e.sprintId === sprintScopeId)
            : execution.recentEvents;
    }, [execution.recentEvents, sprintScopeId, sprintScopeReady]);

    const sprintRuns = useMemo(() => {
        if (!sprintScopeReady) {
            return [];
        }
        return sprintScopeId
            ? execution.sprintRuns.filter((r) => r.sprintId === sprintScopeId)
            : execution.sprintRuns;
    }, [execution.sprintRuns, sprintScopeId, sprintScopeReady]);

    const visibleTasksWithLiveActivities = tasksWithLiveActivities;

    const hasSprintContext = rawHasSprintContext || visibleTasksWithLiveActivities.length > 0;

    const [nowIso, setNowIso] = useState(() => new Date().toISOString());

    const visibleStats = useMemo(() => {
        if (!hasSprintContext) return EMPTY_RUNTIME_STATS;
        return {
            total: visibleTasksWithLiveActivities.length,
            running: visibleTasksWithLiveActivities.filter((task) => task.status === "RUNNING").length,
            codingCompleted: visibleTasksWithLiveActivities.filter((task) => task.status === "CODING_COMPLETED").length,
            completed: visibleTasksWithLiveActivities.filter((task) => task.status === "COMPLETED").length,
            failed: visibleTasksWithLiveActivities.filter((task) => task.status === "FAILED").length,
            ci: visibleTasksWithLiveActivities.filter((task) => task.merge_indicator === "CI").length,
            automerge: visibleTasksWithLiveActivities.filter((task) => task.merge_indicator === "AUTOMERGE").length,
            merged: visibleTasksWithLiveActivities.filter((task) => task.merge_indicator === "MERGED" || task.is_merged).length,
            mergeBlocked: visibleTasksWithLiveActivities.filter((task) => task.merge_indicator === "MERGE_BLOCKED").length,
            mergeConflicts: visibleTasksWithLiveActivities.filter((task) => task.merge_indicator === "MERGE_CONFLICT").length,
        };
    }, [hasSprintContext, visibleTasksWithLiveActivities]);

    const { sprintTiming, taskTimings, taskTimingMap } = useLiveTaskTimingSummaries({
        tasks: visibleTasksWithLiveActivities,
        dispatches: sprintDispatches,
        events: sprintEvents,
        sprintRuns: sprintRuns,
        nowIso,
    });

    const hasLiveDurationTicker = useMemo(() => (
        taskTimings.some((taskTiming) => (
            deriveLiveDurationDisplay({ taskTiming }).mode === "live"
        ))
        || sprintDispatches.some((dispatch) => (
            deriveLiveDurationDisplay({
                dispatchTiming: {
                    startedAt: dispatch.startedAt,
                    finishedAt: dispatch.finishedAt,
                    status: dispatch.status,
                },
            }).mode === "live"
        ))
    ), [sprintDispatches, taskTimings]);

    useEffect(() => {
        setNowIso(new Date().toISOString());
        if (!hasLiveDurationTicker) {
            return;
        }
        const timer = window.setInterval(() => {
            setNowIso(new Date().toISOString());
        }, 1000);
        return () => window.clearInterval(timer);
    }, [hasLiveDurationTicker]);

    const taskEventsByRecordId = useMemo(() => {
        const byRecordId = new Map<string, ExecutionRuntimeEventSummary[]>();
        const byTaskKey = new Map<string, ExecutionRuntimeEventSummary[]>();
        for (const event of sprintEvents) {
            if (event.taskId) {
                const existing = byRecordId.get(event.taskId) || [];
                existing.push(event);
                byRecordId.set(event.taskId, existing);
            }
            if (event.taskKey) {
                const existing = byTaskKey.get(event.taskKey) || [];
                existing.push(event);
                byTaskKey.set(event.taskKey, existing);
            }
        }
        return { byRecordId, byTaskKey };
    }, [sprintEvents]);

    const dispatchInfoByTaskId = useMemo(() => {
        const map = new Map<string, {
            errorMessage: string | null;
            startedAt: string | null;
            finishedAt: string | null;
            status: string | null;
        }>();
        for (const dispatch of sprintDispatches) {
            if (!dispatch.taskId) continue;
            const existing = map.get(dispatch.taskId);
            // Keep the most recent dispatch (last in list), but prefer one with error if present
            if (!existing || dispatch.errorMessage || (!existing.errorMessage && dispatch.startedAt)) {
                map.set(dispatch.taskId, {
                    errorMessage: dispatch.errorMessage,
                    startedAt: dispatch.startedAt,
                    finishedAt: dispatch.finishedAt,
                    status: dispatch.status,
                });
            }
        }
        return map;
    }, [sprintDispatches]);

    const { filteredTasks, taskCounts } = useMemo(() => {
        const filteredTasks: Subtask[] = [];
        const targetStatus = FILTER_STATUS_MAP[activeFilter];
        let pendingCount = 0;

        for (const task of visibleTasksWithLiveActivities) {
            const phase = getTaskProgressPhase(task);
            const isPending = phase === "PENDING" || phase === "BLOCKED" || phase === "QUOTA";

            if (isPending) {
                pendingCount += 1;
            }

            if (
                activeFilter === "All"
                || (activeFilter === "Pending" && isPending)
                || (activeFilter !== "Pending" && targetStatus !== null && phase === targetStatus)
            ) {
                filteredTasks.push(task);
            }
        }

        return {
            filteredTasks,
            taskCounts: {
                All: visibleTasksWithLiveActivities.length,
                Running: visibleStats.running,
                Completed: visibleStats.completed,
                Failed: visibleStats.failed,
                Pending: pendingCount,
            } satisfies Record<TaskFilter, number>,
        };
    }, [activeFilter, visibleStats, visibleTasksWithLiveActivities]);

    const taskCardItems = useMemo(() => (
        filteredTasks.map((task) => {
            const taskRuntimeId = task.record_id || task.id;
            const dispatchInfo = task.record_id ? dispatchInfoByTaskId.get(task.record_id) : undefined;

            return {
                key: taskRuntimeId,
                task,
                taskTiming: taskTimingMap.get(taskRuntimeId) || taskTimingMap.get(task.id) || null,
                events: (task.record_id && taskEventsByRecordId.byRecordId.get(task.record_id))
                    || taskEventsByRecordId.byTaskKey.get(task.id)
                    || EMPTY_RUNTIME_EVENTS,
                isRerunning: rerunningIds.has(taskRuntimeId),
                dispatchInfo: dispatchInfo ?? null,
            };
        })
    ), [dispatchInfoByTaskId, filteredTasks, rerunningIds, taskEventsByRecordId, taskTimingMap]);



    return (
        <div className="max-w-[2400px] mx-auto px-8 md:px-20 py-24 flex flex-col gap-16 relative z-10">
            <LiveTransportBanner
                transportState={transportState}
                isRecovering={isRecovering}
                snapshotUpdatedAt={snapshotUpdatedAt}
                error={error}
            />

            <StatsHeader
                headerView={headerView}
                setHeaderView={setHeaderView}
                visibleStats={visibleStats}
                hasSprintContext={hasSprintContext}
                hasLiveSprint={hasLiveSprint}
                initialLoadComplete={initialLoadComplete}
                liveSprintRun={liveSprintRun}
                pausedInterventionRun={pausedInterventionRun}
                scopedFeatureBranch={status.sprint_id && sprintScopeId && status.sprint_id === sprintScopeId
                    ? status.feature_branch ?? null
                    : null}
                selectedSession={selectedSession}
                statusTimestamp={status.timestamp}
            />

            {pausedIntervention && !hasLiveSprint && (
                <div className="relative overflow-hidden rounded-[1.75rem] border border-status-amber/18 bg-status-amber/8 p-6 shadow-[0_12px_30px_rgba(245,158,11,0.08)]">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0">
                            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-status-amber">
                                <AlertTriangle className="w-3.5 h-3.5" strokeWidth={2.2} />
                                Sprint Paused For Human Intervention
                            </div>
                            <h3 className="mt-2 text-2xl font-black tracking-tight text-slate-900 dark:text-white font-display">
                                {pausedIntervention.title}
                            </h3>
                            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                                {pausedIntervention.reason}
                            </p>
                            <div className="mt-4 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                                What to do now
                            </div>
                            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                                {pausedIntervention.instructions}
                            </p>
                        </div>
                        <div className="shrink-0">
                            <HumanInterventionBadge summary={pausedIntervention} label="Details" align="right" />
                        </div>
                    </div>
                </div>
            )}

            {/* ── Header View: Stats or Boat Race ─────────────────────── */}
            {headerView === "stats" ? (
                <SprintStatsDeck
                    hasSprintContext={hasSprintContext}
                    stats={visibleStats}
                    tasks={visibleTasksWithLiveActivities}
                    sprintTiming={sprintTiming}
                />
            ) : headerView === "race" ? (
                /* ── Boat Race View ───────────────────────────────── */
                <Suspense fallback={<SkeletonPanel />}>
                    <SprintBoatRace
                        tasks={visibleTasksWithLiveActivities}
                        dispatches={sprintDispatches}
                        hasLiveSprint={hasLiveSprint}
                    />
                </Suspense>
            ) : (
                <Suspense fallback={<SkeletonPanel />}>
                    <SprintDag
                        tasks={visibleTasksWithLiveActivities}
                        dispatches={sprintDispatches}
                        hasSprintContext={hasSprintContext}
                    />
                </Suspense>
            )}

            {/* ── Section Divider ─────────────────────────────────────── */}
            <div className="w-full flex items-center justify-center py-4 relative z-10 overflow-hidden">
                <div className="absolute inset-y-1/2 inset-x-0 h-px bg-gradient-to-r from-transparent via-black/[0.06] dark:via-white/[0.06] to-transparent" />
                <div className="bg-[#F9F8F4] dark:bg-void-900 px-6 py-1.5 border border-black/[0.06] dark:border-white/[0.06] rounded-full shadow-sm relative z-10 text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-600">
                    Task Pipeline
                </div>
            </div>

            {/* ── Filter Strip ────────────────────────────────────────── */}
            <div className="-mt-8 flex flex-wrap gap-1 p-1 bg-black/[0.04] dark:bg-white/[0.04] rounded-xl w-fit">
                {TASK_FILTERS.map((filter) => (
                    <button
                        key={filter}
                        onClick={() => setFilter(filter)}
                        className={`text-xs font-semibold tracking-wide px-4 py-1.5 rounded-lg
                                   transition-all duration-200 flex items-center gap-2
                                   ${activeFilter === filter
                                       ? "bg-white dark:bg-void-700 text-slate-900 dark:text-white shadow-[0_1px_4px_rgba(0,0,0,0.08)] dark:shadow-[0_1px_4px_rgba(0,0,0,0.3)]"
                                       : "text-slate-500 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                                   }`}
                    >
                        {filter}
                        <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded-md
                            ${activeFilter === filter
                                ? "bg-signal-500/[0.12] text-signal-600 dark:text-signal-400"
                                : "bg-black/[0.06] dark:bg-white/[0.06] text-slate-400"
                            }`}>
                            {taskCounts[filter]}
                        </span>
                    </button>
                ))}
            </div>

            {/* ── Main Content Grid ───────────────────────────────────── */}
            <div ref={contentRef} className="flex flex-col xl:grid xl:grid-cols-12 gap-10 xl:gap-16">

                {/* Task cards */}
                <div className="xl:col-span-8 flex flex-col gap-5">
                    {!hasSprintContext && !initialLoadComplete ? (
                        /* Initial load in progress — render nothing to avoid flashing idle placeholder */
                        null
                    ) : !hasSprintContext ? (
                        <IdleRuntimeState
                            title={pausedIntervention ? "Human Intervention Needed" : "Waiting for Sprint Start"}
                            subtitle={pausedIntervention
                                ? pausedIntervention.instructions
                                : "Launch a sprint to activate live task telemetry, protocol output, and runtime activity for this project."}
                        />
                    ) : taskCardItems.length === 0 ? (
                        <div className="group relative overflow-hidden bg-white/70 dark:bg-void-800/60 backdrop-blur-2xl border-2 border-dashed border-black/[0.06] dark:border-white/[0.06] rounded-[1.75rem] p-16 text-center">
                            <div className="relative z-10">
                                <Play className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto mb-4" strokeWidth={1} />
                                <p className="text-sm text-slate-400 dark:text-slate-600 font-medium">
                                    {activeFilter === "All"
                                        ? "Awaiting sprint decomposition..."
                                        : `No ${activeFilter.toLowerCase()} tasks.`
                                    }
                                </p>
                            </div>
                        </div>
                    ) : (
                        taskCardItems.map(({ key, task, taskTiming, events, isRerunning, dispatchInfo }) => (
                            <LiveTaskCard
                                key={key}
                                task={task}
                                allTasks={visibleTasksWithLiveActivities}
                                taskTiming={taskTiming}
                                events={events}
                                onRerun={handleRerun}
                                isRerunning={isRerunning}
                                dispatchInfo={dispatchInfo}
                            />
                        ))
                    )}
                </div>

                {/* Sidebar — Reordered: Latest Activity & Git at top, collapsible panels */}
                <div className="xl:col-span-4 flex flex-col gap-5">
                    {/* 1. Latest Activity — always visible at top */}
                    <IntelPanel
                        title="Latest Activity"
                        icon={Activity}
                        accentHex="#00E0A0"
                        content={hasSprintContext ? status.reportText : undefined}
                        fallback={hasSprintContext ? "Waiting for activity..." : !initialLoadComplete ? "Connecting..." : "Waiting for sprint to start."}
                    />

                    {/* 2. Git/CI — moved to top, always visible */}
                    <GitCIStatusPanel status={gitStatus} error={gitStatusError} />

                    {/* 3. Execution Runtime — collapsible */}
                    <ExecutionTimelineProvider
                        execution={execution}
                        onOrchestrateSprint={handleOrchestrateSprint}
                        onPauseSprintRun={handlePauseSprintRun}
                        onCancelSprintRun={handleCancelSprintRun}
                        onForceCancelSprintRun={handleForceCancelSprintRun}
                        onCancelTaskDispatch={handleCancelTaskDispatch}
                        onForceCancelTaskDispatch={handleForceCancelTaskDispatch}
                        onRetryTaskDispatch={handleRetryTaskDispatch}
                        onClaimAttentionItem={handleClaimAttentionItem}
                        onResolveAttentionItem={handleResolveAttentionItem}
                        onDismissAttentionItem={handleDismissAttentionItem}
                        pendingActionIds={pendingActionIds}
                    >
                        <ExecutionRuntimePanel
                            collapsible
                            defaultOpen={hasSprintContext}
                        />
                    </ExecutionTimelineProvider>

                    {/* 4. Protocol — collapsible */}
                    <SprintProtocol
                        hasSprintContext={hasSprintContext}
                        instructions={status.instructions}
                    />
                </div>
            </div>
        </div>
    );
};
