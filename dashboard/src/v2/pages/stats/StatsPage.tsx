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
import { EmptyState } from "../../components/ui/EmptyState.js";
import { PANEL_CLASS, CHIP_CLASS, SUBPANEL_CLASS } from "./components/stats-ui-primitives.js";
import { formatDateTime } from "./stats-utils.js";
import styles from "./StatsPage.module.css";

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
  <div className={`px-4 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-300 ${CHIP_CLASS}`}>
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
    if (!rootRef.current || reducedMotion || !stats || hasAnimated.current) {
      return;
    }

    hasAnimated.current = true;
    const animatedNodes = rootRef.current.querySelectorAll("[data-stats-shell-animate]");
    gsap.killTweensOf(animatedNodes);
    gsap.fromTo(
      animatedNodes,
      { opacity: 0, y: 12 },
      { opacity: 1, y: 0, duration: 0.45, stagger: 0.05, ease: "power2.out" },
    );
  }, [stats, reducedMotion]);

  const renderContextRail = () => (
    <div className="flex flex-wrap gap-2">
      <ContextChip>
        Project · {selectedProject?.name || "No project selected"}
      </ContextChip>
      <ContextChip>
        Window · {activeQuery.window === "custom" ? `${customFrom || "Start"} → ${customTo || "End"}` : getWindowLabel(activeQuery.window)}
      </ContextChip>
      <ContextChip>
        Generated · {stats?.generatedAt ? formatDateTime(stats.generatedAt) : "pending"}
      </ContextChip>
      <ContextChip>
        Freshness · {stats?.generatedAt ? getRelativeTime(stats.generatedAt) || "unknown" : "awaiting snapshot"}
      </ContextChip>
      {stats?.range ? (
        <ContextChip>
          Resolution · {stats.range.resolutionLabel}
        </ContextChip>
      ) : null}
      {stats?.activeSprint ? (
        <ContextChip>
          Sprint · {stats.activeSprint.sprintNumber ?? "?"}
        </ContextChip>
      ) : (
        <ContextChip>Historical lens</ContextChip>
      )}
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
      <div className="flex flex-col gap-5">
        {renderContextRail()}
        <div className={`${SUBPANEL_CLASS} flex min-h-[12rem] flex-col items-center justify-center gap-4 !p-6 text-center`}>
          <div className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-amber-700 dark:text-amber-300 ${CHIP_CLASS}`}>
            {options.badge}
          </div>
          <EmptyState
            icon={<options.icon className={`h-8 w-8 text-amber-600 dark:text-amber-300 ${options.iconClassName || ""}`} />}
            title={options.title}
            description={options.description}
            primaryAction={options.primaryAction}
          />
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
          iconClassName: "animate-spin",
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
      <div data-stats-shell-animate>
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
      </div>

      {statePanel}

      {stats ? (
        <>
          <section data-stats-shell-animate className={styles.workspaceSection}>
            <TopCardsModeRenderer
              mode={visualMode}
              stats={stats}
              providerSegments={providerSegments}
              tokenSegments={tokenSegments}
              sourceSegments={sourceSegments}
            />
          </section>

          <section data-stats-shell-animate className={styles.workspaceSection}>
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
