import type { FunctionComponent, ComponentChildren, ComponentType } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import gsap from "gsap";
import { AlertTriangle, Folder, Loader2 } from "lucide-preact";
import { useProjectData } from "../../context/project-data.js";
import { useStatsPageData } from "./use-stats-page-data.js";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { StatsPageHero } from "./components/StatsPageHero.js";
import { AnalysisStudioSection } from "./components/AnalysisStudioSection.js";
import { TopCardsModeRenderer } from "../../components/stats/TopCardsModeRenderer.js";
import { Button } from "../../components/ui/Button.js";
import { PageContainer } from "../../components/layout/PageContainer.js";
import { PANEL_CLASS, CHIP_CLASS, SUBPANEL_CLASS } from "./components/stats-ui-primitives.js";
import { formatDateTime } from "./stats-utils.js";
import styles from "./StatsPage.module.css";

const MODE_LABELS = {
  trend: "Trend",
  composition: "Composition",
  models: "Models",
  reliability: "Providers",
  ledgers: "Ledgers",
  system: "System",
} as const;

function getWindowLabel(window: string): string {
  if (window === "all") {
    return "All time";
  }

  return window;
}

const ContextChip: FunctionComponent<{ children: ComponentChildren }> = ({ children }) => (
  <div className={`px-3 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-detail-color)] ${CHIP_CLASS}`}>
    {children}
  </div>
);

export const StatsPage: FunctionComponent = () => {
  const rootRef = useRef<HTMLElement>(null);
  const hasAnimated = useRef(false);
  const { selectedProject } = useProjectData();
  const reducedMotion = useReducedMotion();
  const {
    stats,
    loading,
    error,
    refresh,
    planningUsage,
    activeQuery,
    customFrom,
    setCustomFrom,
    customTo,
    setCustomTo,
    applyCustomWindow,
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
    if (!rootRef.current || reducedMotion || hasAnimated.current) {
      return;
    }

    hasAnimated.current = true;
    const animatedNodes = rootRef.current.querySelectorAll("[data-stats-shell-animate]");
    if (animatedNodes.length === 0) {
      return;
    }

    gsap.killTweensOf(animatedNodes);
    gsap.fromTo(
      animatedNodes,
      { opacity: 0, y: 12 },
      { opacity: 1, y: 0, duration: 0.45, stagger: 0.05, ease: "power2.out", clearProps: "opacity,transform" },
    );
  }, [reducedMotion]);

  const windowLabel = activeQuery.window === "custom"
    ? `${customFrom || "Start"} → ${customTo || "End"}`
    : getWindowLabel(activeQuery.window);

  const generatedLabel = stats?.generatedAt ? formatDateTime(stats.generatedAt) : loading ? "Loading snapshot" : "No snapshot";

  const renderContextRail = () => (
    <div className={styles.stateMetaGrid}>
      <ContextChip>
        Project · {selectedProject?.name || "No project selected"}
      </ContextChip>
      <ContextChip>
        Window · {windowLabel}
      </ContextChip>
      <ContextChip>
        Generated · {generatedLabel}
      </ContextChip>
      <ContextChip>
        Mode · {MODE_LABELS[visualMode]}
      </ContextChip>
    </div>
  );

  const renderStatePanel = (options: {
    icon: ComponentType<any>;
    title: string;
    description: string;
    primaryAction?: ComponentChildren;
    role: "status" | "alert";
    iconClassName?: string;
    badge: string;
  }) => (
    <section
      className={`${PANEL_CLASS} ${styles.statePanel} !p-5 md:!p-6`}
      data-stats-shell-animate
      role={options.role}
      aria-live={options.role === "status" ? "polite" : undefined}
    >
      <div className={styles.statePanelInner}>
        {renderContextRail()}
        <div className={`${SUBPANEL_CLASS} ${styles.stateMessage}`}>
          <div className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-warning-text)] ${CHIP_CLASS}`}>
            {options.badge}
          </div>
          <div className={styles.stateMessageContent}>
            <div className={styles.stateMessageIcon} aria-hidden="true">
              <options.icon className={`h-8 w-8 text-[color:var(--stats-warning-text)] ${options.iconClassName || ""}`} />
            </div>
            <h3 className={styles.stateMessageTitle}>{options.title}</h3>
            <p className={styles.stateMessageDescription}>{options.description}</p>
            {options.primaryAction ? (
              <div className={styles.stateMessageAction}>
                {options.primaryAction}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );

  const statePanel = !selectedProject
    ? renderStatePanel({
        icon: Folder,
        title: "No project selected",
        description: "Select a project to open the stats command panel, telemetry summary, and analysis modes.",
        role: "status",
        badge: "Stats panel idle",
      })
    : loading && !stats
      ? renderStatePanel({
          icon: Loader2,
          title: "Loading telemetry field",
          description: `Gathering ${selectedProject.name} telemetry for the ${getWindowLabel(activeQuery.window)} window.`,
          role: "status",
          iconClassName: "animate-spin motion-reduce:animate-none",
          badge: "Stats panel refreshing",
        })
      : error && !stats
        ? renderStatePanel({
            icon: AlertTriangle,
            title: error,
            description: `${selectedProject.name} remains selected for the ${getWindowLabel(activeQuery.window)} window.`,
            role: "alert",
            iconClassName: "text-[color:var(--stats-negative-text)]",
            badge: "Stats panel unavailable",
            primaryAction: (
              <Button variant="danger" size="sm" onClick={() => refresh()}>
                Retry
              </Button>
            ),
          })
        : null;

  return (
    <PageContainer
      containerRef={rootRef}
      padding="stats"
      className={`gap-6 xl:gap-8 ${styles.pageRoot}`}
      role="region"
      aria-label="Statistics"
      aria-busy={loading && !stats ? "true" : undefined}
    >
      <section className={styles.heroSection} data-stats-shell-animate aria-label="Stats command controls">
        <StatsPageHero
          selectedProject={selectedProject}
          stats={stats}
          activeQuery={activeQuery}
          customFrom={customFrom}
          customTo={customTo}
          applyPresetWindow={applyPresetWindow}
          setCustomFrom={setCustomFrom}
          setCustomTo={setCustomTo}
          applyCustomWindow={applyCustomWindow}
          applyCustomRange={applyCustomRange}
          visualMode={visualMode}
          setVisualMode={setVisualMode}
          completionConfidence={completionConfidence}
        />
      </section>

      {statePanel}

      {stats ? (
        <>
          <section
            data-stats-shell-animate
            className={styles.metricDeckSection}
            aria-label={`${MODE_LABELS[visualMode]} metrics`}
          >
            <TopCardsModeRenderer
              mode={visualMode}
              stats={stats}
              providerSegments={providerSegments}
              tokenSegments={tokenSegments}
              sourceSegments={sourceSegments}
            />
          </section>

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
