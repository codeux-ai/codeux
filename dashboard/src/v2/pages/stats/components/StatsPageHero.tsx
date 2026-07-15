import type { FunctionComponent } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import {
  CalendarDays,
  CheckCircle2,
  Clock3,
  Layers3,
  type LucideIcon,
} from "lucide-preact";
import type {
  Source,
  ProjectExecutionStatsSnapshot,
  ProjectStatsQuery,
  ProjectStatsWindow,
} from "../../../types.js";
import { formatDateTime, isValidCustomRange } from "../stats-utils.js";
import {
  CHIP_CLASS,
  INPUT_CLASS,
  SUBPANEL_CLASS,
  ViewToggle,
  type StatsVisualMode,
} from "./StatsShared.js";
import styles from "../StatsPage.module.css";
import type { DashboardLocale } from "../../../i18n/index.js";
import { useStatsI18n } from "../stats-i18n.js";

export const WINDOW_PRESETS = ["1h", "24h", "7d", "30d", "all", "custom"] as const;

export const MODE_DESCRIPTIONS: Record<StatsVisualMode, string> = {
  trend: "Token, invocation, and runtime movement across the selected range.",
  composition: "Provider, token, purpose, and source mix for the current telemetry window.",
  cost: "Spend, pricing coverage, allocation, and entity-level cost detail for the selected range.",
  models: "Model activity, latency, cache behavior, and reliability signals.",
  reliability: "Provider health, source confidence, failures, and integrity notes.",
  ledgers: "Dense task, sprint, and git telemetry rows for audit-style review.",
  system: "Invocation health, filters, transcript detail, and debugging context.",
};

const MODE_LABELS: Record<StatsVisualMode, string> = {
  trend: "Trend",
  composition: "Composition",
  cost: "Cost",
  models: "Models",
  reliability: "Providers",
  ledgers: "Ledgers",
  system: "System",
};

const HERO_PANEL_CLASS = "relative overflow-visible";

const ContextBadge: FunctionComponent<{
  icon: LucideIcon;
  label: string;
  value: string;
}> = ({ icon: Icon, label, value }) => (
  <div className={styles.heroContextBadge}>
    <Icon className={styles.heroContextBadgeIcon} strokeWidth={2.2} aria-hidden="true" />
    <span className={styles.heroContextBadgeLabel}>{label}</span>
    <span aria-hidden="true" className={styles.heroContextBadgeDivider}>/</span>
    <span className={styles.heroContextBadgeValue}>{value}</span>
  </div>
);

export function getRelativeTime(isoString: string, locale: DashboardLocale = "en"): string {
  const diff = Date.now() - new Date(isoString).getTime();
  if (Number.isNaN(diff)) return "";
  const sec = Math.floor(Math.max(0, diff) / 1000);
  if (sec < 60) return locale === "de" ? "gerade eben" : "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return locale === "de" ? `vor ${min} Min.` : `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return locale === "de" ? `vor ${hr} Std.` : `${hr} hr ago`;
  const day = Math.floor(hr / 24);
  return locale === "de" ? `vor ${day} Tag${day === 1 ? "" : "en"}` : `${day} day${day > 1 ? "s" : ""} ago`;
}

function formatWindowLabel(activeQuery: ProjectStatsQuery, allTime: string, start: string, end: string): string {
  if (activeQuery.window !== "custom") {
    return activeQuery.window === "all" ? allTime : activeQuery.window;
  }

  const from = activeQuery.from || start;
  const to = activeQuery.to || end;
  return `${from} → ${to}`;
}

function getCustomRangeMessage(from: string, to: string, chooseBothDates: string, endAfterStart: string): string {
  if (!from || !to) {
    return chooseBothDates;
  }

  if (!isValidCustomRange(from, to)) {
    return endAfterStart;
  }

  return "";
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
}) => {
  const { locale, text } = useStatsI18n();
  const [customRangeError, setCustomRangeError] = useState<string>("");
  const [customRangeStatus, setCustomRangeStatus] = useState<string>("");
  const [customRangeAttempted, setCustomRangeAttempted] = useState(activeQuery.window === "custom");
  const [customControlsOpen, setCustomControlsOpen] = useState(activeQuery.window === "custom");
  const customFromRef = useRef<HTMLInputElement>(null);
  const customToRef = useRef<HTMLInputElement>(null);

  const customRangeMessage = customControlsOpen && customRangeAttempted
    ? getCustomRangeMessage(customFrom, customTo, text("chooseBothDates"), text("endAfterStart"))
    : "";
  const rangeMessage = customRangeError || customRangeMessage;
  const rangeHasError = Boolean(rangeMessage);
  const startHasError = rangeHasError && !customFrom;
  const endHasError = rangeHasError && (!customTo || Boolean(customFrom && customTo && !isValidCustomRange(customFrom, customTo)));
  const customRangeDescriptionIds = rangeHasError
    ? "stats-custom-range-help stats-custom-range-error stats-custom-range-status"
    : "stats-custom-range-help stats-custom-range-status";
  const canApplyCustomRange = isValidCustomRange(customFrom, customTo);
  const selectedProjectLabel = selectedProject?.name || text("noProjectSelected");
  const generatedLabel = stats?.generatedAt ? formatDateTime(stats.generatedAt, locale) : text("noSnapshot");
  const rangeScopeLabel = stats?.range?.label || formatWindowLabel(activeQuery, text("allTime"), text("start"), text("end"));
  const activeModeLabel = {
    trend: text("trend"), composition: text("composition"), cost: text("cost"), models: text("models"),
    reliability: text("providers"), ledgers: text("ledgers"), system: text("system"),
  }[visualMode];
  const activeModeDescription = {
    trend: text("trendDescription"), composition: text("compositionDescription"), cost: MODE_DESCRIPTIONS.cost, models: text("modelsDescription"),
    reliability: text("reliabilityDescription"), ledgers: text("ledgersDescription"), system: text("systemDescription"),
  }[visualMode];

  useEffect(() => {
    if (activeQuery.window === "custom") {
      setCustomControlsOpen(true);
      setCustomRangeAttempted(true);
    }
  }, [activeQuery.window]);

  const handleApplyCustom = () => {
    if (!canApplyCustomRange) {
      const nextMessage = getCustomRangeMessage(customFrom, customTo, text("chooseBothDates"), text("endAfterStart"));
      setCustomRangeAttempted(true);
      setCustomRangeError(nextMessage);
      setCustomRangeStatus("");
      if (!customFrom) {
        customFromRef.current?.focus();
        return;
      }
      customToRef.current?.focus();
      return;
    }

    setCustomRangeError("");
    setCustomRangeAttempted(true);
    setCustomRangeStatus(text("customRangeApplied", { from: customFrom, to: customTo }));
    applyCustomRange();
  };

  const handlePresetClick = (window: typeof WINDOW_PRESETS[number]) => {
    setCustomRangeError("");
    setCustomRangeStatus("");

    if (window === "custom") {
      setCustomControlsOpen(true);
      return;
    }

    setCustomControlsOpen(false);
    setCustomRangeAttempted(false);
    setCustomRangeStatus(text("timeWindowChanged", { window: window === "all" ? text("allTime") : window }));
    applyPresetWindow(window);
  };

  return (
    <section className={`${HERO_PANEL_CLASS} ${styles.heroPanel}`} aria-labelledby="stats-hero-title">
      <div className={styles.heroGrid}>
        <div className={styles.heroIntro}>
          <div className={styles.heroTitleBlock}>
            <div className={styles.heroHeader}>
              <div className={styles.heroKicker}>{text("projectAnalytics")}</div>
              <div className={styles.heroTitleRow}>
                <h1 id="stats-hero-title" className={styles.heroTitle}>{text("stats")}</h1>
              </div>
              <p className={styles.heroSubtitle}>
                {text("heroSubtitle")}
              </p>
            </div>

            <div className={styles.heroSignalRow} aria-label={text("statsActiveLens")}>
              <div className={styles.heroSignalBadge}>
                <span>{text("window")}</span>
                <strong>{rangeScopeLabel}</strong>
              </div>
              <div className={styles.heroSignalBadge}>
                <span>{text("mode")}</span>
                <strong>{activeModeLabel}</strong>
              </div>
            </div>

            <div className={styles.heroContextGrid} aria-label={text("statsProjectContext")}>
              <ContextBadge icon={Layers3} label={text("project")} value={selectedProjectLabel} />
              <ContextBadge icon={Clock3} label={text("generated")} value={generatedLabel} />
              <ContextBadge
                icon={CalendarDays}
                label={text("sprint")}
                value={stats?.activeSprint ? `#${stats.activeSprint.sprintNumber ?? "?"}` : text("historicalLens")}
              />
            </div>
          </div>
        </div>

        <div className={`${SUBPANEL_CLASS} ${styles.heroControls}`} aria-label={text("statsCommandControls")}>
          <div className={styles.heroControlSection}>
            <div className={styles.heroControlHeader}>
              <div className={styles.heroControlHeaderText}>
                <div className={styles.heroControlEyebrow}>
                  {text("snapshotWindow")}
                </div>
                <div className={styles.heroControlDescription}>
                  {text("setRangeForViews")}
                </div>
              </div>
              <CalendarDays className={styles.heroControlIcon} strokeWidth={2.2} aria-hidden="true" />
            </div>

            <div role="group" aria-label={text("timeWindowPresets")} className={`${CHIP_CLASS} flex-wrap ${styles.heroPresetGroup}`}>
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
                    {window === "all" ? text("allTime") : window === "custom" ? text("custom") : window}
                  </button>
                );
              })}
            </div>

            {customControlsOpen ? (
              <div id="stats-custom-range-controls" className={styles.customRangeControls}>
                <label className={styles.customRangeField}>
                  <span className={styles.customRangeLabel}>{text("start")}</span>
                  <input
                    id="stats-custom-start"
                    ref={customFromRef}
                    type="date"
                    aria-label={text("customStartDate")}
                    value={customFrom}
                    onInput={(event) => {
                      setCustomFrom((event.currentTarget as HTMLInputElement).value);
                      setCustomRangeError("");
                      setCustomRangeStatus("");
                    }}
                    className={`${INPUT_CLASS} !h-10 w-full !px-3 !text-[12px]`}
                    aria-invalid={startHasError ? "true" : "false"}
                    aria-errormessage={startHasError ? "stats-custom-range-error" : undefined}
                    aria-describedby={customRangeDescriptionIds}
                  />
                </label>
                <label className={styles.customRangeField}>
                  <span className={styles.customRangeLabel}>{text("end")}</span>
                  <input
                    id="stats-custom-end"
                    ref={customToRef}
                    type="date"
                    aria-label={text("customEndDate")}
                    value={customTo}
                    onInput={(event) => {
                      setCustomTo((event.currentTarget as HTMLInputElement).value);
                      setCustomRangeError("");
                      setCustomRangeStatus("");
                    }}
                    className={`${INPUT_CLASS} !h-10 w-full !px-3 !text-[12px]`}
                    aria-invalid={endHasError ? "true" : "false"}
                    aria-errormessage={endHasError ? "stats-custom-range-error" : undefined}
                    aria-describedby={customRangeDescriptionIds}
                  />
                </label>
                <button
                  type="button"
                  onClick={handleApplyCustom}
                  aria-disabled={!canApplyCustomRange ? "true" : undefined}
                  className={styles.customRangeApply}
                >
                  {text("applyRange")}
                </button>
                <div id="stats-custom-range-help" className={styles.customRangeHelp} aria-live="polite">
                  {rangeHasError ? (
                    <span id="stats-custom-range-error" role="alert" className={styles.customRangeError}>
                      {rangeMessage}
                    </span>
                  ) : (
                    <span>{text("customRangeHelp")}</span>
                  )}
                </div>
              </div>
            ) : null}
            <div
              id="stats-custom-range-status"
              className={styles.customRangeStatus}
              role={customRangeStatus ? "status" : undefined}
              aria-live="polite"
              aria-atomic="true"
            >
              {customRangeStatus}
            </div>
          </div>

          <div className={`${styles.heroControlSection} ${styles.heroModeSection}`}>
            <div className={styles.heroControlHeader}>
              <div className={styles.heroControlHeaderText}>
                <div className={styles.heroControlEyebrow}>
                  {text("analysisMode")}
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
              ariaLabel={text("statsAnalysisModes")}
              className={styles.heroViewToggle}
              controlsId="stats-analysis-panel"
            />
          </div>
        </div>
      </div>
    </section>
  );
};
