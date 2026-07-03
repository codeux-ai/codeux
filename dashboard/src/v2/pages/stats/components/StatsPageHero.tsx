import type { FunctionComponent, ComponentType } from "preact";
import { useEffect, useState } from "preact/hooks";
import {
  Activity,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Cpu,
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

const WINDOW_PRESETS = ["1h", "24h", "7d", "30d", "all", "custom"] as const;

const SummaryMetric: FunctionComponent<{
  icon: ComponentType<any>;
  label: string;
  value: string;
  detail: string;
  valueClassName?: string;
}> = ({ icon: Icon, label, value, detail, valueClassName = "text-slate-900 dark:text-white" }) => (
  <div className={`${SUBPANEL_CLASS} flex min-h-[6.25rem] flex-col justify-between gap-3 !p-3.5 md:!p-4`}>
    <div className="flex min-w-0 items-center gap-2.5">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[color:var(--stats-accent-amber-fill)] text-amber-700 dark:text-amber-300">
        <Icon className="h-4 w-4" strokeWidth={2.15} aria-hidden="true" />
      </div>
      <div className="min-w-0 text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-label-color)]">
        {label}
      </div>
    </div>
    <div>
      <div className={`truncate text-lg font-black leading-tight md:text-xl ${valueClassName}`}>{value}</div>
      <div className="mt-1 truncate text-[11px] font-medium leading-relaxed text-[color:var(--stats-detail-color)]">
        {detail}
      </div>
    </div>
  </div>
);

const ContextBadge: FunctionComponent<{
  icon: ComponentType<any>;
  label: string;
  value: string;
}> = ({ icon: Icon, label, value }) => (
  <div className={`inline-flex min-w-0 items-center gap-2 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-300 ${CHIP_CLASS}`}>
    <Icon className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-300" strokeWidth={2.2} aria-hidden="true" />
    <span className="shrink-0">{label}</span>
    <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">/</span>
    <span className="truncate text-slate-700 dark:text-slate-100">{value}</span>
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
  const selectedProjectLabel = selectedProject?.name || "No project selected";
  const generatedAtLabel = stats?.generatedAt ? formatDateTime(stats.generatedAt) : "No snapshot yet";
  const freshnessLabel = stats?.generatedAt ? getRelativeTime(stats.generatedAt) || "unknown" : "Awaiting first snapshot";
  const successRate = getSuccessRate(stats);
  const activeModelCount = stats?.models?.filter((model) => model.usage.totalTokens > 0).length || 0;
  const activeProviderCount = stats?.providers?.filter((provider) => provider.usage.totalTokens > 0).length || 0;
  const invocationCount = usage?.invocationCount ?? 0;
  const telemetrySourceQuality = usage ? getTelemetrySourceQuality(usage) : "Unavailable";

  useEffect(() => {
    if (activeQuery.window === "custom") {
      setCustomControlsOpen(true);
    }
  }, [activeQuery.window]);

  const handleApplyCustom = () => {
    if (rangeHasError) {
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
    <section className={`${PANEL_CLASS} rounded-[2rem] !p-5 md:!p-6 xl:!p-7`}>
      <div className="flex flex-col gap-5">
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,34rem)] xl:items-start">
          <div className="flex min-w-0 flex-col gap-4">
            <PageHeader
              icon={BarChart3}
              eyebrow="Telemetry Command"
              title="Stats control room"
              subtitle="Project telemetry, freshness, range, and analysis mode stay visible before the workspace changes."
            />

            <div className="flex flex-wrap gap-2">
              <ContextBadge icon={Layers3} label="Project" value={selectedProjectLabel} />
              <ContextBadge
                icon={CalendarDays}
                label="Sprint"
                value={stats?.activeSprint ? `#${stats.activeSprint.sprintNumber ?? "?"}` : "Historical lens"}
              />
              <ContextBadge icon={Clock3} label="Generated" value={generatedAtLabel} />
              <ContextBadge icon={RadioTower} label="Freshness" value={freshnessLabel} />
              <ContextBadge icon={ShieldCheck} label="Source" value={telemetrySourceQuality} />
            </div>
          </div>

          <div className={`${SUBPANEL_CLASS} flex min-w-0 flex-col gap-4 !p-4 md:!p-5`}>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[color:var(--stats-label-color)]">
                    Time window
                  </div>
                  <div className="mt-1 text-sm font-medium text-[color:var(--stats-detail-color)]">
                    Current · {formatWindowLabel(activeQuery)}
                  </div>
                </div>
                <CalendarDays className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" strokeWidth={2.2} aria-hidden="true" />
              </div>

              <div role="group" aria-label="Time window presets" className={`flex w-full gap-1 overflow-x-auto p-1 ${CHIP_CLASS}`}>
                {WINDOW_PRESETS.map((window) => {
                  const isActive = window === "custom" ? customControlsOpen : activeQuery.window === window;
                  return (
                    <button
                      key={window}
                      type="button"
                      onClick={() => handlePresetClick(window)}
                      aria-pressed={isActive}
                      className={`inline-flex h-9 shrink-0 items-center justify-center rounded-full border px-3 text-[11px] font-bold uppercase tracking-[0.14em] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-void-900 ${
                        isActive
                          ? "border-amber-500/30 bg-[color:var(--stats-accent-amber-fill)] text-amber-700 dark:text-amber-300"
                          : "border-transparent text-slate-500 hover:bg-[color:var(--fill-muted-hover)] hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                      }`}
                    >
                      {window === "all" ? "All time" : window === "custom" ? "Custom" : window}
                    </button>
                  );
                })}
              </div>
            </div>

            {customControlsOpen ? (
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                <input
                  id="stats-custom-start"
                  type="date"
                  aria-label="Custom start date"
                  value={customFrom}
                  onInput={(event) => {
                    setCustomFrom((event.currentTarget as HTMLInputElement).value);
                    setCustomRangeError("");
                  }}
                  className={`${INPUT_CLASS} !h-10 !px-3 !text-[12px]`}
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
                  className={`${INPUT_CLASS} !h-10 !px-3 !text-[12px]`}
                  aria-invalid={rangeHasError ? "true" : undefined}
                  aria-errormessage={rangeHasError ? "stats-custom-range-error" : undefined}
                  aria-describedby="stats-custom-range-help"
                />
                <button
                  type="button"
                  onClick={handleApplyCustom}
                  disabled={!isValidCustomRange(customFrom, customTo)}
                  aria-disabled={!isValidCustomRange(customFrom, customTo) ? "true" : undefined}
                  className="inline-flex h-10 items-center justify-center rounded-[var(--stats-control-radius)] bg-slate-900 px-4 text-[11px] font-bold uppercase tracking-[0.16em] text-white shadow-[0_10px_24px_rgba(15,23,42,0.08)] transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--stats-focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:bg-white dark:text-void-900 dark:focus-visible:ring-offset-void-900 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Apply
                </button>
                <div id="stats-custom-range-help" className="sm:col-span-3 min-h-5 text-xs text-[color:var(--stats-detail-color)]">
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

            <div className="flex min-w-0 flex-col gap-3 border-t border-[color:var(--stats-border-hairline)] pt-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[color:var(--stats-label-color)]">
                  Analysis mode
                </div>
                <CheckCircle2 className="h-4 w-4 shrink-0 text-signal-600 dark:text-signal-400" strokeWidth={2.2} aria-hidden="true" />
              </div>
              <div className="-mx-1 overflow-x-auto px-1 pb-1">
                <ViewToggle
                  value={visualMode}
                  onChange={setVisualMode}
                  ariaLabel="Analytics modes"
                  className="min-w-max !flex-nowrap"
                />
              </div>
            </div>
          </div>
        </div>

        <div aria-label="Executive summary" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <SummaryMetric
            icon={Zap}
            label="Tokens"
            value={usage ? formatTokens(usage.totalTokens) : "—"}
            detail="Selected window"
          />
          <SummaryMetric
            icon={Clock3}
            label="Active time"
            value={usage ? formatStatsDuration(usage.activeTimeMs) : "—"}
            detail="Execution time"
          />
          <SummaryMetric
            icon={Activity}
            label="Invocations"
            value={usage ? invocationCount.toLocaleString() : "—"}
            detail={completionConfidence}
          />
          <SummaryMetric
            icon={ShieldCheck}
            label="Success rate"
            value={successRate.value}
            detail={stats ? `${stats.statusCounts ? stats.statusCounts.completed + stats.statusCounts.failed + stats.statusCounts.cancelled : 0} finished tasks` : "No task telemetry"}
            valueClassName={successRate.className}
          />
          <SummaryMetric
            icon={Cpu}
            label="Models"
            value={stats ? `${activeModelCount}` : "—"}
            detail={`${activeProviderCount} active providers`}
          />
        </div>
      </div>
    </section>
  );
};
