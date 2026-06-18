import type { FunctionComponent } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import gsap from "gsap";
import { useProjectData } from "../../context/project-data.js";
import { useStatsPageData } from "./use-stats-page-data.js";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { StatsPageHero } from "./components/StatsPageHero.js";
import { AnalysisStudioSection } from "./components/AnalysisStudioSection.js";
import { TopCardsModeRenderer } from "../../components/stats/TopCardsModeRenderer.js";
import { Button } from "../../components/ui/Button.js";
import { PageContainer } from "../../components/layout/PageContainer.js";
import { PANEL_CLASS } from "./components/stats-ui-primitives.js";
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
    <PageContainer containerRef={rootRef} padding="stats" className={`gap-8 xl:gap-12 ${styles.pageRoot}`} role="region" aria-label="Statistics">
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
        visualMode={visualMode}
        setVisualMode={setVisualMode}
      />

      {!selectedProject ? (
        <div className={`${PANEL_CLASS} flex flex-col items-center justify-center py-24 text-center`}>
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-[1.25rem] border border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" className="h-8 w-8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
          </div>
          <div className="text-lg font-black text-slate-900 dark:text-white">Select a project</div>
          <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">Choose a project to load telemetry and execution history.</div>
        </div>
      ) : loading && !stats ? (
        <div className={`${PANEL_CLASS} flex flex-col items-center justify-center py-24 text-center`}>
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-[1.25rem] border border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" className="h-8 w-8 animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
          </div>
          <div className="text-lg font-black text-slate-900 dark:text-white">Loading telemetry field</div>
          <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">Gathering statistics for {selectedProject.name}...</div>
        </div>
      ) : error && !stats ? (
        <div className={`${PANEL_CLASS} flex flex-col items-center justify-center py-24 text-center`}>
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-[1.25rem] border border-red-500/20 bg-red-500/10 text-red-600 dark:text-red-400">
             <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" className="h-8 w-8"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
          </div>
          <div className="text-lg font-black text-red-600 dark:text-red-400">{error}</div>
          <Button variant="danger" size="sm" onClick={() => refresh()} className="mt-4">
            Retry
          </Button>
        </div>
      ) : stats ? (
        <>
          <TopCardsModeRenderer
            mode={visualMode}
            stats={stats}
            providerSegments={providerSegments}
            tokenSegments={tokenSegments}
            sourceSegments={sourceSegments}
          />

            <AnalysisStudioSection
              stats={stats}
              loading={loading}
              error={error}
              refresh={refresh}
              projectId={selectedProject?.id || ""}
              planningUsage={planningUsage}
              providerSegments={providerSegments}
              tokenSegments={tokenSegments}
              sourceSegments={sourceSegments}
              visualMode={visualMode}
              setVisualMode={setVisualMode}
              chartState={chartState}
            />
          </>
      ) : null}
    </PageContainer>
  );
};
