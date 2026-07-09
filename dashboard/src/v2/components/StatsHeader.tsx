import type { FunctionComponent, JSX } from "preact";
import { memo } from "preact/compat";
import { useLayoutEffect, useRef } from "preact/hooks";
import gsap from "gsap";
import { Radio, BarChart3, Ship, Workflow, AlertTriangle } from "lucide-preact";
import type {
  DashboardStats,
  ExecutionSprintRunSummary,
  SprintPreviewSession,
} from "../../types.js";

import { formatTime } from "../../lib/time.js";
import { LivePreviewLink } from "./ui/LivePreviewLink.js";
import { HumanInterventionBadge } from "./ui/HumanInterventionBadge.js";
import { getSprintStatusPresentation } from "../lib/sprint-status-presentation.js";
import { PageHeader } from "./layout/PageHeader.js";
import { useAnimatedActiveIndicator } from "../lib/motion/index.js";

type HeaderView = "stats" | "race" | "dag";

export interface StatsHeaderProps {
    headerView: HeaderView;
    setHeaderView: (view: HeaderView) => void;
    visibleStats: DashboardStats;
    hasSprintContext: boolean;
    hasLiveSprint: boolean;
    initialLoadComplete: boolean;
    liveSprintRun: ExecutionSprintRunSummary | null;
    pausedInterventionRun: ExecutionSprintRunSummary | null;
    scopedFeatureBranch: string | null;
    selectedSession: SprintPreviewSession | null;
    statusTimestamp: string | null;
}

export const StatsHeader: FunctionComponent<StatsHeaderProps> = memo(({
    headerView,
    setHeaderView,
    visibleStats,
    hasSprintContext,
    hasLiveSprint,
    initialLoadComplete,
    liveSprintRun,
    pausedInterventionRun,
    scopedFeatureBranch,
    selectedSession,
    statusTimestamp,
}) => {
    const headerRef = useRef<HTMLDivElement>(null);
    const pausedIntervention = pausedInterventionRun?.humanIntervention || null;
    const sprintStatusPresentation = getSprintStatusPresentation({
      state: hasLiveSprint ? "running" : pausedInterventionRun?.status ?? "unknown",
      pauseSource: pausedIntervention?.ownerType ?? null,
      humanInterventionTitle: pausedIntervention?.title ?? null,
      humanInterventionReason: pausedIntervention?.reason ?? null,
      humanInterventionInstructions: pausedIntervention?.instructions ?? null,
      humanInterventionOwnerType: pausedIntervention?.ownerType ?? null,
    });
    const showStatusPanel = !hasLiveSprint && (sprintStatusPresentation.isManualPause || sprintStatusPresentation.isSystemStop);

    useLayoutEffect(() => {
        if (headerRef.current) {
            gsap.fromTo(
                Array.from(headerRef.current.children),
                { opacity: 0, y: 40 },
                { opacity: 1, y: 0, stagger: 0.1, duration: 0.9, ease: "power4.out", delay: 0.05 },
            );
        }
    }, []);

    const btnStatsRef = useRef<HTMLButtonElement>(null);
    const btnRaceRef = useRef<HTMLButtonElement>(null);
    const btnDagRef = useRef<HTMLButtonElement>(null);
    const viewToggleRef = useRef<HTMLDivElement>(null);
    const activeIndex = headerView === "stats" ? 0 : headerView === "race" ? 1 : 2;
    const indicator = useAnimatedActiveIndicator(viewToggleRef, activeIndex, '[role="tab"]', 'horizontal');
    const viewTabRefs = [btnStatsRef, btnRaceRef, btnDagRef];

    const handleViewToggleKeyDown = (event: JSX.TargetedKeyboardEvent<HTMLButtonElement>, currentIndex: number): void => {
        let nextIndex = currentIndex;

        if (event.key === "ArrowRight" || event.key === "ArrowDown") {
            event.preventDefault();
            nextIndex = (currentIndex + 1) % viewTabRefs.length;
        } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
            event.preventDefault();
            nextIndex = (currentIndex - 1 + viewTabRefs.length) % viewTabRefs.length;
        } else if (event.key === "Home") {
            event.preventDefault();
            nextIndex = 0;
        } else if (event.key === "End") {
            event.preventDefault();
            nextIndex = viewTabRefs.length - 1;
        }

        if (nextIndex !== currentIndex) {
            viewTabRefs[nextIndex]?.current?.focus();
        }
    };

    useLayoutEffect(() => {
        if (headerView === "stats") btnStatsRef.current?.focus();
        else if (headerView === "race") btnRaceRef.current?.focus();
        else if (headerView === "dag") btnDagRef.current?.focus();
    }, [headerView]);

    return (
        <>
            {/* ── Page Header ─────────────────────────────────────────── */}
            <PageHeader
                containerRef={headerRef}
                as="h2"
                eyebrow={
                    <>
                        <Radio className="w-3.5 h-3.5 text-status-red" strokeWidth={2.5} />
                        <span className="text-status-red">Live Session</span>
                        {(liveSprintRun?.sprintNumber ?? pausedInterventionRun?.sprintNumber) != null && (
                            <span className="text-slate-400 ml-1">· Sprint {liveSprintRun?.sprintNumber ?? pausedInterventionRun?.sprintNumber}</span>
                        )}
                    </>
                }
                title="Sprint Pipeline"
                subtitle={
                    hasLiveSprint
                        ? scopedFeatureBranch
                            ? <>Monitoring <span className="font-mono text-signal-600 dark:text-signal-400">{scopedFeatureBranch}</span> in real-time.</>
                            : `Monitoring ${liveSprintRun?.sprintName || "the active sprint"} in real-time.`
                        : showStatusPanel
                            ? sprintStatusPresentation.detail
                            : hasSprintContext
                                ? "Viewing the latest sprint telemetry snapshot."
                                : !initialLoadComplete
                                    ? "Connecting to orchestrator..."
                                    : "Waiting for sprint to start."
                }
                actions={
                /* Right: pills + view toggle + timestamp */
                <div className="flex flex-col items-start lg:items-end gap-4 shrink-0">
                    <div className="flex items-center gap-2.5 flex-wrap">
                        <LivePreviewLink session={selectedSession} />
                        {/* ── View Toggle ─────────────────────────────── */}
                        <div ref={viewToggleRef} className="relative flex gap-0.5 p-0.5 bg-black/[0.04] dark:bg-white/[0.04] rounded-xl backdrop-blur-md" role="tablist" aria-label="View toggle">
                            <div
                                aria-hidden="true"
                                className="absolute top-0.5 bottom-0.5 left-0 z-0 rounded-[10px] pointer-events-none bg-white dark:bg-void-700 shadow-[0_2px_10px_rgba(0,0,0,0.08)] dark:shadow-[0_2px_10px_rgba(0,0,0,0.3)]"
                                style={indicator.style as JSX.CSSProperties}
                            />
                            <button
                                type="button"
                                ref={btnStatsRef}
                                onClick={() => setHeaderView("stats")}
                                role="tab"
                                aria-selected={headerView === "stats"}
                                tabIndex={headerView === "stats" ? 0 : -1}
                                onKeyDown={(event) => handleViewToggleKeyDown(event, 0)}
                                className={`relative z-10 flex items-center gap-1.5 px-3.5 py-2 rounded-[10px] text-[10px] font-bold uppercase tracking-[0.14em] transition-colors duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-void-800 ${headerView === "stats" ? "text-slate-900 dark:text-white" : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"}`}
                            >
                                <BarChart3 className="w-3 h-3" strokeWidth={2} />
                                Stats
                            </button>
                            <button
                                type="button"
                                ref={btnRaceRef}
                                onClick={() => setHeaderView("race")}
                                role="tab"
                                aria-selected={headerView === "race"}
                                tabIndex={headerView === "race" ? 0 : -1}
                                onKeyDown={(event) => handleViewToggleKeyDown(event, 1)}
                                className={`relative z-10 flex items-center gap-1.5 px-3.5 py-2 rounded-[10px] text-[10px] font-bold uppercase tracking-[0.14em] transition-colors duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-void-800 ${headerView === "race" ? "text-slate-900 dark:text-white" : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"}`}
                            >
                                <Ship className="w-3 h-3" strokeWidth={2} />
                                Race
                            </button>
                            <button
                                type="button"
                                ref={btnDagRef}
                                onClick={() => setHeaderView("dag")}
                                role="tab"
                                aria-selected={headerView === "dag"}
                                tabIndex={headerView === "dag" ? 0 : -1}
                                onKeyDown={(event) => handleViewToggleKeyDown(event, 2)}
                                className={`relative z-10 flex items-center gap-1.5 px-3.5 py-2 rounded-[10px] text-[10px] font-bold uppercase tracking-[0.14em] transition-colors duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-void-800 ${headerView === "dag" ? "text-slate-900 dark:text-white" : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"}`}
                            >
                                <Workflow className="w-3 h-3" strokeWidth={2} />
                                DAG
                            </button>
                        </div>

                        <div className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] rounded-full border flex items-center gap-2.5 backdrop-blur-md ${hasLiveSprint ? "bg-signal-500/10 dark:bg-signal-500/10 text-signal-600 dark:text-signal-400 border-signal-500/25 dark:border-signal-500/25 shadow-[0_0_20px_rgba(0,224,160,0.08)]" : showStatusPanel ? "bg-status-amber/10 text-status-amber border-status-amber/25" : "bg-black/10 dark:bg-white/10 text-slate-500 border-black/25 dark:border-white/25"}`}>
                            <span className={`w-2 h-2 rounded-full relative ${hasLiveSprint ? "bg-signal-500" : showStatusPanel ? "bg-status-amber" : "bg-slate-400"}`}>
                                {hasLiveSprint && <span className="absolute inset-0 rounded-full motion-safe:animate-ping bg-signal-400 opacity-60" />}
                            </span>
                            {hasLiveSprint ? `${visibleStats.running} Running` : showStatusPanel ? sprintStatusPresentation.statusLabel : hasSprintContext ? "Snapshot loaded" : !initialLoadComplete ? "Connecting" : "Waiting"}
                        </div>
                        {pausedIntervention && !hasLiveSprint && sprintStatusPresentation.showHumanInterventionBadge && (
                            <HumanInterventionBadge summary={pausedIntervention} label="Needs you" align="right" />
                        )}
                        {visibleStats.failed > 0 && (
                            <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] rounded-full bg-status-red/10 text-status-red border border-status-red/25 flex items-center gap-2.5 backdrop-blur-md">
                                <span className="w-2 h-2 rounded-full bg-status-red relative">
                                    <span className="absolute inset-0 rounded-full motion-safe:animate-ping bg-status-red opacity-50" />
                                </span>
                                {visibleStats.failed} Failed
                            </div>
                        )}
                    </div>
                    {statusTimestamp && hasSprintContext && (
                        <span className="text-[10px] font-mono text-slate-400">
                            Updated {formatTime(statusTimestamp)}
                        </span>
                    )}
                </div>
                }
            />

            {showStatusPanel && (
                <div className="relative overflow-hidden rounded-[1.75rem] border border-status-amber/18 bg-status-amber/8 p-6 shadow-[0_12px_30px_rgba(245,158,11,0.08)]">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0">
                            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-status-amber">
                                <AlertTriangle className="w-3.5 h-3.5" strokeWidth={2.2} />
                                {sprintStatusPresentation.title}
                            </div>
                            <h3 className="mt-2 text-xl font-semibold tracking-tight text-slate-900 dark:text-white font-display">
                                {sprintStatusPresentation.reason}
                            </h3>
                            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                                {sprintStatusPresentation.detail}
                            </p>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
});
