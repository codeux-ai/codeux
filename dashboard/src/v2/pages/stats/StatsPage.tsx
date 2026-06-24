import type { FunctionComponent } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import gsap from "gsap";
import { Folder, Loader2, AlertTriangle } from "lucide-preact";
import { useProjectData } from "../../context/project-data.js";
import { useStatsPageData } from "./use-stats-page-data.js";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { StatsPageHero } from "./components/StatsPageHero.js";
import { AnalysisStudioSection } from "./components/AnalysisStudioSection.js";
import { TopCardsModeRenderer } from "../../components/stats/TopCardsModeRenderer.js";
import { Button } from "../../components/ui/Button.js";
import { PageContainer } from "../../components/layout/PageContainer.js";
import { EmptyState } from "../../components/ui/EmptyState.js";
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
        <div className={PANEL_CLASS}>
          <EmptyState
            icon={<Folder className="h-8 w-8" />}
            title="Select a project"
            description="Choose a project to load telemetry and execution history."
          />
        </div>
      ) : loading && !stats ? (
        <div className={PANEL_CLASS}>
          <EmptyState
            icon={<Loader2 className="h-8 w-8 animate-spin" />}
            title="Loading telemetry field"
            description={`Gathering statistics for ${selectedProject.name}...`}
          />
        </div>
      ) : error && !stats ? (
        <div className={PANEL_CLASS}>
          <EmptyState
            icon={<AlertTriangle className="h-8 w-8 text-rose-500" />}
            title={error}
            primaryAction={
              <Button variant="danger" size="sm" onClick={() => refresh()}>
                Retry
              </Button>
            }
          />
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
