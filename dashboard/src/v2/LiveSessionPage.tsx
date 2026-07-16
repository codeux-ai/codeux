import type { FunctionComponent } from "preact";
import { lazy, Suspense } from "preact/compat";
import { useLayoutEffect, useRef, useState, useEffect, useMemo } from "preact/hooks";
import gsap from "gsap";
import { Play } from "lucide-preact";
import { SprintStatsDeck, useLiveTaskTimingSummaries } from "./components/SprintStatsDeck.js";


import { useDashboardRuntimeData } from "../hooks/use-dashboard-runtime-data.js";
import { useSprints } from "../hooks/useSprints.js";
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
import { useDashboardExperienceMode } from "./context/experience-mode.js";
import { useProjectEffectiveSettings } from "./hooks/use-project-effective-settings.js";
import { useReducedMotion } from "./hooks/use-reduced-motion.js";
import { useRouteProjectSelection } from "./hooks/use-route-project-selection.js";
import { useInteractionTokens } from "./lib/motion/tokens.js";
import { fetchAgentPresets } from "./lib/agent-preset-api.js";
import type { AgentPreset } from "./types.js";
import { useConfirmDialog } from "./hooks/use-confirm-dialog.js";
import { ConfirmDialog } from "./components/ui/ConfirmDialog.js";
import { useActionFeedback } from "./hooks/use-action-feedback.js";
import { ActionFeedbackRegion } from "./components/ui/ActionFeedbackRegion.js";
import { forceCompleteLiveTask } from "./lib/api/live-tasks-client.js";
import { getSprintStatusPresentation } from "./lib/sprint-status-presentation.js";
import { useLiveI18n } from "./i18n/messages/live.js";

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

    const { locale, t } = useLiveI18n();
    const shellExperienceMode = useDashboardExperienceMode();
    const contentRef = useRef<HTMLDivElement>(null);
    const prefersReducedMotion = useReducedMotion();
    const interactionTokens = useInteractionTokens();
    const { selectedProjectId, selectProject, loading: projectsLoading } = useProjectData();
    const routeSearch = typeof window === "undefined" ? "" : window.location.search;
    const routeProjectId = useMemo(() => {
        const params = new URLSearchParams(routeSearch);
        return params.get("projectId")?.trim() || null;
    }, [routeSearch]);
    const routeSprintParam = useMemo(() => {
        const params = new URLSearchParams(routeSearch);
        return params.get("sprintId")?.trim() || params.get("sprint")?.trim() || null;
    }, [routeSearch]);

    const { routeProjectReady } = useRouteProjectSelection(
        routeProjectId,
        selectedProjectId,
        selectProject,
    );
    const liveProjectId = routeProjectReady ? selectedProjectId : null;
    const {
        data: liveProjectSprints,
        selectedSprintId: selectedNavigationSprintId,
        selectSprint,
        loading: sprintsLoading,
    } = useSprints(liveProjectId);
    const routeSprintId = useMemo(() => {
        if (!routeSprintParam) {
            return null;
        }
        return liveProjectSprints.some((sprint) => sprint.id === routeSprintParam) ? routeSprintParam : null;
    }, [liveProjectSprints, routeSprintParam]);
    useEffect(() => {
        if (!routeProjectReady || !routeSprintId || routeSprintId === selectedNavigationSprintId) {
            return;
        }
        void selectSprint(routeSprintId);
    }, [routeProjectReady, routeSprintId, selectedNavigationSprintId, selectSprint]);
    const effectiveNavigationSprintId = routeSprintId ?? selectedNavigationSprintId;
    const { data: effectiveSettings } = useProjectEffectiveSettings(liveProjectId);
    const experienceMode = shellExperienceMode === undefined
        ? effectiveSettings?.settings?.appearance?.experienceMode ?? "EXPERT"
        : shellExperienceMode;
    const showOperationalDetails = experienceMode === "EXPERT";
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
    } = useDashboardRuntimeData(
        liveProjectId,
        routeProjectReady && !projectsLoading && !sprintsLoading && !!liveProjectId,
        { selectedSprintId: effectiveNavigationSprintId },
    );
    // Git/CI/PR status lives on its own dedicated channel — it is large/slow and only rendered here,
    // so it no longer rides the shared live snapshot every page parses.
    const {
        data: gitStatus,
        error: gitStatusError,
        refresh: refreshGitStatus,
    } = useProjectGitStatus(
        liveProjectId,
        showOperationalDetails && routeProjectReady && !projectsLoading && !!liveProjectId,
    );
    const realtimeProjectId = liveProjectId || execution.projectId || status.project_id || null;
    const sprintScopeId = selectedSprintId || status.sprint_id || null;
    const { selectedSession } = usePreviewSessions({
        projectId: realtimeProjectId,
        selectedSprintId: sprintScopeId
    });
    const sprintScopeReady = Boolean(selectedSprintId || sprintScopeId || initialLoadComplete);

    const [agentPresetsMap, setAgentPresetsMap] = useState<Map<string, AgentPreset>>(new Map());
    useEffect(() => {
        if (!liveProjectId || !showOperationalDetails) {
            setAgentPresetsMap(new Map());
            return;
        }
        let cancelled = false;
        fetchAgentPresets(liveProjectId).then(presets => {
            if (!cancelled) setAgentPresetsMap(new Map(presets.map(p => [p.id, p])));
        }).catch(() => {});
        return () => { cancelled = true; };
    }, [liveProjectId, showOperationalDetails]);

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
    const localizedStatusTitle = sprintStatusPresentation.isManualPause
        ? pausedIntervention?.title || t("manualPauseTitle")
        : t("systemStoppedTitle");
    const localizedStatusDetail = sprintStatusPresentation.isManualPause
        ? pausedIntervention?.instructions || t("manualPauseDetail")
        : t("systemStoppedDetail");

    const rawHasSprintContext = runtimeState.hasSprintContext;
    const scopedRuntime = useMemo(
        () => deriveScopedLiveSessionRuntime(execution, sprintScopeId, sprintScopeReady),
        [execution, sprintScopeId, sprintScopeReady],
    );
    const sprintDispatches = scopedRuntime.dispatches;
    const sprintEvents = scopedRuntime.events;
    const sprintRuns = scopedRuntime.sprintRuns;
    const sprintInvocations = scopedRuntime.invocations;
    const sprintAttentionItems = scopedRuntime.attentionItems;

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
        includeTaskDetails: showOperationalDetails,
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
        () => showOperationalDetails
            ? deriveFilteredLiveSessionTasks(visibleTasksWithLiveActivities, visibleStats, activeFilter, locale)
            : deriveFilteredLiveSessionTasks([], visibleStats, "All", locale),
        [activeFilter, locale, showOperationalDetails, visibleStats, visibleTasksWithLiveActivities],
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
        showOperationalDetails
            ? deriveLiveSessionTaskCardItems({
                filteredTasks,
                dispatches: sprintDispatches,
                events: sprintEvents,
                invocations: sprintInvocations,
                attentionItems: sprintAttentionItems,
                taskTimingMap,
                rerunningIds,
                forceCompletePendingIds,
                forceCompleteErrorByTaskId,
                optimisticallyCompletedTaskIds,
            })
            : []
    ), [filteredTasks, forceCompleteErrorByTaskId, forceCompletePendingIds, optimisticallyCompletedTaskIds, rerunningIds, showOperationalDetails, sprintAttentionItems, sprintDispatches, sprintEvents, sprintInvocations, taskTimingMap]);

    const transportBannerViewModel = useMemo(
        () => deriveLiveTransportBannerViewModel({ transportState, isRecovering, error, snapshotUpdatedAt, locale }),
        [error, isRecovering, locale, snapshotUpdatedAt, transportState],
    );
    const snapshotSurface = useMemo(
        () => deriveLiveSessionSnapshotSurface({
            transportState,
            isRecovering,
            snapshotUpdatedAt,
            transportBannerTitle: transportBannerViewModel?.title ?? null,
            error,
            locale,
        }),
        [error, isRecovering, locale, snapshotUpdatedAt, transportBannerViewModel?.title, transportState],
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
            title: t("forceCompleteTask"),
            body: t("forceCompleteConfirm", { task: task.title || task.id }),
            confirmLabel: t("forceComplete"),
            destructive: true,
        });
        if (!confirmed) {
            return;
        }
        setPending(t("forceCompletingTask", { task: task.title || task.id }), { autoDismiss: false });
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
            setSuccess(t("taskCompleted", { task: task.title || task.id }));
        } catch (error) {
            setOptimisticallyCompletedTaskIds((prev) => {
                const next = new Set(prev);
                next.delete(taskRuntimeId);
                return next;
            });
            setForceCompleteErrorByTaskId((prev) => {
                const next = new Map(prev);
                next.set(taskRuntimeId, error instanceof Error ? error.message : t("forceCompleteFailed", { task: task.title || task.id }));
                return next;
            });
            setError(t("forceCompleteFailed", { task: task.title || task.id }));
        } finally {
            setForceCompletePendingIds((prev) => {
                const next = new Set(prev);
                next.delete(taskRuntimeId);
                return next;
            });
        }
    };



    return (
        <PageContainer aria-label={t("liveSession")} className="gap-16" aria-busy={!initialLoadComplete ? "true" : undefined}>
            <h1 className="sr-only">{t("liveSession")}</h1>
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
                {t(headerView === "stats" ? "statsViewSelected" : headerView === "race" ? "raceViewSelected" : "dagViewSelected")}
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
                <Suspense fallback={<div role="status" aria-live="polite" aria-busy="true"><span className="sr-only">{t("loadingSprintRace")}</span><SkeletonPanel /></div>}>
                    <SprintBoatRace
                        tasks={visibleTasksWithLiveActivities}
                        dispatches={sprintDispatches}
                        hasSprintContext={hasSprintContext}
                    />
                </Suspense>
            ) : (
                <Suspense fallback={<div role="status" aria-live="polite" aria-busy="true"><span className="sr-only">{t("loadingSprintDag")}</span><SkeletonPanel /></div>}>
                    <SprintDag
                        tasks={visibleTasksWithLiveActivities}
                        dispatches={sprintDispatches}
                        events={sprintEvents}
                        attentionItems={sprintAttentionItems}
                        hasSprintContext={hasSprintContext}
                    />
                </Suspense>
            )}

            {showOperationalDetails && (
            <>
            {/* ── Section Divider ─────────────────────────────────────── */}
            <SectionDivider label={t("taskPipeline")} />

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
                        <div role="status" aria-label={t("loadingLiveTelemetryAria")} aria-live="polite" aria-busy="true" className="sr-only">
                            {t("loadingLiveTelemetry")}
                        </div>
                    ) : !hasSprintContext ? (
                        <IdleRuntimeState
                            title={showStatusPanel ? localizedStatusTitle : t("waitingForSprintStart")}
                            subtitle={showStatusPanel
                                ? localizedStatusDetail
                                : t("waitingForSprintDescription")}
                        />
                    ) : taskCardItems.length === 0 ? (
                        <div role="status" aria-live="polite" className="group relative overflow-hidden rounded-[1.75rem] border-2 border-dashed border-black/[0.06] bg-white/70 p-16 text-center backdrop-blur-2xl dark:border-white/[0.06] dark:bg-void-800/60">
                            <div className="relative z-10">
                                <Play className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto mb-4" strokeWidth={1} aria-hidden="true" />
                                <p className="text-sm text-slate-400 dark:text-slate-600 font-medium">
                                    {activeFilter === "All"
                                        ? t("awaitingSprintDecomposition")
                                        : t("noFilteredTasks", {
                                            filter: t(({
                                                Running: "filterRunning",
                                                Completed: "filterCompleted",
                                                Failed: "filterFailed",
                                                Pending: "filterPendingLabel",
                                            } as const)[activeFilter]),
                                        })
                                    }
                                </p>
                            </div>
                        </div>
                    ) : (
                        taskCardItems.map(({ key, task, phase, taskTiming, events, invocations, ciPresentation, humanIntervention, isRerunning, isForceCompleting, forceCompleteError, dispatchInfo }) => (
                            <LiveTaskCard
                                key={key}
                                task={task}
                                allTasks={visibleTasksWithLiveActivities}
                                phase={phase}
                                taskTiming={taskTiming}
                                events={events}
                                invocations={invocations}
                                ciPresentation={ciPresentation}
                                humanIntervention={humanIntervention}
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
            </>
            )}
        </PageContainer>
    );
};
