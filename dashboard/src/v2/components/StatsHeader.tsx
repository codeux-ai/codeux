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

import { LivePreviewLink } from "./ui/LivePreviewLink.js";
import { HumanInterventionBadge } from "./ui/HumanInterventionBadge.js";
import { getSprintStatusPresentation } from "../lib/sprint-status-presentation.js";
import { PageHeader } from "./layout/PageHeader.js";
import { useLiveI18n } from "../i18n/messages/live.js";

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
    const { t, formatNumber, formatTime } = useLiveI18n();
    const headerRef = useRef<HTMLDivElement>(null);
    const prefersReducedMotion = useReducedMotion();
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
    const localizedStatus = {
      statusLabel: t(sprintStatusPresentation.isManualPause ? "paused" : "stopped"),
      title: sprintStatusPresentation.isManualPause
        ? pausedIntervention?.title || t("manualPauseTitle")
        : pausedIntervention?.title || t("systemStoppedTitle"),
      reason: sprintStatusPresentation.isManualPause
        ? pausedIntervention?.reason || t("manualPauseReason")
        : pausedIntervention?.reason || t("systemStoppedReason"),
      detail: sprintStatusPresentation.isManualPause
        ? pausedIntervention?.instructions || t("manualPauseDetail")
        : pausedIntervention?.instructions || t("systemStoppedDetail"),
    };

    useLayoutEffect(() => {
        if (headerRef.current) {
            const children = Array.from(headerRef.current.children);
            if (prefersReducedMotion) {
                gsap.set(children, { opacity: 1, y: 0 });
            } else {
                gsap.fromTo(
                    children,
                    { opacity: 0, y: 40 },
                    { opacity: 1, y: 0, stagger: 0.1, duration: 0.9, ease: "power4.out", delay: 0.05 },
                );
            }
        }
    }, [prefersReducedMotion]);

    const btnStatsRef = useRef<HTMLButtonElement>(null);
    const btnRaceRef = useRef<HTMLButtonElement>(null);
    const btnDagRef = useRef<HTMLButtonElement>(null);

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
                        <span className="text-status-red">{t("liveSession")}</span>
                        {(liveSprintRun?.sprintNumber ?? pausedInterventionRun?.sprintNumber) != null && (
                            <span className="text-slate-400 ml-1">· {t("sprintNumber", { number: formatNumber(liveSprintRun?.sprintNumber ?? pausedInterventionRun?.sprintNumber ?? 0) })}</span>
                        )}
                    </>
                }
                title={t("sprintPipeline")}
                subtitle={
                    hasLiveSprint
                        ? scopedFeatureBranch
                            ? t("monitoringBranch", { branch: scopedFeatureBranch })
                            : t("monitoringSprint", { sprint: liveSprintRun?.sprintName || t("activeSprint") })
                        : showStatusPanel
                            ? localizedStatus.detail
                            : hasSprintContext
                                ? t("latestSnapshot")
                                : !initialLoadComplete
                                    ? t("connectingOrchestrator")
                                    : t("waitingSprint")
                }
                actions={
                /* Right: pills + view toggle + timestamp */
                <div className="flex flex-col items-start lg:items-end gap-4 shrink-0">
                    <div className="flex items-center gap-2.5 flex-wrap">
                        <LivePreviewLink session={selectedSession} />
                        {/* ── View Toggle ─────────────────────────────── */}
                        <div className="flex gap-0.5 p-0.5 bg-black/[0.04] dark:bg-white/[0.04] rounded-xl backdrop-blur-md" role="tablist" aria-label={t("viewToggle")}>
                            <button
                                type="button"
                                ref={btnStatsRef}
                                onClick={() => setHeaderView("stats")}
                                role="tab"
                                aria-selected={headerView === "stats"}
                                tabIndex={headerView === "stats" ? 0 : -1}
                                onKeyDown={(e) => {
                                    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); setHeaderView("race"); btnRaceRef.current?.focus(); }
                                    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); setHeaderView("dag"); btnDagRef.current?.focus(); }
                                }}
                                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-[10px] text-[10px] font-bold uppercase tracking-[0.14em] transition-all duration-300 ${headerView === "stats" ? "bg-white dark:bg-void-700 text-slate-900 dark:text-white shadow-[0_2px_10px_rgba(0,0,0,0.08)] dark:shadow-[0_2px_10px_rgba(0,0,0,0.3)]" : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"}`}
                            >
                                <BarChart3 className="w-3 h-3" strokeWidth={2} />
                                {t("stats")}
                            </button>
                            <button
                                type="button"
                                ref={btnRaceRef}
                                onClick={() => setHeaderView("race")}
                                role="tab"
                                aria-selected={headerView === "race"}
                                tabIndex={headerView === "race" ? 0 : -1}
                                onKeyDown={(e) => {
                                    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); setHeaderView("dag"); btnDagRef.current?.focus(); }
                                    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); setHeaderView("stats"); btnStatsRef.current?.focus(); }
                                }}
                                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-[10px] text-[10px] font-bold uppercase tracking-[0.14em] transition-all duration-300 ${headerView === "race" ? "bg-white dark:bg-void-700 text-slate-900 dark:text-white shadow-[0_2px_10px_rgba(0,0,0,0.08)] dark:shadow-[0_2px_10px_rgba(0,0,0,0.3)]" : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"}`}
                            >
                                <Ship className="w-3 h-3" strokeWidth={2} />
                                {t("race")}
                            </button>
                            <button
                                type="button"
                                ref={btnDagRef}
                                onClick={() => setHeaderView("dag")}
                                role="tab"
                                aria-selected={headerView === "dag"}
                                tabIndex={headerView === "dag" ? 0 : -1}
                                onKeyDown={(e) => {
                                    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); setHeaderView("stats"); btnStatsRef.current?.focus(); }
                                    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); setHeaderView("race"); btnRaceRef.current?.focus(); }
                                }}
                                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-[10px] text-[10px] font-bold uppercase tracking-[0.14em] transition-all duration-300 ${headerView === "dag" ? "bg-white dark:bg-void-700 text-slate-900 dark:text-white shadow-[0_2px_10px_rgba(0,0,0,0.08)] dark:shadow-[0_2px_10px_rgba(0,0,0,0.3)]" : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"}`}
                            >
                                <Workflow className="w-3 h-3" strokeWidth={2} />
                                {t("dag")}
                            </button>
                        </div>

                        <div className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] rounded-full border flex items-center gap-2.5 backdrop-blur-md ${hasLiveSprint ? "bg-signal-500/10 dark:bg-signal-500/10 text-signal-600 dark:text-signal-400 border-signal-500/25 dark:border-signal-500/25 shadow-[0_0_20px_rgba(0,224,160,0.08)]" : showStatusPanel ? "bg-status-amber/10 text-status-amber border-status-amber/25" : "bg-black/10 dark:bg-white/10 text-slate-500 border-black/25 dark:border-white/25"}`}>
                            <span className={`w-2 h-2 rounded-full relative ${hasLiveSprint ? "bg-signal-500" : showStatusPanel ? "bg-status-amber" : "bg-slate-400"}`}>
                                {hasLiveSprint && <span className="absolute inset-0 rounded-full motion-safe:animate-ping bg-signal-400 opacity-60" />}
                            </span>
                            {hasLiveSprint ? `${formatNumber(visibleStats.running)} ${t("running")}` : showStatusPanel ? localizedStatus.statusLabel : hasSprintContext ? t("snapshotLoaded") : !initialLoadComplete ? t("connecting") : t("waiting")}
                        </div>
                        {pausedIntervention && !hasLiveSprint && sprintStatusPresentation.showHumanInterventionBadge && (
                            <HumanInterventionBadge summary={pausedIntervention} label={t("needsYou")} align="right" />
                        )}
                        {visibleStats.failed > 0 && (
                            <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] rounded-full bg-status-red/10 text-status-red border border-status-red/25 flex items-center gap-2.5 backdrop-blur-md">
                                <span className="w-2 h-2 rounded-full bg-status-red relative">
                                    <span className="absolute inset-0 rounded-full motion-safe:animate-ping bg-status-red opacity-50" />
                                </span>
                                {formatNumber(visibleStats.failed)} {t("failed")}
                            </div>
                        )}
                    </div>
                    {statusTimestamp && hasSprintContext && (
                        <span className="text-[10px] font-mono text-slate-400">
                            {t("updatedAt", { time: formatTime(new Date(statusTimestamp)) })}
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
                                {localizedStatus.title}
                            </div>
                            <h3 className="mt-2 text-xl font-semibold tracking-tight text-slate-900 dark:text-white font-display">
                                {localizedStatus.reason}
                            </h3>
                            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                                {localizedStatus.detail}
                            </p>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
});
