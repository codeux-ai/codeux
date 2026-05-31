import type { FunctionComponent } from "preact";
import { memo } from "preact/compat";
import { useLayoutEffect, useRef } from "preact/hooks";
import gsap from "gsap";
import { Radio, BarChart3, Ship, Workflow, AlertTriangle } from "lucide-preact";
import { useReducedMotion } from "../hooks/use-reduced-motion.js";
import type {
  DashboardStats,
  ExecutionSprintRunSummary,
  SprintPreviewSession,
} from "../../types.js";

import { formatTime } from "../../lib/time.js";
import { LivePreviewLink } from "./ui/LivePreviewLink.js";
import { HumanInterventionBadge } from "./ui/HumanInterventionBadge.js";
import { getSprintStatusPresentation } from "../lib/sprint-status-presentation.js";

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

    return (
        <>
            {/* ── Page Header ─────────────────────────────────────────── */}
            <div ref={headerRef} className="flex flex-col lg:flex-row items-start lg:items-end justify-between gap-8">
                <div className="flex flex-col gap-5">
                    {/* Eyebrow */}
                    <div className="flex items-center gap-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.2em]">
                        <Radio className="w-3.5 h-3.5 text-status-red" strokeWidth={2.5} />
                        <span className="text-status-red">Live Session</span>
                        {(liveSprintRun?.sprintNumber ?? pausedInterventionRun?.sprintNumber) != null && (
                            <span className="text-slate-400 ml-1">· Sprint {liveSprintRun?.sprintNumber ?? pausedInterventionRun?.sprintNumber}</span>
                        )}
                    </div>

                    {/* Hero headline */}
                    <div className="relative overflow-hidden">
                        <h2
                            aria-hidden
                            className="absolute -top-10 -left-3 text-[7rem] font-black tracking-tighter text-black/[0.04] dark:text-white/[0.03] pointer-events-none select-none font-display leading-none"
                        >
                            LIVE
                        </h2>
                        <h1 className="text-5xl md:text-7xl font-black tracking-tighter text-slate-900 dark:text-white leading-[0.92] font-display relative z-10">
                            Sprint <br />
                            <span className="text-signal-500">Pipeline.</span>
                        </h1>
                    </div>

                    <p className="text-lg text-slate-500 dark:text-slate-500 font-medium max-w-xl mt-1 leading-relaxed">
                        {hasLiveSprint
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
                    </p>
                </div>

                {/* Right: pills + view toggle + timestamp */}
                <div className="flex flex-col items-start lg:items-end gap-4 shrink-0">
                    <div className="flex items-center gap-2.5 flex-wrap">
                        <LivePreviewLink session={selectedSession} />
                        {/* ── View Toggle ─────────────────────────────── */}
                        <div className="flex gap-0.5 p-0.5 bg-black/[0.04] dark:bg-white/[0.04] rounded-xl backdrop-blur-md">
                            <button
                                type="button"
                                onClick={() => setHeaderView("stats")}
                                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-[10px] text-[10px] font-bold uppercase tracking-[0.14em] transition-all duration-300 ${headerView === "stats" ? "bg-white dark:bg-void-700 text-slate-900 dark:text-white shadow-[0_2px_10px_rgba(0,0,0,0.08)] dark:shadow-[0_2px_10px_rgba(0,0,0,0.3)]" : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"}`}
                            >
                                <BarChart3 className="w-3 h-3" strokeWidth={2} />
                                Stats
                            </button>
                            <button
                                type="button"
                                onClick={() => setHeaderView("race")}
                                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-[10px] text-[10px] font-bold uppercase tracking-[0.14em] transition-all duration-300 ${headerView === "race" ? "bg-white dark:bg-void-700 text-slate-900 dark:text-white shadow-[0_2px_10px_rgba(0,0,0,0.08)] dark:shadow-[0_2px_10px_rgba(0,0,0,0.3)]" : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"}`}
                            >
                                <Ship className="w-3 h-3" strokeWidth={2} />
                                Race
                            </button>
                            <button
                                type="button"
                                onClick={() => setHeaderView("dag")}
                                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-[10px] text-[10px] font-bold uppercase tracking-[0.14em] transition-all duration-300 ${headerView === "dag" ? "bg-white dark:bg-void-700 text-slate-900 dark:text-white shadow-[0_2px_10px_rgba(0,0,0,0.08)] dark:shadow-[0_2px_10px_rgba(0,0,0,0.3)]" : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"}`}
                            >
                                <Workflow className="w-3 h-3" strokeWidth={2} />
                                DAG
                            </button>
                        </div>

                        <div className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] rounded-full border flex items-center gap-2.5 backdrop-blur-md ${hasLiveSprint ? "bg-signal-500/10 dark:bg-signal-500/10 text-signal-600 dark:text-signal-400 border-signal-500/25 dark:border-signal-500/25 shadow-[0_0_20px_rgba(0,224,160,0.08)]" : showStatusPanel ? "bg-status-amber/10 text-status-amber border-status-amber/25" : "bg-black/10 dark:bg-white/10 text-slate-500 border-black/25 dark:border-white/25"}`}>
                            <span className={`w-2 h-2 rounded-full relative ${hasLiveSprint ? "bg-signal-500" : showStatusPanel ? "bg-status-amber" : "bg-slate-400"}`}>
                                {hasLiveSprint && <span className="absolute inset-0 rounded-full animate-ping bg-signal-400 opacity-60" />}
                            </span>
                            {hasLiveSprint ? `${visibleStats.running} Running` : showStatusPanel ? sprintStatusPresentation.statusLabel : hasSprintContext ? "Snapshot loaded" : !initialLoadComplete ? "Connecting" : "Waiting"}
                        </div>
                        {pausedIntervention && !hasLiveSprint && sprintStatusPresentation.showHumanInterventionBadge && (
                            <HumanInterventionBadge summary={pausedIntervention} label="Needs you" align="right" />
                        )}
                        {visibleStats.failed > 0 && (
                            <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] rounded-full bg-status-red/10 text-status-red border border-status-red/25 flex items-center gap-2.5 backdrop-blur-md">
                                <span className="w-2 h-2 rounded-full bg-status-red relative">
                                    <span className="absolute inset-0 rounded-full animate-ping bg-status-red opacity-50" />
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
            </div>

            {showStatusPanel && (
                <div className="relative overflow-hidden rounded-[1.75rem] border border-status-amber/18 bg-status-amber/8 p-6 shadow-[0_12px_30px_rgba(245,158,11,0.08)]">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0">
                            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-status-amber">
                                <AlertTriangle className="w-3.5 h-3.5" strokeWidth={2.2} />
                                {sprintStatusPresentation.title}
                            </div>
                            <h3 className="mt-2 text-2xl font-black tracking-tight text-slate-900 dark:text-white font-display">
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
