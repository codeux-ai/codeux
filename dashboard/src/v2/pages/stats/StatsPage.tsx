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
import { StatsPageHero } from "./components/StatsPageHero.js";
import { AnalysisStudioSection } from "./components/AnalysisStudioSection.js";
import { SignalMetricCard } from "./components/StatsShared.js";
import styles from "./StatsPage.module.css";

export const StatsPage: FunctionComponent = () => {
  const rootRef = useRef<HTMLDivElement>(null);
  const { selectedProject } = useProjectData();
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

  useLayoutEffect(() => {
    if (!rootRef.current) {
      return;
    }
    gsap.fromTo(
      rootRef.current.children,
      { opacity: 0, y: 28 },
      { opacity: 1, y: 0, duration: 0.8, stagger: 0.08, ease: "power4.out" },
    );
  }, []);

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
          <section className="grid grid-cols-1 gap-5 lg:grid-cols-2 2xl:grid-cols-5">
            <SignalMetricCard
              label="Total Tokens"
              value={formatTokens(usage.totalTokens)}
              detail={`${usage.reportedInvocationCount} reported · ${usage.estimatedInvocationCount} estimated provider calls`}
              accentHex="#00E0A0"
              hoverTint="group-hover:bg-signal-500/[0.025]"
              sparkline={tokenSeries}
              signalLabel="Throughput"
            />
            <SignalMetricCard
              label="Active AI Time"
              value={formatDuration(usage.activeTimeMs)}
              detail={`${usage.invocationCount} tracked CLI invocations across the selected window`}
              accentHex="#FFB800"
              hoverTint="group-hover:bg-amber-500/[0.03]"
              sparkline={activeTimeSeries}
              signalLabel="Latency"
            />
            <SignalMetricCard
              label="Wall Runtime"
              value={formatDuration(usage.wallTimeMs)}
              detail="Task-run wall time in the same window, including completed sprint work."
              accentHex="#0EA5E9"
              hoverTint="group-hover:bg-cyan-500/[0.03]"
              sparkline={wallTimeSeries}
              signalLabel="Task Scope"
            />
            <SignalMetricCard
              label="Telemetry Confidence"
              value={completionConfidence}
              detail={`${usage.unavailableInvocationCount + usage.unsupportedInvocationCount} invocations could not expose authoritative counts`}
              accentHex="#10B981"
              hoverTint="group-hover:bg-emerald-500/[0.03]"
              sparkline={createSeries(stats.buckets, (bucket) => bucket.usage.reportedInvocationCount)}
              signalLabel="Audit"
            />
          </section>

          <section className={styles.telemetryStack}>
            {visualMode === "trend" && stats.purposes.length > 0 ? (
              <section className={styles.purposeSection}>
                <div className={styles.purposeHeader}>
                  <h2 className={styles.purposeTitle}>Execution Purposes</h2>
                  <p className={styles.purposeDescription}>
                    Purpose-level telemetry is surfaced as standalone cards to keep execution intent visible alongside the usage graph and filters.
                  </p>
                </div>
                <div className={styles.purposeCards}>
                  {stats.purposes.slice(0, 4).map((purpose) => (
                    <SignalMetricCard
                      key={purpose.id}
                      label={purpose.label.replace(/_/g, " ")}
                      value={formatTokens(purpose.usage.totalTokens)}
                      detail={`${formatDuration(purpose.usage.activeTimeMs)} active time`}
                      accentHex="#10B981"
                      hoverTint="group-hover:bg-emerald-500/[0.03]"
                      sparkline={createSeries(stats.buckets, (bucket) => bucket.usage.totalTokens)}
                      signalLabel="Purpose"
                    />
                  ))}
                </div>
              </section>
            ) : null}

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
