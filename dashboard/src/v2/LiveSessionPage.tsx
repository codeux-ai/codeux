import type { FunctionComponent } from "preact";
import { lazy, Suspense } from "preact/compat";
import { useLayoutEffect, useRef, useState, useEffect, useMemo } from "preact/hooks";
import gsap from "gsap";
import {
    Zap, Clock, CheckCircle2, XCircle,
    ChevronDown, Radio,
    Play, RotateCcw, Bot, Workflow, PauseCircle,
    Ship, BarChart3,
} from "lucide-preact";
import { SprintStatsDeck, useLiveTaskTimingSummaries } from "./components/SprintStatsDeck.js";
import { WaveFluid } from "./components/ui/WaveFluid.js";
import { BorderTrace } from "./components/ui/BorderTrace.js";
import { useDashboardRuntimeData } from "../hooks/use-dashboard-runtime-data.js";
import { useProjectGitStatus } from "./hooks/use-project-git-status.js";
import { usePreviewSessions } from "./hooks/use-preview-sessions.js";
import { useLiveSessionActions } from "./hooks/use-live-session-actions.js";
import { formatTime } from "../lib/time.js";
import { renderMarkdown } from "../lib/markdown.js";
import type { Subtask, ExecutionRuntimeEventSummary } from "../types.js";
import { deriveLiveSessionRuntimeState } from "./lib/live-session-runtime.js";
import { getTaskProgressPhase, getLiveTaskProgressPhase } from "../lib/task-progress.js";
import { pickLatestTaskDispatch, projectLiveTask, findActiveQuotaWait } from "./lib/live-task-runtime.js";
import { CollapsiblePanel } from "./components/ui/CollapsiblePanel.js";
import { ExecutionTimelineProvider } from "../hooks/ExecutionTimelineContext.js";
import { ExecutionTimeline } from "./components/ExecutionTimeline.js";
import { AttentionLedger } from "./components/AttentionLedger.js";
import { ConnectionRuntimePanel, ExecutionRuntimePanel } from "./components/live-session/ExecutionRuntimePanel.js";
import { StatsHeader } from "./components/StatsHeader.js";
import { IdleRuntimeState } from "./components/ui/IdleRuntimeState.js";
import { SkeletonPanel } from "./components/layout/SkeletonLoader.js";
import { PageContainer } from "./components/layout/PageContainer.js";
import { SectionDivider } from "./components/ui/SectionDivider.js";
import {
    EMPTY_RUNTIME_STATS,
} from "./lib/live-session-config.js";
import { LiveTaskCard, TaskDuration, QuotaCountdown } from "./components/LiveTaskCard.js";
import { LiveTransportBanner } from "./components/live-session/LiveTransportBanner.js";
import { RuntimeEventFeed } from "./components/RuntimeEventFeed.js";
import { GitCIStatusPanel } from "./components/GitCIStatusPanel.js";
import { deriveLiveDurationDisplay } from "./lib/live-duration-display.js";
import { useProjectData } from "./context/project-data.js";
import { useReducedMotion } from "./hooks/use-reduced-motion.js";
import { fetchAgentPresets } from "./lib/agent-preset-api.js";
import type { AgentPreset } from "./types.js";
import { useConfirmDialog } from "./hooks/use-confirm-dialog.js";
import { ConfirmDialog } from "./components/ui/ConfirmDialog.js";
import { useActionFeedback } from "./hooks/use-action-feedback.js";
import { ActionFeedbackRegion } from "./components/ui/ActionFeedbackRegion.js";
import { forceCompleteLiveTask } from "./lib/api/live-tasks-client.js";
import { getSprintStatusPresentation } from "./lib/sprint-status-presentation.js";

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
    const prefersReducedMotion = useReducedMotion();
    const { selectedProjectId, loading: projectsLoading } = useProjectData();
    const {
        error,
        execution,
        initialLoadComplete,
        transportState,
        isRecovering,
        snapshotUpdatedAt,
        refreshRuntimeStatus,
        selectedSprintId,
        status,
        tasksWithLiveActivities,
    } = useDashboardRuntimeData(selectedProjectId, !projectsLoading && !!selectedProjectId);
    // Git/CI/PR status lives on its own dedicated channel — it is large/slow and only rendered here,
    // so it no longer rides the shared live snapshot every page parses.
    const {
        data: gitStatus,
        error: gitStatusError,
        refresh: refreshGitStatus,
    } = useProjectGitStatus(selectedProjectId, !projectsLoading && !!selectedProjectId);
    const realtimeProjectId = selectedProjectId || execution.projectId || status.project_id || null;
    const sprintScopeId = selectedSprintId || status.sprint_id || null;
    const { selectedSession } = usePreviewSessions({
        projectId: realtimeProjectId,
        selectedSprintId: sprintScopeId
    });
    const sprintScopeReady = Boolean(selectedSprintId || sprintScopeId || initialLoadComplete);

    const [agentPresetsMap, setAgentPresetsMap] = useState<Map<string, AgentPreset>>(new Map());
    useEffect(() => {
        if (!selectedProjectId) return;
        let cancelled = false;
        fetchAgentPresets(selectedProjectId).then(presets => {
            if (!cancelled) setAgentPresetsMap(new Map(presets.map(p => [p.id, p])));
        }).catch(() => {});
        return () => { cancelled = true; };
    }, [selectedProjectId]);

    const { isOpen: isConfirmOpen, options: confirmOptions, requestConfirm, handleConfirm, handleCancel } = useConfirmDialog();
    const { feedback, setPending, setSuccess, setError, clearFeedback } = useActionFeedback();

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
    } = useLiveSessionActions(refreshRuntimeStatus, refreshGitStatus, requestConfirm);

    const [activeFilter, setFilter] = useState<TaskFilter>("All");
    const [headerView, setHeaderView] = useState<HeaderView>("dag");
    const [forceCompletePendingIds, setForceCompletePendingIds] = useState<Set<string>>(new Set());
    const [forceCompleteErrorByTaskId, setForceCompleteErrorByTaskId] = useState<Map<string, string>>(new Map());
    const [optimisticallyCompletedTaskIds, setOptimisticallyCompletedTaskIds] = useState<Set<string>>(new Set());

    /* GSAP entrance */
    useLayoutEffect(() => {
        const ctx = gsap.context(() => {
            if (contentRef.current) {
                if (prefersReducedMotion) {
                    gsap.set(Array.from(contentRef.current.children), { opacity: 1, y: 0 });
                } else {
                    gsap.fromTo(
                        Array.from(contentRef.current.children),
                        { opacity: 0, y: 50 },
                        { opacity: 1, y: 0, stagger: 0.08, duration: 1, ease: "power4.out", delay: 0.2 },
                    );
                }
            }
        });
        return () => ctx.revert();
    }, [prefersReducedMotion]);

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
    const sprintStatusPresentation = useMemo(() => getSprintStatusPresentation({
        state: hasLiveSprint ? "running" : pausedInterventionRun?.status ?? "unknown",
        pauseSource: pausedIntervention?.ownerType ?? null,
        humanInterventionTitle: pausedIntervention?.title ?? null,
        humanInterventionReason: pausedIntervention?.reason ?? null,
        humanInterventionInstructions: pausedIntervention?.instructions ?? null,
        humanInterventionOwnerType: pausedIntervention?.ownerType ?? null,
    }), [hasLiveSprint, pausedIntervention?.instructions, pausedIntervention?.ownerType, pausedIntervention?.reason, pausedIntervention?.title, pausedInterventionRun?.status]);
    const showStatusPanel = !hasLiveSprint && (sprintStatusPresentation.isManualPause || sprintStatusPresentation.isSystemStop);

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

    const visibleTasksWithLiveActivities = useMemo(() => (
        tasksWithLiveActivities.map((task) => projectLiveTask(task, sprintDispatches, sprintEvents))
    ), [sprintDispatches, sprintEvents, tasksWithLiveActivities]);

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
            qa: visibleTasksWithLiveActivities.filter((task) => task.merge_indicator === "QA_PENDING").length,
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
            const optimisticTask: Subtask = optimisticallyCompletedTaskIds.has(taskRuntimeId)
                ? { ...task, status: "COMPLETED" as const }
                : task;
            const latestDispatch = pickLatestTaskDispatch(task, sprintDispatches);
            const taskEvents = (task.record_id && taskEventsByRecordId.byRecordId.get(task.record_id))
                || taskEventsByRecordId.byTaskKey.get(task.id)
                || EMPTY_RUNTIME_EVENTS;
            // Resolve the live phase from the latest dispatch so states the task record
            // hasn't caught up to yet — notably QUOTA while waiting on a provider reset —
            // surface on the card instead of lingering as "Running". Preserve the optimistic
            // force-complete state when one is pending.
            const dispatchPhase = optimisticallyCompletedTaskIds.has(taskRuntimeId)
                ? "COMPLETED" as const
                : getLiveTaskProgressPhase({ task: optimisticTask, dispatch: latestDispatch });
            // When `retryOnQuotaReset` is on, the provider sleeps in-process and the dispatch
            // stays "running"; detect that wait from runtime events so the card still shows
            // QUOTA + a countdown rather than a misleading "Running" while we wait on quota.
            // IMPORTANT: Only look at events belonging to the *current* dispatch to prevent
            // stale quota-wait events from a previous run (which may still have a future
            // retryAfterIso) from incorrectly showing QUOTA during a fresh rerun.
            const currentDispatchEvents = latestDispatch
                ? taskEvents.filter((e) =>
                    (latestDispatch.taskRunId && e.taskRunId === latestDispatch.taskRunId)
                    || (latestDispatch.id && e.dispatchId === latestDispatch.id),
                  )
                : [];
            const activeQuotaWait = ["FAILED", "BLOCKED", "QUOTA", "COMPLETED"].includes(dispatchPhase)
                ? null
                : findActiveQuotaWait(currentDispatchEvents);
            const taskPhase = activeQuotaWait ? "QUOTA" as const : dispatchPhase;
            const showDispatchError = activeQuotaWait
                ? `Provider quota exhausted — waiting for reset. [RETRY_AFTER:${activeQuotaWait.retryAfterIso}]`
                : latestDispatch && ["FAILED", "BLOCKED", "QUOTA"].includes(taskPhase)
                    ? latestDispatch.errorMessage
                    : null;

            return {
                key: taskRuntimeId,
                task: optimisticTask,
                phase: taskPhase,
                taskTiming: taskTimingMap.get(taskRuntimeId) || taskTimingMap.get(task.id) || null,
                events: taskEvents,
                isRerunning: rerunningIds.has(taskRuntimeId),
                isForceCompleting: forceCompletePendingIds.has(taskRuntimeId),
                forceCompleteError: forceCompleteErrorByTaskId.get(taskRuntimeId) || null,
                dispatchInfo: (latestDispatch || activeQuotaWait) ? {
                    errorMessage: showDispatchError,
                    startedAt: latestDispatch?.startedAt ?? null,
                    finishedAt: latestDispatch?.finishedAt ?? null,
                    status: latestDispatch?.status ?? null,
                } : null,
            };
        })
    ), [filteredTasks, forceCompleteErrorByTaskId, forceCompletePendingIds, optimisticallyCompletedTaskIds, rerunningIds, sprintDispatches, taskEventsByRecordId, taskTimingMap]);

    const handleEditTask = (task: Subtask): void => {
        const search = new URLSearchParams();
        search.set("taskId", task.record_id || task.id);
        if (task.sprint_id) {
            search.set("sprintId", task.sprint_id);
        }
        window.location.href = `/tasks?${search.toString()}`;
    };

    const handleForceCompleteTask = async (task: Subtask): Promise<void> => {
        const taskRuntimeId = task.record_id || task.id;
        if (!realtimeProjectId || !taskRuntimeId) {
            return;
        }
        setForceCompletePendingIds((prev) => new Set(prev).add(taskRuntimeId));
        setForceCompleteErrorByTaskId((prev) => {
            const next = new Map(prev);
            next.delete(taskRuntimeId);
            return next;
        });
        setOptimisticallyCompletedTaskIds((prev) => new Set(prev).add(taskRuntimeId));
        try {
            await forceCompleteLiveTask(realtimeProjectId, taskRuntimeId);
            await refreshRuntimeStatus();
            await refreshGitStatus();
            setSuccess("Task marked as completed.");
        } catch (error) {
            setOptimisticallyCompletedTaskIds((prev) => {
                const next = new Set(prev);
                next.delete(taskRuntimeId);
                return next;
            });
            setForceCompleteErrorByTaskId((prev) => {
                const next = new Map(prev);
                next.set(taskRuntimeId, error instanceof Error ? error.message : "Failed to force complete task.");
                return next;
            });
            setError("Failed to force complete task.");
        } finally {
            setForceCompletePendingIds((prev) => {
                const next = new Set(prev);
                next.delete(taskRuntimeId);
                return next;
            });
        }
    };



    return (
        <PageContainer aria-label="Live Session" className="gap-16">
            <h1 className="sr-only">Live Session</h1>
            <ConfirmDialog isOpen={isConfirmOpen} options={confirmOptions} onConfirm={handleConfirm} onCancel={handleCancel} />
            <LiveTransportBanner
                transportState={transportState}
                isRecovering={isRecovering}
                snapshotUpdatedAt={snapshotUpdatedAt}
                error={error}
            />

            <ActionFeedbackRegion status={feedback.status} message={feedback.message} onDismiss={clearFeedback} />

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
                        hasSprintContext={hasSprintContext}
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
            <SectionDivider label="Task Pipeline" />

            {/* ── Filter Strip ────────────────────────────────────────── */}
            <div className="-mt-8 flex gap-1 p-1 bg-black/[0.04] dark:bg-white/[0.04] rounded-xl w-fit">
                {TASK_FILTERS.map((filter) => (
                    <button
                        key={filter}
                        onClick={() => setFilter(filter)}
                        aria-pressed={activeFilter === filter}
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
            <div ref={contentRef} className="grid grid-cols-1 xl:grid-cols-12 gap-10 xl:gap-16">

                {/* Task cards */}
                <div className="xl:col-span-8 flex flex-col gap-5">
                    {!hasSprintContext && !initialLoadComplete ? (
                        /* Initial load in progress — render nothing to avoid flashing idle placeholder */
                        null
                    ) : !hasSprintContext ? (
                        <IdleRuntimeState
                            title={showStatusPanel ? sprintStatusPresentation.title : "Waiting for Sprint Start"}
                            subtitle={showStatusPanel
                                ? sprintStatusPresentation.detail
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
                        taskCardItems.map(({ key, task, phase, taskTiming, events, isRerunning, isForceCompleting, forceCompleteError, dispatchInfo }) => (
                            <LiveTaskCard
                                key={key}
                                task={task}
                                allTasks={visibleTasksWithLiveActivities}
                                phase={phase}
                                taskTiming={taskTiming}
                                events={events}
                                onRerun={handleRerun}
                                onEdit={handleEditTask}
                                onForceComplete={handleForceCompleteTask}
                                isRerunning={isRerunning}
                                isForceCompleting={isForceCompleting}
                                forceCompleteError={forceCompleteError}
                                dispatchInfo={dispatchInfo}
                                agentPreset={task.agentPresetId ? agentPresetsMap.get(task.agentPresetId) ?? null : null}
                            />
                        ))
                    )}
                </div>

                {/* Sidebar */}
                <div className="xl:col-span-4 flex flex-col gap-5">
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
                        <ConnectionRuntimePanel />
                        <GitCIStatusPanel status={gitStatus} error={gitStatusError} />
                        <AttentionLedger collapsible defaultOpen={hasSprintContext} />
                        <ExecutionTimeline collapsible defaultOpen={hasSprintContext} />
                        <ExecutionRuntimePanel
                            collapsible
                            defaultOpen={hasSprintContext}
                        />
                    </ExecutionTimelineProvider>
                </div>
            </div>
        </PageContainer>
    );
};
