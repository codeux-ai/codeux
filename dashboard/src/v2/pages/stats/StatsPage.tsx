import type { FunctionComponent } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import gsap from "gsap";
import { useProjectData } from "../../context/project-data.js";
import {
  formatTokens,
} from "./stats-utils.js";
import { useStatsPageData } from "./use-stats-page-data.js";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { StatsPageHero } from "./components/StatsPageHero.js";
import { AnalysisStudioSection } from "./components/AnalysisStudioSection.js";
import { StatsMetricCard } from "../../components/stats/StatsMetricCard.js";
import { buildMetricSeries } from "../../lib/stats/series-builders.js";
import { Button } from "../../components/ui/Button.js";
import { PageContainer } from "../../components/layout/PageContainer.js";
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
    refresh,
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
    <PageContainer containerRef={rootRef} padding="stats" className={`gap-16 ${styles.pageRoot}`}>
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
      ) : error && !stats ? (
        <div className="flex flex-col items-center gap-4 rounded-[2rem] border border-red-500/20 bg-red-500/10 px-8 py-12 text-base text-red-600 dark:text-red-300">
          <div>{error}</div>
          <Button variant="danger" size="sm" onClick={() => refresh()}>
            Retry
          </Button>
        </div>
      ) : stats ? (
        <>
          <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 w-full">
            <StatsMetricCard
              label="Active Providers"
              value={String(providerSegments.length)}
              detail="Total number of unique model providers utilized in this window"
              accentHex="#10B981"
              sparkline={[]}
              signalLabel="Composition"
            />
            <StatsMetricCard
              label="Top Provider"
              value={providerSegments.length > 0 ? providerSegments[0]!.label : "None"}
              detail={providerSegments.length > 0 ? `Leading provider by token volume: ${formatTokens(providerSegments[0]!.value)}` : "No provider data"}
              accentHex="#0EA5E9"
              sparkline={[]}
              signalLabel="Composition"
            />
            <StatsMetricCard
              label="Input Tokens"
              value={formatTokens(stats.usage.inputTokens || 0)}
              detail="Total number of input tokens processed"
              accentHex="#00E0A0"
              sparkline={buildMetricSeries(stats).coreInputTokens}
              signalLabel="Composition"
            />
            <StatsMetricCard
              label="Output Tokens"
              value={formatTokens(stats.usage.outputTokens || 0)}
              detail="Total number of output tokens generated"
              accentHex="#FFB800"
              sparkline={buildMetricSeries(stats).coreOutputTokens}
              signalLabel="Composition"
            />
          </section>

          <section className={styles.telemetryStack}>


            <AnalysisStudioSection
              stats={stats}
              loading={loading}
              error={error}
              refresh={refresh}
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
    </PageContainer>
  );
};
