import type { FunctionComponent } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import gsap from "gsap";
import { useProjectData } from "../../context/project-data.js";
import {
  formatTokens,
  formatDuration,
  createSeries,
} from "./stats-utils.js";
import { useStatsPageData } from "./use-stats-page-data.js";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { StatsPageHero } from "./components/StatsPageHero.js";
import { AnalysisStudioSection } from "./components/AnalysisStudioSection.js";
import { StatsMetricCard } from "../../components/stats/StatsMetricCard.js";
import { STATS_COLORS } from "../../lib/stats/color-tokens.js";
import { buildMetricSeries } from "../../lib/stats/series-builders.js";
import styles from "./StatsPage.module.css";

export const StatsPage: FunctionComponent = () => {
  const rootRef = useRef<HTMLDivElement>(null);
  const hasAnimated = useRef(false);
  const { selectedProject } = useProjectData();
  const reducedMotion = useReducedMotion();
  const {
    stats,
    loading,
    error,
    usage,
    tokenSeries,
    activeTimeSeries,
    wallTimeSeries,
    planningUsage,
    activeQuery,
    customFrom,
    setCustomFrom,
    customTo,
    setCustomTo,
    visualMode,
    setVisualMode,
    chartState,
    providerSegments,
    sourceSegments,
    tokenSegments,
    applyPresetWindow,
    applyCustomRange,
    completionConfidence,
  } = useStatsPageData(selectedProject?.id || null);


  const taskCodingTokens = stats?.purposes.find((p) => p.id === "task_coding")?.usage.totalTokens || 0;
  const ciFixTokens = stats?.purposes.find((p) => p.id === "ci_fix")?.usage.totalTokens || 0;
  const qaReviewTokens = stats?.purposes.find((p) => p.id === "qa_review")?.usage.totalTokens || 0;
  const planningTokens = stats?.purposes.find((p) => p.id === "planning")?.usage.totalTokens || 0;
  const metricSeries = buildMetricSeries(stats);

  useLayoutEffect(() => {
    if (!rootRef.current || reducedMotion || !stats || hasAnimated.current) {
      return;
    }

    hasAnimated.current = true;
    gsap.killTweensOf(rootRef.current.children);
    gsap.fromTo(
      rootRef.current.children,
      { opacity: 0, y: 28 },
      { opacity: 1, y: 0, duration: 0.8, stagger: 0.08, ease: "power4.out" },
    );
  }, [stats, reducedMotion]);

  return (
    <div ref={rootRef} className={`mx-auto flex max-w-[2400px] flex-col gap-16 px-8 py-20 md:px-20 ${styles.pageRoot}`}>
      <StatsPageHero
        selectedProject={selectedProject}
        stats={stats}
        activeQuery={activeQuery}
        customFrom={customFrom}
        customTo={customTo}
        applyPresetWindow={applyPresetWindow}
        setCustomFrom={setCustomFrom}
        setCustomTo={setCustomTo}
        applyCustomRange={applyCustomRange}
      />

      {!selectedProject ? (
        <div className="rounded-[2rem] border border-dashed border-black/[0.08] bg-white/68 px-8 py-16 text-center text-base text-slate-400 shadow-[0_2px_20px_rgba(0,0,0,0.04)] backdrop-blur-2xl dark:border-white/[0.08] dark:bg-void-800/55 dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
          Select a project to load telemetry.
        </div>
      ) : loading && !stats ? (
        <div className="rounded-[2rem] border border-black/[0.05] bg-white/68 px-8 py-16 text-center text-base text-slate-500 shadow-[0_2px_20px_rgba(0,0,0,0.04)] backdrop-blur-2xl dark:border-white/[0.05] dark:bg-void-800/55 dark:text-slate-400 dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
          Loading the telemetry field for {selectedProject.name}.
        </div>
      ) : error ? (
        <div className="rounded-[2rem] border border-red-500/20 bg-red-500/10 px-8 py-12 text-base text-red-600 dark:text-red-300">
          {error}
        </div>
      ) : stats ? (
        <>

          <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-5 w-full">
            <StatsMetricCard
              label="Task Coding"
              value={formatTokens(taskCodingTokens)}
              detail="Total tokens utilized for core code generation tasks"
              accentHex={STATS_COLORS.taskCoding}
              sparkline={metricSeries.taskCodingTokens}
              signalLabel="Tokens"
            />
            <StatsMetricCard
              label="CI Fix"
              value={formatTokens(ciFixTokens)}
              detail="Total tokens consumed by CI/CD remediation workflows"
              accentHex={STATS_COLORS.ciFix}
              sparkline={metricSeries.ciFixTokens}
              signalLabel="Tokens"
            />
            <StatsMetricCard
              label="QA Review"
              value={formatTokens(qaReviewTokens)}
              detail="Total tokens used during code review and quality audits"
              accentHex={STATS_COLORS.qaReview}
              sparkline={metricSeries.qaReviewTokens}
              signalLabel="Tokens"
            />
            <StatsMetricCard
              label="Planning"
              value={formatTokens(planningTokens)}
              detail="Total tokens allocated to project and sprint planning"
              accentHex={STATS_COLORS.planning}
              sparkline={metricSeries.planningTokens}
              signalLabel="Tokens"
            />
            <StatsMetricCard
              label="Wall Runtime"
              value={formatDuration(usage.wallTimeMs)}
              detail="Task-run wall time in the same window, including completed sprint work."
              accentHex={STATS_COLORS.wallRuntime}
              sparkline={metricSeries.wallRuntime}
              signalLabel="Task Scope"
            />
          </section>

          <section className={styles.telemetryStack}>


            <AnalysisStudioSection
              stats={stats}
              planningUsage={planningUsage}
              providerSegments={providerSegments}
              tokenSegments={tokenSegments}
              sourceSegments={sourceSegments}
              visualMode={visualMode}
              setVisualMode={setVisualMode}
              chartState={chartState}
              activeWindow={activeQuery.window}
              customFrom={customFrom}
              customTo={customTo}
              applyPresetWindow={applyPresetWindow}
              setCustomFrom={setCustomFrom}
              setCustomTo={setCustomTo}
              applyCustomRange={applyCustomRange}
            />
          </section>

                  </>
      ) : null}
    </div>
  );
};
