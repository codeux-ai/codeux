import type { ComponentChildren, FunctionComponent } from "preact";
import type { SettingsValueSource } from "../../../../types.js";
import { getFieldSourceLabel } from "../../../lib/settings-view-models.js";

export const SectionCard: FunctionComponent<{
  title: string;
  watermark: string;
  children: ComponentChildren;
  danger?: boolean;
  badge?: string;
}> = ({ title, watermark, children, danger, badge }) => (
  <div className="group relative overflow-hidden rounded-[1.75rem] border border-black/[0.06] bg-white/70 backdrop-blur-2xl shadow-[0_2px_20px_rgba(0,0,0,0.04)] dark:border-white/[0.06] dark:bg-void-800/60 dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
    <div aria-hidden className={`absolute inset-x-0 top-0 h-20 bg-[linear-gradient(180deg,rgba(15,23,42,0.045),transparent)] dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.045),transparent)] ${danger ? "opacity-60" : "opacity-100"}`} />
    <div
      aria-hidden
      className={`pointer-events-none absolute -bottom-6 -right-4 select-none font-display text-[7rem] font-black leading-none tracking-tighter ${
        danger ? "text-status-red/[0.04]" : "text-black/[0.025] dark:text-white/[0.02]"
      }`}
    >
      {watermark}
    </div>

    <div className={`relative z-10 flex items-center justify-between gap-3 border-b border-black/[0.05] px-6 py-4 dark:border-white/[0.04] ${danger ? "bg-status-red/[0.03]" : ""}`}>
      <h3 className={`text-[11px] font-bold uppercase tracking-[0.2em] ${danger ? "text-status-red/70" : "text-slate-400 dark:text-slate-500"}`}>
        {title}
      </h3>
      {badge ? (
        <span className="rounded-full border border-signal-500/20 bg-signal-500/[0.08] px-3 py-1 text-[9px] font-bold uppercase tracking-[0.2em] text-signal-600 dark:text-signal-300">
          {badge}
        </span>
      ) : null}
    </div>

    <div className="relative z-10 px-5 py-5 md:px-6">
      <div className="flex flex-col gap-3">
        {children}
      </div>
    </div>
  </div>
);

export const IntegrationConfigRow: FunctionComponent<{
  label: string;
  description: string;
  connected: boolean;
  active: boolean;
  onConfigure: () => void;
  last?: boolean;
}> = ({ label, description, connected, active, onConfigure, last }) => (
  <div
    className={`flex items-center justify-between gap-6 py-4.5 ${!last ? "border-b border-black/[0.05] dark:border-white/[0.04]" : ""}`}
    style={{ paddingTop: "1.125rem", paddingBottom: "1.125rem" }}
  >
    <div>
      <div className="flex items-center gap-2">
        <div className="text-sm font-bold text-slate-800 dark:text-slate-100">{label}</div>
        {active ? (
          <span className="rounded-full border border-signal-500/25 bg-signal-500/10 px-2.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.16em] text-signal-600 dark:border-signal-400/25 dark:bg-signal-400/10 dark:text-signal-300">
            Active
          </span>
        ) : null}
      </div>
      <div className="mt-1 max-w-sm text-xs leading-relaxed text-slate-500 dark:text-slate-400">
        {description}
      </div>
    </div>
    <div className="flex shrink-0 items-center gap-3">
      {connected ? (
        <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-signal-500">
          <div className="h-1.5 w-1.5 rounded-full bg-signal-500" />
          Connected
        </div>
      ) : null}
      <button
        type="button"
        onClick={onConfigure}
        className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors ${
          connected
            ? "border-black/[0.06] bg-black/[0.03] text-slate-600 hover:bg-black/[0.06] dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-300 dark:hover:bg-white/[0.06]"
            : "border-black/[0.06] bg-white/80 text-slate-600 hover:bg-white dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-300 dark:hover:bg-white/[0.08]"
        }`}
      >
        {connected ? "Configure" : "Connect"}
      </button>
    </div>
  </div>
);

export const getBadge = (activeScope: string, projectSources: Record<string, SettingsValueSource>, ...prefixes: string[]): string | undefined => {
  if (activeScope !== "project") {
    return undefined;
  }
  const sourceLabel = (source: SettingsValueSource | undefined) => source ? getFieldSourceLabel(source, "project") ?? undefined : undefined;
  const getCombinedSource = (sources: Record<string, SettingsValueSource>, paths: string[]): SettingsValueSource | undefined => {
    for (const path of paths) {
      if (sources[path]) return sources[path];
    }
    return undefined;
  };
  return sourceLabel(getCombinedSource(projectSources, prefixes));
};

export const getFieldBadge = (activeScope: string, projectSources: Record<string, SettingsValueSource>, path: string): string | undefined => {
  if (activeScope !== "project") {
    return undefined;
  }
  const source = projectSources[path];
  return getFieldSourceLabel(source, "project") ?? undefined;
};
