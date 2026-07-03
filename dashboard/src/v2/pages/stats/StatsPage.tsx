import type { FunctionComponent, ComponentChildren, ComponentType } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import gsap from "gsap";
import { AlertTriangle, BarChart3, Clock3, Folder, Layers3, Loader2, RadioTower } from "lucide-preact";
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

const MODE_CONTEXT = {
  trend: "Throughput, runtime, and cost movement.",
  composition: "Provider, token, and purpose mix.",
  models: "Model performance and efficiency.",
  reliability: "Provider health and telemetry confidence.",
  ledgers: "Task, sprint, and git records.",
  system: "Invocation debugging and filters.",
} as const;

function getWindowLabel(window: string): string {
  if (window === "all") {
    return "All time";
  }

  return window;
}

function getRelativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  if (Number.isNaN(diff)) return "";
  const sec = Math.floor(Math.max(0, diff) / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.floor(hr / 24);
  return `${day} day${day > 1 ? "s" : ""} ago`;
}

const ContextChip: FunctionComponent<{ children: ComponentChildren }> = ({ children }) => (
  <div className={`px-3 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-300 ${CHIP_CLASS}`}>
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
  const freshnessLabel = stats?.generatedAt ? getRelativeTime(stats.generatedAt) || "unknown" : loading ? "Refreshing" : "Awaiting telemetry";
  const resolutionLabel = stats?.range?.resolutionLabel || (stats ? "Current range" : "Not available");
  const sprintLabel = stats?.activeSprint ? `Sprint #${stats.activeSprint.sprintNumber ?? "?"}` : "Historical lens";

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

  const renderContextStrip = () => (
    <section
      className={`${PANEL_CLASS} ${styles.contextStrip}`}
      aria-label="Stats workspace context"
      data-stats-shell-animate
    >
      <div className={styles.contextIntro}>
        <div className={styles.contextIcon} aria-hidden="true">
          <RadioTower className="h-4 w-4" strokeWidth={2.2} />
        </div>
        <div className="min-w-0">
          <div className={styles.contextEyebrow}>Active workspace</div>
          <h2 className={styles.contextTitle}>{MODE_LABELS[visualMode]} telemetry</h2>
          <p className={styles.contextDescription}>{MODE_CONTEXT[visualMode]}</p>
        </div>
      </div>

      <div className={styles.contextFacts} aria-label="Current telemetry window">
        <div className={styles.contextFact}>
          <Clock3 className="h-4 w-4" strokeWidth={2.2} aria-hidden="true" />
          <span>Window</span>
          <strong>{windowLabel}</strong>
        </div>
        <div className={styles.contextFact}>
          <RadioTower className="h-4 w-4" strokeWidth={2.2} aria-hidden="true" />
          <span>Freshness</span>
          <strong>{freshnessLabel}</strong>
        </div>
        <div className={styles.contextFact}>
          <Layers3 className="h-4 w-4" strokeWidth={2.2} aria-hidden="true" />
          <span>Resolution</span>
          <strong>{resolutionLabel}</strong>
        </div>
        <div className={styles.contextFact}>
          <BarChart3 className="h-4 w-4" strokeWidth={2.2} aria-hidden="true" />
          <span>Scope</span>
          <strong>{sprintLabel}</strong>
        </div>
      </div>
    </section>
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
          <div className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-amber-700 dark:text-amber-300 ${CHIP_CLASS}`}>
            {options.badge}
          </div>
          <div className={styles.stateMessageContent}>
            <div className={styles.stateMessageIcon} aria-hidden="true">
              <options.icon className={`h-8 w-8 text-amber-600 dark:text-amber-300 ${options.iconClassName || ""}`} />
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
            iconClassName: "text-rose-500 dark:text-rose-400",
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

      {renderContextStrip()}

      {statePanel}

      {stats ? (
        <>
          <section
            data-stats-shell-animate
            className={styles.metricDeckSection}
            aria-labelledby="stats-metric-deck-title"
          >
            <div className={styles.sectionHeading}>
              <div>
                <div className={styles.sectionEyebrow}>Metric deck</div>
                <h2 id="stats-metric-deck-title" className={styles.sectionTitle}>
                  {MODE_LABELS[visualMode]} summary cards
                </h2>
              </div>
              <div className={styles.sectionMeta}>{generatedLabel}</div>
            </div>
            <TopCardsModeRenderer
              mode={visualMode}
              stats={stats}
              providerSegments={providerSegments}
              tokenSegments={tokenSegments}
              sourceSegments={sourceSegments}
            />
          </section>

          <section
            data-stats-shell-animate
            className={styles.workspaceSection}
            aria-labelledby="stats-active-studio-title"
          >
            <div className={styles.sectionHeading}>
              <div>
                <div className={styles.sectionEyebrow}>Active studio</div>
                <h2 id="stats-active-studio-title" className={styles.sectionTitle}>
                  Analysis workspace
                </h2>
              </div>
              <div className={styles.sectionMeta}>{loading ? "Refreshing" : "Ready"}</div>
            </div>
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
          </section>
        </>
      ) : null}
    </PageContainer>
  );
};
