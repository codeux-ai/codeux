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
import { useOptionalDashboardI18n } from "../../i18n/index.js";
import { StatsI18nProvider, useStatsI18n } from "./stats-i18n.js";
import styles from "./StatsPage.module.css";

function getWindowLabel(window: string, allTimeLabel: string): string {
  if (window === "all") {
    return allTimeLabel;
  }

  return window;
}

const ContextChip: FunctionComponent<{ children: ComponentChildren }> = ({ children }) => (
  <div className={`px-3 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-detail-color)] ${CHIP_CLASS}`}>
    {children}
  </div>
);

const StatsPageContent: FunctionComponent = () => {
  const rootRef = useRef<HTMLElement>(null);
  const hasAnimated = useRef(false);
  const { selectedProject } = useProjectData();
  const reducedMotion = useReducedMotion();
  const { locale, text, formatDate } = useStatsI18n();
  const modeLabels = {
    trend: text("trend"),
    composition: text("composition"),
    models: text("models"),
    reliability: text("providers"),
    ledgers: text("ledgers"),
    system: text("system"),
  } as const;
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

  const formatRangeBoundary = (value: string, fallback: string): string => {
    if (!value) return fallback;
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isNaN(date.getTime()) ? value : formatDate(date, { dateStyle: "medium", timeZone: "UTC" });
  };
  const windowLabel = activeQuery.window === "custom"
    ? `${formatRangeBoundary(customFrom, text("start"))} → ${formatRangeBoundary(customTo, text("end"))}`
    : getWindowLabel(activeQuery.window, text("allTime"));

  const generatedLabel = stats?.generatedAt ? formatDateTime(stats.generatedAt, locale) : loading ? text("loadingSnapshot") : text("noSnapshot");

  const renderContextRail = () => (
    <div className={styles.stateMetaGrid}>
      <ContextChip>
        {text("project")} · {selectedProject?.name || text("noProjectSelected")}
      </ContextChip>
      <ContextChip>
        {text("window")} · {windowLabel}
      </ContextChip>
      <ContextChip>
        {text("generated")} · {generatedLabel}
      </ContextChip>
      <ContextChip>
        {text("mode")} · {modeLabels[visualMode]}
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
      aria-label={options.title}
      aria-live={options.role === "status" ? "polite" : undefined}
    >
      <div className={styles.statePanelInner}>
        {renderContextRail()}
        <div className={`${SUBPANEL_CLASS} ${styles.stateMessage}`}>
          <div className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-detail-color)] ${CHIP_CLASS}`}>
            {options.badge}
          </div>
          <div className={styles.stateMessageContent}>
            <div className={styles.stateMessageIcon} aria-hidden="true">
              <options.icon className={`h-8 w-8 text-[color:var(--stats-detail-color)] ${options.iconClassName || ""}`} />
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
        title: text("noProjectTitle"),
        description: text("noProjectDescription"),
        role: "status",
        badge: text("statsPanelIdle"),
      })
    : loading && !stats
      ? renderStatePanel({
          icon: Loader2,
          title: text("loadingTelemetry"),
          description: text("gatheringTelemetry", { project: selectedProject.name, window: windowLabel }),
          role: "status",
          iconClassName: "animate-spin motion-reduce:animate-none",
          badge: text("statsPanelRefreshing"),
        })
      : error && !stats
        ? renderStatePanel({
            icon: AlertTriangle,
            title: error,
            description: text("selectedWindowRetained", { project: selectedProject.name, window: windowLabel }),
            role: "alert",
            iconClassName: "text-[color:var(--stats-negative-text)]",
            badge: text("statsPanelUnavailable"),
            primaryAction: (
              <Button variant="danger" size="sm" onClick={() => refresh()}>
                {text("retry")}
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
      aria-label={text("statistics")}
      aria-busy={loading && !stats ? "true" : undefined}
    >
      <section className={styles.heroSection} data-stats-shell-animate aria-label={text("statsCommandControls")}>
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
        />
      </section>

      {statePanel}

      {stats ? (
        <>
          <section
            data-stats-shell-animate
            className={styles.metricDeckSection}
            aria-label={text("modeMetrics", { mode: modeLabels[visualMode] })}
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

export const StatsPage: FunctionComponent = () => {
  const dashboardI18n = useOptionalDashboardI18n();
  return (
    <StatsI18nProvider locale={dashboardI18n?.locale ?? "en"}>
      <StatsPageContent />
    </StatsI18nProvider>
  );
};
