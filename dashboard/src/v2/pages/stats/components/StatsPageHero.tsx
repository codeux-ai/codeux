import type { FunctionComponent } from "preact";
import { BarChart3 } from "lucide-preact";
import { formatDateTime } from "../stats-utils.js";
import {
  PANEL_CLASS,
  CHIP_CLASS,
  RangeToggle,
} from "./StatsShared.js";

export const StatsPageHero: FunctionComponent<any> = ({
  selectedProject,
  stats,
  activeQuery,
  customFrom,
  customTo,
  applyPresetWindow,
  setCustomFrom,
  setCustomTo,
  applyCustomRange,
}) => {
  return (
    <section className={`${PANEL_CLASS} rounded-[2.5rem] p-8 md:p-10`}>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-black/[0.08] to-transparent dark:via-white/[0.14]" />
      <div className="relative flex flex-col gap-8 xl:flex-row xl:items-end xl:justify-between">
        <div className="max-w-4xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-signal-500/20 bg-signal-500/10 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-signal-600 dark:text-signal-400">
            <BarChart3 className="h-3.5 w-3.5" strokeWidth={2.2} />
            Telemetry Atlas
          </div>
          <h1 className="mt-6 text-5xl font-black tracking-[-0.06em] text-slate-900 dark:text-white md:text-7xl">
            Statistics.
          </h1>
          <p className="mt-5 max-w-3xl text-lg leading-relaxed text-slate-500 dark:text-slate-400">
            A high-signal telemetry workspace for planning, coding, CI recovery, and merge automation with deeper analysis, stronger interaction, and better operational usability.
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
        </div>
        <div className="flex flex-col items-start gap-4 xl:items-end">
          {/* Range filters are now managed within the Analysis Studio filter menu below */}
        </div>
      </div>
    </section>
  );
};
