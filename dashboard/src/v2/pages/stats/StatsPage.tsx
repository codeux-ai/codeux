import type { FunctionComponent, ComponentChildren } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import gsap from "gsap";
import { AlertTriangle, Folder, Loader2, type LucideIcon } from "lucide-preact";
import { useProjectData } from "../../context/project-data.js";
import { useStatsPageData } from "./use-stats-page-data.js";
import { useGsapInteractionTokens } from "../../lib/motion/constants.js";
import { StatsPageHero } from "./components/StatsPageHero.js";
import { AnalysisStudioSection } from "./components/AnalysisStudioSection.js";
import { TopCardsModeRenderer } from "../../components/stats/TopCardsModeRenderer.js";
import { Button } from "../../components/ui/Button.js";
import { PageContainer } from "../../components/layout/PageContainer.js";
import { PANEL_CLASS } from "./components/stats-ui-primitives.js";
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

export const StatsPage: FunctionComponent = () => {
  const rootRef = useRef<HTMLElement>(null);
  const hasAnimated = useRef(false);
  const { selectedProject } = useProjectData();
  const motionTokens = useGsapInteractionTokens();
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
  } = useStatsPageData(selectedProject?.id || null);

  useLayoutEffect(() => {
    if (!rootRef.current || motionTokens.enterExit.duration === 0 || hasAnimated.current) {
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
      { opacity: 0, y: 8 },
      {
        opacity: 1,
        y: 0,
        duration: motionTokens.enterExit.duration,
        stagger: motionTokens.controlFeedback.duration / 3,
        ease: motionTokens.enterExit.ease,
        clearProps: "opacity,transform",
      },
    );
  }, [motionTokens.controlFeedback.duration, motionTokens.enterExit.duration, motionTokens.enterExit.ease]);

  const renderStatePanel = (options: {
    icon: LucideIcon;
    title: string;
    description: string;
    primaryAction?: ComponentChildren;
    role: "status" | "alert";
    iconClassName?: string;
    badge: string;
  }) => (
    <section
      className={`${PANEL_CLASS} ${styles.statePanel}`}
      data-stats-shell-animate
      role={options.role}
      aria-label={options.title}
      aria-live={options.role === "status" ? "polite" : undefined}
    >
      <div className={styles.statePanelInner}>
        <div className={styles.stateMessageIcon} aria-hidden="true">
          <options.icon className={`h-5 w-5 text-[color:var(--stats-detail-color)] ${options.iconClassName || ""}`} />
        </div>
        <div className={styles.stateMessageContent}>
          <div className={styles.stateEyebrow}>{options.badge}</div>
          <div className={styles.stateMessageBody}>
            <h3 className={styles.stateMessageTitle}>{options.title}</h3>
            <p className={styles.stateMessageDescription}>{options.description}</p>
          </div>
          {options.primaryAction ? <div className={styles.stateMessageAction}>{options.primaryAction}</div> : null}
        </div>
      </div>
    </section>
  );

  const statePanel = !selectedProject
    ? renderStatePanel({
        icon: Folder,
        title: "No project selected",
        description: "Select a project to load telemetry, metrics, and analysis workspaces.",
        role: "status",
        badge: "Stats panel idle",
      })
    : loading && !stats
      ? renderStatePanel({
          icon: Loader2,
        title: "Loading project telemetry",
          description: `Gathering ${selectedProject.name} telemetry for the ${getWindowLabel(activeQuery.window)} window.`,
          role: "status",
          iconClassName: "animate-spin motion-reduce:animate-none",
          badge: "Stats panel refreshing",
        })
      : error && !stats
        ? renderStatePanel({
            icon: AlertTriangle,
        title: "Stats unavailable",
        description: `${error} ${selectedProject.name} remains selected for the ${getWindowLabel(activeQuery.window)} window.`,
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
      className={styles.pageRoot}
      role="region"
      aria-label="Statistics"
      aria-busy={loading && !stats ? "true" : undefined}
    >
      <section className={styles.heroSection} data-stats-shell-animate aria-label="Stats command controls">
        <StatsPageHero
          selectedProject={selectedProject}
          stats={stats}
          loading={loading}
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
