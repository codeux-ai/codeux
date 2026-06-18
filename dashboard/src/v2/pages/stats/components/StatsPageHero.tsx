import type { FunctionComponent } from "preact";
import { Activity, BarChart3, Clock3, Cpu, ShieldCheck, Zap } from "lucide-preact";
import type {
  Source,
  ProjectExecutionStatsSnapshot,
  ProjectStatsQuery,
  ProjectStatsWindow,
} from "../../../types.js";
import { formatDateTime, formatDuration, formatTokens } from "../stats-utils.js";
import {
  PANEL_CLASS,
  CHIP_CLASS,
  INPUT_CLASS,
  ViewToggle,
  type StatsVisualMode,
} from "./StatsShared.js";

const HeroKpi: FunctionComponent<{
  icon: typeof Zap;
  label: string;
  value: string;
  valueClassName?: string;
}> = ({ icon: Icon, label, value, valueClassName = "text-slate-900 dark:text-white" }) => (
  <div className="flex items-center gap-3 rounded-2xl border border-black/[0.05] bg-white/68 px-4 py-3 backdrop-blur-xl dark:border-white/[0.05] dark:bg-void-900/35">
    <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-signal-500/10 text-signal-600 dark:text-signal-400">
      <Icon className="h-3.5 w-3.5" strokeWidth={2.2} />
    </div>
    <div className="min-w-0">
      <div className={`truncate text-base font-black leading-tight ${valueClassName}`}>{value}</div>
      <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400">{label}</div>
    </div>
  </div>
);

const WINDOW_PRESETS = ["1h", "24h", "7d", "30d", "all"] as const;

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

const MODE_DESCRIPTIONS: Record<StatsVisualMode, string> = {
  trend: "Time-series view of token throughput, invocations, and compute time across the selected window.",
  composition: "Provider share, token anatomy, and purpose breakdown for the selected window.",
  models: "Per-model performance rankings: latency, velocity, efficiency, and reliability.",
  reliability: "Telemetry source quality, provider confidence, and data integrity audit.",
  ledgers: "Deep operational ledgers for individual tasks and sprints.",
  system: "Live system debug: invocations, errors, sprint state, and external API activity.",
};

export interface StatsPageHeroProps {
  selectedProject: Source | null;
  stats: ProjectExecutionStatsSnapshot | null;
  activeQuery: ProjectStatsQuery;
  customFrom: string;
  customTo: string;
  applyPresetWindow: (window: Exclude<ProjectStatsWindow, "custom">) => void;
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
  const usage = stats?.usage;
  const finishedCount = stats?.statusCounts
    ? stats.statusCounts.completed + stats.statusCounts.failed + stats.statusCounts.cancelled
    : 0;

  let successRateColor = "text-slate-900 dark:text-white";
  let successRateString = "—";
  if (stats?.statusCounts && finishedCount > 0) {
    const rate = Math.round((stats.statusCounts.completed / finishedCount) * 100);
    successRateString = `${rate}%`;
    if (rate >= 95) {
      successRateColor = "text-emerald-600 dark:text-emerald-400";
    } else if (rate >= 80) {
      successRateColor = "text-amber-600 dark:text-amber-400";
    } else {
      successRateColor = "text-red-500 dark:text-red-400";
    }
  }

  return (
    <section className={`${PANEL_CLASS} rounded-[2.5rem] p-8 md:p-10`}>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-black/[0.08] to-transparent dark:via-white/[0.14]" />
      <div className="relative flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-4xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-signal-500/20 bg-signal-500/10 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-signal-600 dark:text-signal-400">
            <BarChart3 className="h-3.5 w-3.5" strokeWidth={2.2} />
            Telemetry Atlas
          </div>
          <h1 className="mt-6 text-5xl font-black tracking-[-0.06em] text-slate-900 dark:text-white md:text-7xl">
            Statistics.
          </h1>
          <p className="mt-3 max-w-2xl text-sm text-slate-500 dark:text-slate-400">
            {MODE_DESCRIPTIONS[visualMode]}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <div className={`px-4 py-2 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-300 ${CHIP_CLASS}`}>
              {selectedProject?.name || "No project selected"}
            </div>
            <div className={`px-4 py-2 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-300 ${CHIP_CLASS}`}>
              {stats?.activeSprint ? `Live sprint ${stats.activeSprint.sprintNumber ?? "?"}` : "Historical lens"}
            </div>
            <div className={`px-4 py-2 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-300 ${CHIP_CLASS}`}>
              Generated {stats ? formatDateTime(stats.generatedAt) : "--"}
            </div>
            {stats ? (
              <div className={`px-4 py-2 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-300 ${CHIP_CLASS}`}>
                {stats.range.resolutionLabel}
              </div>
            ) : null}
          </div>
          {stats?.generatedAt ? (
            <div className="mt-3 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
              Updated {getRelativeTime(stats.generatedAt)}
            </div>
          ) : null}
          {usage ? (
            <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
              <HeroKpi icon={Zap} label="Tokens" value={formatTokens(usage.totalTokens)} />
              <HeroKpi icon={Activity} label="Invocations" value={usage.invocationCount.toLocaleString()} />
              <HeroKpi icon={Clock3} label="Active Time" value={formatDuration(usage.activeTimeMs)} />
              <HeroKpi
                icon={ShieldCheck}
                label="Success Rate"
                value={successRateString}
                valueClassName={successRateColor}
              />
              <HeroKpi icon={Cpu} label="Models" value={String(stats?.models?.length ?? 0)} />
            </div>
          ) : null}
        </div>
        <div className="flex flex-col items-start gap-4 lg:items-end lg:justify-end w-full lg:w-auto mt-6 lg:mt-0">
          <div className={`inline-flex flex-wrap p-1 w-full sm:w-auto ${CHIP_CLASS}`}>
            {WINDOW_PRESETS.map((window) => {
              const isActive = activeQuery.window === window;
              return (
                <button
                  key={window}
                  type="button"
                  onClick={() => applyPresetWindow(window)}
                  aria-pressed={isActive}
                  className={`rounded-full px-4 py-2 text-[11px] font-bold uppercase tracking-[0.2em] transition-all border border-transparent ${
                    isActive
                      ? "bg-amber-500/15 border-amber-500/30 text-amber-700 dark:text-amber-300"
                      : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                  }`}
                >
                  {window === "all" ? "All time" : window}
                </button>
              );
            })}
          </div>
          {activeQuery.window === "custom" ? (
            <div className="grid w-full gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
              <input
                type="date"
                value={customFrom}
                onInput={(event) => setCustomFrom((event.currentTarget as HTMLInputElement).value)}
                className={`${INPUT_CLASS} !h-10 !px-3 !text-[12px]`}
              />
              <input
                type="date"
                value={customTo}
                onInput={(event) => setCustomTo((event.currentTarget as HTMLInputElement).value)}
                className={`${INPUT_CLASS} !h-10 !px-3 !text-[12px]`}
              />
              <button
                type="button"
                onClick={applyCustomRange}
                className="inline-flex h-10 items-center justify-center rounded-2xl bg-slate-900 px-4 text-[11px] font-bold uppercase tracking-[0.2em] text-white shadow-[0_10px_24px_rgba(15,23,42,0.08)] transition-transform hover:-translate-y-0.5 dark:bg-white dark:text-void-900"
              >
                Apply
              </button>
            </div>
          ) : null}
          <ViewToggle value={visualMode} onChange={setVisualMode} />
        </div>
      </div>
    </section>
  );
};
