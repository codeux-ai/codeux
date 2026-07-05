import type { FunctionComponent } from "preact";
import { lazy, Suspense } from "preact/compat";
import { useLayoutEffect, useRef, useState, useEffect, useMemo } from "preact/hooks";
import gsap from "gsap";
import { Play } from "lucide-preact";
import { SprintStatsDeck, useLiveTaskTimingSummaries } from "./components/SprintStatsDeck.js";


import { useDashboardRuntimeData } from "../hooks/use-dashboard-runtime-data.js";
import { useProjectGitStatus } from "./hooks/use-project-git-status.js";
import { usePreviewSessions } from "./hooks/use-preview-sessions.js";
import { useLiveSessionActions } from "./hooks/use-live-session-actions.js";
import type { Subtask } from "../types.js";
import { deriveLiveSessionRuntimeState } from "./lib/live-session-runtime.js";
import {
    deriveFilteredLiveSessionTasks,
    deriveHasLiveDurationTicker,
    deriveLiveSessionStats,
    deriveLiveSessionSnapshotSurface,
    deriveLiveSessionTaskCardItems,
    deriveLiveTransportBannerViewModel,
    deriveProjectedLiveSessionTasks,
    deriveScopedLiveSessionRuntime,
    type LiveSessionTaskFilter,
} from "./lib/live-session-view-model.js";
import { StatsHeader } from "./components/StatsHeader.js";
import { IdleRuntimeState } from "./components/ui/IdleRuntimeState.js";
import { SkeletonPanel } from "./components/layout/SkeletonLoader.js";
import { PageContainer } from "./components/layout/PageContainer.js";
import { SectionDivider } from "./components/ui/SectionDivider.js";
import { LiveTaskCard } from "./components/LiveTaskCard.js";
import { LiveTransportBanner } from "./components/live-session/LiveTransportBanner.js";
import { LiveTaskFilterStrip } from "./components/live-session/LiveTaskFilterStrip.js";
import { LiveSessionRuntimeSidebar } from "./components/live-session/LiveSessionRuntimeSidebar.js";
import { useProjectData } from "./context/project-data.js";
import { useProjectEffectiveSettings } from "./hooks/use-project-effective-settings.js";
import { useReducedMotion } from "./hooks/use-reduced-motion.js";
import { useInteractionTokens } from "./lib/motion/tokens.js";
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
    const interactionTokens = useInteractionTokens();
    const { selectedProjectId, loading: projectsLoading } = useProjectData();
    const { data: effectiveSettings } = useProjectEffectiveSettings(selectedProjectId);
    const sprintKeyPrefix = effectiveSettings?.settings?.git?.sprintKeyPrefix || "SPR";
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
    const { feedback, setPending, setSuccess, setError, clearFeedback, clearError } = useActionFeedback();

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

    const [activeFilter, setFilter] = useState<LiveSessionTaskFilter>("All");
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
        [execution, sprintScopeId, sprintScopeReady, status],
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
    const scopedRuntime = useMemo(
        () => deriveScopedLiveSessionRuntime(execution, sprintScopeId, sprintScopeReady),
        [execution, sprintScopeId, sprintScopeReady],
    );
    const sprintDispatches = scopedRuntime.dispatches;
    const sprintEvents = scopedRuntime.events;
    const sprintRuns = scopedRuntime.sprintRuns;
    const sprintInvocations = scopedRuntime.invocations;

    const visibleTasksWithLiveActivities = useMemo(() => (
        deriveProjectedLiveSessionTasks(tasksWithLiveActivities, sprintDispatches, sprintEvents)
    ), [sprintDispatches, sprintEvents, tasksWithLiveActivities]);

    const hasSprintContext = rawHasSprintContext || visibleTasksWithLiveActivities.length > 0;

    const [nowIso, setNowIso] = useState(() => new Date().toISOString());

    const visibleStats = useMemo(
        () => deriveLiveSessionStats(visibleTasksWithLiveActivities, hasSprintContext),
        [hasSprintContext, visibleTasksWithLiveActivities],
    );

    const { sprintTiming, taskTimings, taskTimingMap } = useLiveTaskTimingSummaries({
        tasks: visibleTasksWithLiveActivities,
        dispatches: sprintDispatches,
        events: sprintEvents,
        sprintRuns: sprintRuns,
        nowIso,
    });

    const hasLiveDurationTicker = useMemo(
        () => deriveHasLiveDurationTicker(taskTimings, sprintDispatches),
        [sprintDispatches, taskTimings],
    );

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

    const { filteredTasks, taskCounts, announcement: filterResultAnnouncement } = useMemo(
        () => deriveFilteredLiveSessionTasks(visibleTasksWithLiveActivities, visibleStats, activeFilter),
        [activeFilter, visibleStats, visibleTasksWithLiveActivities],
    );
    const selectionMovementStyle = useMemo(() => ({
        transitionDuration: interactionTokens.selectionMovement.duration,
        transitionTimingFunction: interactionTokens.selectionMovement.ease,
    }), [interactionTokens.selectionMovement.duration, interactionTokens.selectionMovement.ease]);
    const listReorderStyle = useMemo(() => ({
        transitionDuration: interactionTokens.listReorder.duration,
        transitionTimingFunction: interactionTokens.listReorder.ease,
    }), [interactionTokens.listReorder.duration, interactionTokens.listReorder.ease]);

    const taskCardItems = useMemo(() => (
        deriveLiveSessionTaskCardItems({
            filteredTasks,
            dispatches: sprintDispatches,
            events: sprintEvents,
            invocations: sprintInvocations,
            taskTimingMap,
            rerunningIds,
            forceCompletePendingIds,
            forceCompleteErrorByTaskId,
            optimisticallyCompletedTaskIds,
        })
    ), [filteredTasks, forceCompleteErrorByTaskId, forceCompletePendingIds, optimisticallyCompletedTaskIds, rerunningIds, sprintDispatches, sprintEvents, sprintInvocations, taskTimingMap]);

    const transportBannerViewModel = useMemo(
        () => deriveLiveTransportBannerViewModel({ transportState, isRecovering, error, snapshotUpdatedAt }),
        [error, isRecovering, snapshotUpdatedAt, transportState],
    );
    const snapshotSurface = useMemo(
        () => deriveLiveSessionSnapshotSurface({
            transportState,
            isRecovering,
            snapshotUpdatedAt,
            transportBannerTitle: transportBannerViewModel?.title ?? null,
        }),
        [isRecovering, snapshotUpdatedAt, transportBannerViewModel?.title, transportState],
    );

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
        if (forceCompletePendingIds.has(taskRuntimeId)) {
            return;
        }
        const confirmed = await requestConfirm({
            title: "Force Complete Task",
            body: `Mark task "${task.title || task.id}" as completed? This bypasses the normal runtime completion path.`,
            confirmLabel: "Force Complete",
            destructive: true,
        });
        if (!confirmed) {
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
                viewModel={transportBannerViewModel}
            />

            <ActionFeedbackRegion status={feedback.status} message={feedback.message} onDismiss={clearFeedback} clearError={clearError} />

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
            <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
                {headerView === "stats" ? "Stats view selected." : headerView === "race" ? "Race view selected." : "DAG view selected."}
            </div>

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
                <Suspense fallback={<div role="status" aria-live="polite" aria-busy="true"><span className="sr-only">Loading sprint race.</span><SkeletonPanel /></div>}>
                    <SprintBoatRace
                        tasks={visibleTasksWithLiveActivities}
                        dispatches={sprintDispatches}
                        hasSprintContext={hasSprintContext}
                    />
                </Suspense>
            ) : (
                <Suspense fallback={<div role="status" aria-live="polite" aria-busy="true"><span className="sr-only">Loading sprint DAG.</span><SkeletonPanel /></div>}>
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
            <LiveTaskFilterStrip
                activeFilter={activeFilter}
                taskCounts={taskCounts}
                announcement={filterResultAnnouncement}
                onFilterChange={setFilter}
                selectionMovementStyle={selectionMovementStyle}
            />

            {/* ── Main Content Grid ───────────────────────────────────── */}
            <div ref={contentRef} className="grid grid-cols-1 xl:grid-cols-12 gap-6 md:gap-10 xl:gap-16">

                {/* Task cards */}
                <div className="xl:col-span-8 flex flex-col gap-5 min-w-0" style={listReorderStyle}>
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
                        <div role="status" aria-live="polite" className="group relative overflow-hidden rounded-[1.75rem] border-2 border-dashed border-black/[0.06] bg-white/70 p-16 text-center backdrop-blur-2xl dark:border-white/[0.06] dark:bg-void-800/60">
                            <div className="relative z-10">
                                <Play className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto mb-4" strokeWidth={1} aria-hidden="true" />
                                <p className="text-sm text-slate-400 dark:text-slate-600 font-medium">
                                    {activeFilter === "All"
                                        ? "Awaiting sprint decomposition..."
                                        : `No ${activeFilter.toLowerCase()} tasks.`
                                    }
                                </p>
                            </div>
                        </div>
                    ) : (
                        taskCardItems.map(({ key, task, phase, taskTiming, events, invocations, isRerunning, isForceCompleting, forceCompleteError, dispatchInfo }) => (
                            <LiveTaskCard
                                key={key}
                                task={task}
                                allTasks={visibleTasksWithLiveActivities}
                                phase={phase}
                                taskTiming={taskTiming}
                                events={events}
                                invocations={invocations}
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
                <div className="xl:col-span-4 flex flex-col gap-5 min-w-0">
                    <LiveSessionRuntimeSidebar
                        execution={execution}
                        snapshotSurface={snapshotSurface}
                        hasSprintContext={hasSprintContext}
                        invocations={sprintInvocations}
                        sprintKeyPrefix={sprintKeyPrefix}
                        gitStatus={gitStatus}
                        gitStatusError={gitStatusError}
                        pendingActionIds={pendingActionIds}
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
                    />
                </div>
            </div>
        </PageContainer>
    );
};
