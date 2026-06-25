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
import { ActionFeedbackRegion } from "../../components/ui/ActionFeedbackRegion.js";
import { PANEL_CLASS } from "./components/stats-ui-primitives.js";
import styles from "./StatsPage.module.css";

export const StatsPage: FunctionComponent = () => {
  const rootRef = useRef<HTMLElement>(null);
  const hasAnimated = useRef(false);
  const { selectedProject } = useProjectData();
  console.log("DEBUG: selectedProject is:", selectedProject);
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
        <div className={`${PANEL_CLASS} py-12 px-6 flex justify-center`}>
          <div className="w-full max-w-2xl">
            <ActionFeedbackRegion
              status="warning"
              message="Select a project. Choose a project to load telemetry and execution history."
              autoDismiss={false}
            />
          </div>
        </div>
      ) : loading && !stats ? (
        <div className={`${PANEL_CLASS} py-12 px-6 flex justify-center`}>
          <div className="w-full max-w-2xl">
            <ActionFeedbackRegion
              status="pending"
              message={`Loading telemetry field. Gathering statistics for ${selectedProject.name}...`}
              autoDismiss={false}
            />
          </div>
        </div>
      ) : error && !stats ? (
        <div className={`${PANEL_CLASS} py-12 px-6 flex justify-center`}>
          <div className="w-full max-w-2xl">
            <ActionFeedbackRegion
              status="error"
              message={error}
              retryAction={() => refresh()}
              retryLabel="Retry"
              autoDismiss={false}
            />
          </div>
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
