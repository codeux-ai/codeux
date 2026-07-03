import type { FunctionComponent, ComponentType } from "preact";
import { useEffect, useState } from "preact/hooks";
import {
  Activity,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Cpu,
  Gauge,
  Layers3,
  RadioTower,
  ShieldCheck,
  Zap,
} from "lucide-preact";
import type {
  Source,
  ProjectExecutionStatsSnapshot,
  ProjectStatsQuery,
  ProjectStatsWindow,
} from "../../../types.js";
import { formatDateTime, formatStatsDuration, formatTokens, isValidCustomRange } from "../stats-utils.js";
import { PageHeader } from "../../../components/layout/PageHeader.js";
import {
  PANEL_CLASS,
  CHIP_CLASS,
  INPUT_CLASS,
  SUBPANEL_CLASS,
  ViewToggle,
  type StatsVisualMode,
} from "./StatsShared.js";
import styles from "../StatsPage.module.css";

export const WINDOW_PRESETS = ["1h", "24h", "7d", "30d", "all", "custom"] as const;

export const MODE_DESCRIPTIONS: Record<StatsVisualMode, string> = {
  trend: "Token, invocation, and runtime movement across the selected range.",
  composition: "Provider, token, purpose, and source mix for the current telemetry window.",
  models: "Model activity, latency, cache behavior, and reliability signals.",
  reliability: "Provider health, source confidence, failures, and integrity notes.",
  ledgers: "Dense task, sprint, and git telemetry rows for audit-style review.",
  system: "Invocation health, filters, transcript detail, and debugging context.",
};

const HERO_PANEL_CLASS = PANEL_CLASS.replace("overflow-hidden", "overflow-visible");

export const HeroKpi: FunctionComponent<{
  icon: ComponentType<any>;
  label: string;
  value: string;
  detail: string;
  valueClassName?: string;
}> = ({ icon: Icon, label, value, detail, valueClassName = "text-slate-900 dark:text-white" }) => (
  <article
    aria-label={`${label}: ${value}. ${detail}`}
    className={`${SUBPANEL_CLASS} ${styles.heroKpi}`}
  >
    <div className={styles.heroKpiHeader}>
      <div className={styles.heroKpiIcon}>
        <Icon className="h-4 w-4" strokeWidth={2.15} aria-hidden="true" />
      </div>
      <div className={styles.heroKpiLabel}>{label}</div>
    </div>
    <div>
      <div className={`${styles.heroKpiValue} ${valueClassName}`}>{value}</div>
      <div className={styles.heroKpiDetail}>{detail}</div>
    </div>
  </article>
);

const ContextBadge: FunctionComponent<{
  icon: ComponentType<any>;
  label: string;
  value: string;
}> = ({ icon: Icon, label, value }) => (
  <div className={`${CHIP_CLASS} ${styles.heroContextBadge}`}>
    <Icon className={styles.heroContextBadgeIcon} strokeWidth={2.2} aria-hidden="true" />
    <span className={styles.heroContextBadgeLabel}>{label}</span>
    <span aria-hidden="true" className={styles.heroContextBadgeDivider}>/</span>
    <span className={styles.heroContextBadgeValue}>{value}</span>
  </div>
);

export function getRelativeTime(isoString: string): string {
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

function formatWindowLabel(activeQuery: ProjectStatsQuery): string {
  if (activeQuery.window !== "custom") {
    return activeQuery.window === "all" ? "All time" : activeQuery.window;
  }

  const from = activeQuery.from || "Start";
  const to = activeQuery.to || "End";
  return `${from} → ${to}`;
}

function getCustomRangeMessage(from: string, to: string): string {
  if (!from || !to) {
    return "Choose both dates before applying a custom range.";
  }

  if (!isValidCustomRange(from, to)) {
    return "End date must be after start date.";
  }

  return "";
}

function getTelemetrySourceQuality(usage: NonNullable<ProjectExecutionStatsSnapshot["usage"]>): string {
  if (usage.reportedInvocationCount > 0 && usage.estimatedInvocationCount === 0) {
    return "Reported";
  }

  if (usage.reportedInvocationCount > 0 && usage.estimatedInvocationCount > 0) {
    return "Mixed";
  }

  if (usage.estimatedInvocationCount > 0) {
    return "Estimated";
  }

  return "Unavailable";
}

function getSuccessRate(stats: ProjectExecutionStatsSnapshot | null): { value: string; className: string } {
  const finishedCount = stats?.statusCounts
    ? stats.statusCounts.completed + stats.statusCounts.failed + stats.statusCounts.cancelled
    : 0;

  if (!stats?.statusCounts || finishedCount === 0) {
    return { value: "—", className: "text-slate-900 dark:text-white" };
  }

  const rate = Math.round((stats.statusCounts.completed / finishedCount) * 100);
  if (rate >= 95) {
    return { value: `${rate}%`, className: "text-emerald-600 dark:text-emerald-400" };
  }

  if (rate >= 80) {
    return { value: `${rate}%`, className: "text-amber-600 dark:text-amber-400" };
  }

  return { value: `${rate}%`, className: "text-red-500 dark:text-red-400" };
}

function getActiveModelSummary(stats: ProjectExecutionStatsSnapshot | null): {
  activeModelCount: number;
  activeProviderCount: number;
  topModelLabel: string;
} {
  if (!stats) {
    return {
      activeModelCount: 0,
      activeProviderCount: 0,
      topModelLabel: "No model telemetry",
    };
  }

  const activeModels = (stats.models || []).filter((model) => model.usage.totalTokens > 0);
  const activeProviders = (stats.providers || []).filter((provider) => provider.usage.totalTokens > 0);
  const topModel = activeModels.reduce<ProjectExecutionStatsSnapshot["models"][number] | null>((current, model) => {
    if (!current || model.usage.totalTokens > current.usage.totalTokens) {
      return model;
    }
    return current;
  }, null);

  return {
    activeModelCount: activeModels.length,
    activeProviderCount: activeProviders.length,
    topModelLabel: topModel?.label || "No model telemetry",
  };
}

function getFinishedTaskDetail(stats: ProjectExecutionStatsSnapshot | null): string {
  if (!stats?.statusCounts) {
    return "No task telemetry";
  }

  const finishedCount = stats.statusCounts.completed + stats.statusCounts.failed + stats.statusCounts.cancelled;
  if (finishedCount === 0) {
    return `${stats.statusCounts.running} running · none finished`;
  }

  return `${stats.statusCounts.completed} completed · ${stats.statusCounts.failed} failed · ${stats.statusCounts.cancelled} cancelled`;
}

export interface StatsPageHeroProps {
  selectedProject: Source | null;
  stats: ProjectExecutionStatsSnapshot | null;
  activeQuery: ProjectStatsQuery;
  customFrom: string;
  customTo: string;
  applyPresetWindow: (window: Exclude<ProjectStatsWindow, "custom">) => void;
  applyCustomWindow?: () => void;
  setCustomFrom: (value: string) => void;
  setCustomTo: (value: string) => void;
  applyCustomRange: () => void;
  visualMode: StatsVisualMode;
  setVisualMode: (mode: StatsVisualMode) => void;
  completionConfidence?: string;
}

export const StatsPageHero: FunctionComponent<StatsPageHeroProps> = ({
  selectedProject,
  stats,
  activeQuery,
  customFrom,
  customTo,
  applyPresetWindow,
  setCustomFrom,
  setCustomTo,
  applyCustomRange,
  visualMode,
  setVisualMode,
  completionConfidence = "No telemetry",
}) => {
  const [customRangeError, setCustomRangeError] = useState<string>("");
  const [customControlsOpen, setCustomControlsOpen] = useState(activeQuery.window === "custom");

  const usage = stats?.usage;
  const customRangeMessage = customControlsOpen ? getCustomRangeMessage(customFrom, customTo) : "";
  const rangeMessage = customRangeError || customRangeMessage;
  const rangeHasError = Boolean(rangeMessage);
  const canApplyCustomRange = isValidCustomRange(customFrom, customTo);
  const selectedProjectLabel = selectedProject?.name || "No project selected";
  const generatedAtLabel = stats?.generatedAt ? formatDateTime(stats.generatedAt) : "No snapshot yet";
  const freshnessLabel = stats?.generatedAt ? getRelativeTime(stats.generatedAt) || "unknown" : "Awaiting first snapshot";
  const successRate = getSuccessRate(stats);
  const modelSummary = getActiveModelSummary(stats);
  const invocationCount = usage?.invocationCount ?? 0;
  const telemetrySourceQuality = usage ? getTelemetrySourceQuality(usage) : "Unavailable";
  const rangeResolutionLabel = stats?.range
    ? `${stats.range.resolutionLabel} · ${stats.range.bucketCount} buckets`
    : "Resolution pending";
  const rangeScopeLabel = stats?.range?.label || formatWindowLabel(activeQuery);
  const sprintScopeLabel = stats?.activeSprint
    ? `Sprint ${stats.activeSprint.sprintNumber ?? "?"}`
    : "Historical window";
  const activeModeDescription = MODE_DESCRIPTIONS[visualMode];

  useEffect(() => {
    if (activeQuery.window === "custom") {
      setCustomControlsOpen(true);
    }
  }, [activeQuery.window]);

  const handleApplyCustom = () => {
    if (!canApplyCustomRange) {
      setCustomRangeError(rangeMessage);
      return;
    }

    setCustomRangeError("");
    applyCustomRange();
  };

  const handlePresetClick = (window: typeof WINDOW_PRESETS[number]) => {
    setCustomRangeError("");

    if (window === "custom") {
      setCustomControlsOpen(true);
      return;
    }

    setCustomControlsOpen(false);
    applyPresetWindow(window);
  };

  return (
    <section className={`${HERO_PANEL_CLASS} ${styles.heroPanel}`} aria-labelledby="stats-hero-title">
      <div className={styles.heroGrid}>
        <div className={styles.heroIntro}>
          <div className={styles.heroTitleBlock}>
            <PageHeader
              icon={BarChart3}
              eyebrow="Telemetry Command"
              title="Statistics."
              subtitle="A project-scoped analytics command header for telemetry range, freshness, sprint state, and visual mode."
            />
            <h2 id="stats-hero-title" className="sr-only">Stats command header</h2>

            <div className={styles.heroContextGrid} aria-label="Stats project context">
              <ContextBadge icon={Layers3} label="Project" value={selectedProjectLabel} />
              <ContextBadge
                icon={CalendarDays}
                label="Sprint"
                value={stats?.activeSprint ? `#${stats.activeSprint.sprintNumber ?? "?"}` : "Historical lens"}
              />
              <ContextBadge icon={Clock3} label="Generated" value={generatedAtLabel} />
              <ContextBadge icon={RadioTower} label="Freshness" value={freshnessLabel} />
              <ContextBadge icon={ShieldCheck} label="Source" value={telemetrySourceQuality} />
              <ContextBadge icon={Gauge} label="Resolution" value={rangeResolutionLabel} />
            </div>
          </div>
        </div>

        <div className={`${SUBPANEL_CLASS} ${styles.heroControls}`} aria-label="Stats command controls">
          <div className={styles.heroControlSection}>
            <div className={styles.heroControlHeader}>
              <div className={styles.heroControlHeaderText}>
                <div className={styles.heroControlEyebrow}>
                  Time window
                </div>
                <div className={styles.heroControlDescription}>
                  Current · {rangeScopeLabel}
                </div>
              </div>
              <CalendarDays className={styles.heroControlIcon} strokeWidth={2.2} aria-hidden="true" />
            </div>

            <div role="group" aria-label="Time window presets" className={`${CHIP_CLASS} flex-wrap ${styles.heroPresetGroup}`}>
              {WINDOW_PRESETS.map((window) => {
                const isActive = window === "custom" ? customControlsOpen : activeQuery.window === window;
                return (
                  <button
                    key={window}
                    type="button"
                    onClick={() => handlePresetClick(window)}
                    aria-pressed={isActive}
                    aria-expanded={window === "custom" ? customControlsOpen : undefined}
                    aria-controls={window === "custom" ? "stats-custom-range-controls" : undefined}
                    className={`${styles.heroPresetButton} ${isActive ? styles.heroPresetButtonActive : ""}`}
                  >
                    {window === "all" ? "All time" : window === "custom" ? "Custom" : window}
                  </button>
                );
              })}
            </div>

            {customControlsOpen ? (
              <div id="stats-custom-range-controls" className={styles.customRangeControls}>
                <label className={styles.customRangeField}>
                  <span className={styles.customRangeLabel}>Start</span>
                  <input
                    id="stats-custom-start"
                    type="date"
                    aria-label="Custom start date"
                    value={customFrom}
                    onInput={(event) => {
                      setCustomFrom((event.currentTarget as HTMLInputElement).value);
                      setCustomRangeError("");
                    }}
                    className={`${INPUT_CLASS} !h-10 w-full !px-3 !text-[12px]`}
                    aria-invalid={rangeHasError ? "true" : "false"}
                    aria-errormessage={rangeHasError ? "stats-custom-range-error" : undefined}
                    aria-describedby="stats-custom-range-help"
                  />
                </label>
                <label className={styles.customRangeField}>
                  <span className={styles.customRangeLabel}>End</span>
                  <input
                    id="stats-custom-end"
                    type="date"
                    aria-label="Custom end date"
                    value={customTo}
                    onInput={(event) => {
                      setCustomTo((event.currentTarget as HTMLInputElement).value);
                      setCustomRangeError("");
                    }}
                    className={`${INPUT_CLASS} !h-10 w-full !px-3 !text-[12px]`}
                    aria-invalid={rangeHasError ? "true" : "false"}
                    aria-errormessage={rangeHasError ? "stats-custom-range-error" : undefined}
                    aria-describedby="stats-custom-range-help"
                  />
                </label>
                <button
                  type="button"
                  onClick={handleApplyCustom}
                  disabled={!canApplyCustomRange}
                  aria-disabled={!canApplyCustomRange ? "true" : undefined}
                  className={styles.customRangeApply}
                >
                  Apply
                </button>
                <div id="stats-custom-range-help" className={styles.customRangeHelp}>
                  {rangeHasError ? (
                    <span id="stats-custom-range-error" role="alert" className={styles.customRangeError}>
                      {rangeMessage}
                    </span>
                  ) : (
                    <span>Custom ranges apply only when both dates are valid.</span>
                  )}
                </div>
              </div>
            ) : null}
          </div>

          <div className={`${styles.heroControlSection} ${styles.heroModeSection}`}>
            <div className={styles.heroControlHeader}>
              <div className={styles.heroControlHeaderText}>
                <div className={styles.heroControlEyebrow}>
                  Analysis mode
                </div>
                <div className={styles.heroControlDescription}>
                  {activeModeDescription}
                </div>
              </div>
              <CheckCircle2 className={styles.heroModeIcon} strokeWidth={2.2} aria-hidden="true" />
            </div>
            <ViewToggle
              value={visualMode}
              onChange={setVisualMode}
              ariaLabel="Analytics modes"
              className={styles.heroViewToggle}
            />
          </div>
        </div>

        <div aria-label="Executive summary" className={styles.heroKpiGrid}>
          <HeroKpi
            icon={Zap}
            label="Tokens"
            value={usage ? formatTokens(usage.totalTokens) : "—"}
            detail={usage ? `${telemetrySourceQuality} telemetry · selected window` : "No usage telemetry"}
          />
          <HeroKpi
            icon={Clock3}
            label="Active time"
            value={usage ? formatStatsDuration(usage.activeTimeMs) : "—"}
            detail={rangeResolutionLabel}
          />
          <HeroKpi
            icon={Activity}
            label="Invocations"
            value={usage ? invocationCount.toLocaleString() : "—"}
            detail={`${completionConfidence} · ${sprintScopeLabel}`}
          />
          <HeroKpi
            icon={ShieldCheck}
            label="Success rate"
            value={successRate.value}
            detail={getFinishedTaskDetail(stats)}
            valueClassName={successRate.className}
          />
          <HeroKpi
            icon={Cpu}
            label="Models"
            value={stats ? `${modelSummary.activeModelCount}` : "—"}
            detail={`${modelSummary.activeProviderCount} providers · ${modelSummary.topModelLabel}`}
          />
          <HeroKpi
            icon={CalendarDays}
            label="Range"
            value={rangeScopeLabel}
            detail={`${stats?.range?.isCustom ? "Custom" : "Preset"} · ${sprintScopeLabel}`}
          />
        </div>
      </div>
    </section>
  );
};
