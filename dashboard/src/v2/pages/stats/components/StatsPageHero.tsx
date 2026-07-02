import type { FunctionComponent, ComponentType } from "preact";
import { useState } from "preact/hooks";
import {
  Activity,
  BarChart3,
  Clock3,
  Cpu,
  Database,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-preact";
import type {
  Source,
  ProjectExecutionStatsSnapshot,
  ProjectStatsQuery,
  ProjectStatsWindow,
} from "../../../types.js";
import { formatCost, formatDateTime, formatStatsDuration, formatTokens, isValidCustomRange } from "../stats-utils.js";
import { PageHeader } from "../../../components/layout/PageHeader.js";
import {
  PANEL_CLASS,
  CHIP_CLASS,
  INPUT_CLASS,
  SUBPANEL_CLASS,
  ViewToggle,
  type StatsVisualMode,
} from "./StatsShared.js";

const WINDOW_PRESETS = ["1h", "24h", "7d", "30d", "all", "custom"] as const;

const SummaryMetric: FunctionComponent<{
  icon: ComponentType<any>;
  label: string;
  value: string;
  detail: string;
  valueClassName?: string;
}> = ({ icon: Icon, label, value, detail, valueClassName = "text-slate-900 dark:text-white" }) => (
  <div className={`${SUBPANEL_CLASS} flex min-h-[7.5rem] flex-col justify-between gap-4 p-4 md:p-5`}>
    <div className="flex items-center gap-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-signal-500/10 text-signal-600 dark:text-signal-400">
        <Icon className="h-4 w-4" strokeWidth={2.15} />
      </div>
      <div className="min-w-0">
        <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[color:var(--stats-label-color)]">{label}</div>
        <div className={`mt-1 break-words text-lg font-black leading-tight md:text-xl ${valueClassName}`}>{value}</div>
      </div>
    </div>
    <div className="text-[11px] font-medium leading-relaxed text-[color:var(--stats-detail-color)]">
      {detail}
    </div>
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
  applyCustomWindow,
  setCustomFrom,
  setCustomTo,
  applyCustomRange,
  visualMode,
  setVisualMode,
  completionConfidence = "No telemetry",
}) => {
  const [customRangeError, setCustomRangeError] = useState<string>("");

  const usage = stats?.usage;
  const customRangeMessage = activeQuery.window === "custom" ? getCustomRangeMessage(customFrom, customTo) : "";
  const rangeMessage = customRangeError || customRangeMessage;
  const rangeHasError = Boolean(rangeMessage);
  const selectedProjectLabel = selectedProject?.name || "No project selected";
  const generatedAtLabel = stats?.generatedAt ? formatDateTime(stats.generatedAt) : "No snapshot yet";
  const freshnessLabel = stats?.generatedAt ? getRelativeTime(stats.generatedAt) || "unknown" : "Awaiting first snapshot";
  const successRate = getSuccessRate(stats);
  const activeModelCount = stats?.models?.filter((model) => model.usage.totalTokens > 0).length || 0;
  const activeProviderCount = stats?.providers?.filter((provider) => provider.usage.totalTokens > 0).length || 0;
  const telemetrySourceQuality = usage ? getTelemetrySourceQuality(usage) : "Unavailable";

  const handleApplyCustom = () => {
    if (rangeHasError) {
      setCustomRangeError(rangeMessage);
      return;
    }

    setCustomRangeError("");
    applyCustomRange();
  };

  return (
    <section className={`${PANEL_CLASS} rounded-[2.5rem] p-6 md:p-8 xl:p-9`}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <PageHeader
            icon={BarChart3}
            eyebrow="Telemetry Atlas"
            title="Analytics workspace"
            subtitle="Project-scoped telemetry, pinned time windows, and mode-aware analytics for trend, composition, models, reliability, ledgers, and system views."
          />

          <div className="flex flex-wrap gap-2 lg:max-w-[32rem] lg:justify-end">
            <div className={`px-4 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-300 ${CHIP_CLASS}`}>
              Project · {selectedProjectLabel}
            </div>
            <div className={`px-4 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-300 ${CHIP_CLASS}`}>
              Window · {formatWindowLabel(activeQuery)}
            </div>
            <div className={`px-4 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-300 ${CHIP_CLASS}`}>
              Generated · {generatedAtLabel}
            </div>
            <div className={`px-4 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-300 ${CHIP_CLASS}`}>
              Freshness · {freshnessLabel}
            </div>
            {stats?.activeSprint ? (
              <div className={`px-4 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-300 ${CHIP_CLASS}`}>
                Sprint · {stats.activeSprint.sprintNumber ?? "?"}
              </div>
            ) : (
              <div className={`px-4 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-300 ${CHIP_CLASS}`}>
                Historical lens
              </div>
            )}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
          <SummaryMetric
            icon={Zap}
            label="Total tokens"
            value={usage ? formatTokens(usage.totalTokens) : "—"}
            detail="Window total across every tracked lane."
          />
          <SummaryMetric
            icon={Database}
            label="Total cost"
            value={usage ? formatCost(usage.totalCostUsd) : "—"}
            detail="Estimated spend for the selected project window."
          />
          <SummaryMetric
            icon={Clock3}
            label="Active time"
            value={usage ? formatStatsDuration(usage.activeTimeMs) : "—"}
            detail="Compute time actively spent on execution."
          />
          <SummaryMetric
            icon={ShieldCheck}
            label="Success rate"
            value={successRate.value}
            detail={stats ? `${stats.statusCounts ? stats.statusCounts.completed + stats.statusCounts.failed + stats.statusCounts.cancelled : 0} finished tasks` : "Waiting for task telemetry."}
            valueClassName={successRate.className}
          />
          <SummaryMetric
            icon={Cpu}
            label="Active models / providers"
            value={stats ? `${activeModelCount} models · ${activeProviderCount} providers` : "—"}
            detail="Participating model and provider lanes in this snapshot."
          />
          <SummaryMetric
            icon={Activity}
            label="Telemetry confidence"
            value={completionConfidence}
            detail={`Source quality: ${telemetrySourceQuality}`}
          />
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
          <div className={`${SUBPANEL_CLASS} flex min-h-[7.25rem] flex-col gap-4 p-4 md:p-5`}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[color:var(--stats-label-color)]">
                  Time window
                </div>
                <div className="mt-1 text-sm font-medium text-[color:var(--stats-detail-color)]">
                  Presets stay reachable, and custom dates stay keyboard-friendly.
                </div>
              </div>
              <div className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-300 ${CHIP_CLASS}`}>
                Current · {formatWindowLabel(activeQuery)}
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
              <div className="flex flex-col gap-3">
                <div role="group" aria-label="Time window presets" className={`inline-flex flex-wrap gap-2 p-1 ${CHIP_CLASS}`}>
                  {WINDOW_PRESETS.map((window) => {
                    const isActive = activeQuery.window === window;
                    return (
                      <button
                        key={window}
                        type="button"
                        onClick={() => window === "custom" ? (applyCustomWindow || applyCustomRange)() : applyPresetWindow(window)}
                        aria-pressed={isActive}
                        className={`rounded-full px-4 py-2 text-[11px] font-bold uppercase tracking-[0.16em] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-focus-ring)] ${
                          isActive
                            ? "border border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-300"
                            : "border border-transparent text-slate-500 hover:bg-[color:var(--fill-muted)] hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                        }`}
                      >
                        {window === "all" ? "All time" : window === "custom" ? "Custom" : window}
                      </button>
                    );
                  })}
                </div>

                {activeQuery.window === "custom" ? (
                  <div className="flex flex-col gap-2">
                    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,12rem)_minmax(0,12rem)]">
                      <input
                        id="stats-custom-start"
                        type="date"
                        aria-label="Custom start date"
                        value={customFrom}
                        onInput={(event) => {
                          setCustomFrom((event.currentTarget as HTMLInputElement).value);
                          setCustomRangeError("");
                        }}
                        className={`${INPUT_CLASS} !h-11 !px-3 !text-[12px]`}
                        aria-invalid={rangeHasError ? "true" : undefined}
                        aria-errormessage={rangeHasError ? "stats-custom-range-error" : undefined}
                        aria-describedby="stats-custom-range-help"
                      />
                      <input
                        id="stats-custom-end"
                        type="date"
                        aria-label="Custom end date"
                        value={customTo}
                        onInput={(event) => {
                          setCustomTo((event.currentTarget as HTMLInputElement).value);
                          setCustomRangeError("");
                        }}
                        className={`${INPUT_CLASS} !h-11 !px-3 !text-[12px]`}
                        aria-invalid={rangeHasError ? "true" : undefined}
                        aria-errormessage={rangeHasError ? "stats-custom-range-error" : undefined}
                        aria-describedby="stats-custom-range-help"
                      />
                    </div>
                    <div id="stats-custom-range-help" className="min-h-5 text-xs text-[color:var(--stats-detail-color)]">
                      {rangeHasError ? (
                        <span id="stats-custom-range-error" role="alert" className="font-medium text-red-500 dark:text-red-400">
                          {rangeMessage}
                        </span>
                      ) : (
                        <span>Custom ranges apply only when both dates are valid.</span>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>

              {activeQuery.window === "custom" ? (
                <button
                  type="button"
                  onClick={handleApplyCustom}
                  disabled={!isValidCustomRange(customFrom, customTo)}
                  aria-disabled={!isValidCustomRange(customFrom, customTo) ? "true" : undefined}
                  className="inline-flex h-11 items-center justify-center rounded-2xl bg-slate-900 px-5 text-[11px] font-bold uppercase tracking-[0.18em] text-white shadow-[0_10px_24px_rgba(15,23,42,0.08)] transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 dark:bg-white dark:text-void-900 dark:focus-visible:ring-offset-void-900 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Apply
                </button>
              ) : (
                <div className={`inline-flex h-11 items-center justify-center rounded-2xl px-5 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400 ${CHIP_CLASS}`}>
                  Preset active
                </div>
              )}
            </div>
          </div>

          <div className={`${SUBPANEL_CLASS} flex min-h-[7.25rem] flex-col justify-between gap-4 p-4 md:p-5`}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[color:var(--stats-label-color)]">
                  Mode navigation
                </div>
                <div className="mt-1 text-sm font-medium text-[color:var(--stats-detail-color)]">
                  Keyboard-accessible buttons keep every visual mode available.
                </div>
              </div>
              <Sparkles className="h-4 w-4 text-signal-500" strokeWidth={2.2} />
            </div>
            <ViewToggle value={visualMode} onChange={setVisualMode} ariaLabel="Analytics modes" className="justify-end" />
          </div>
        </div>
      </div>
    </section>
  );
};
