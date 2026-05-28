import type { ComponentChildren, FunctionComponent } from "preact";
import type { SettingsValueSource } from "../../../../types.js";
import { getFieldSourceLabel } from "../../../lib/settings-view-models.js";

export const SectionCard: FunctionComponent<{
  title: string;
  watermark?: string;
  children: ComponentChildren;
  danger?: boolean;
  badge?: string;
  icon?: ComponentChildren;
}> = ({ title, children, danger, badge, icon }) => (
  <section className={`relative overflow-hidden rounded-[1.75rem] border p-5 shadow-[0_2px_20px_rgba(0,0,0,0.04)] backdrop-blur-sm dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)] ${
    danger
      ? "border-status-red/20 bg-status-red/[0.03] dark:border-status-red/20 dark:bg-status-red/[0.04]"
      : "border-black/[0.06] bg-white/80 dark:border-white/[0.06] dark:bg-void-800/75"
  }`}>
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/35 to-transparent" />

    <div className="mb-4 flex items-center justify-between gap-3">
      <div className={`flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] ${danger ? "text-status-red/80" : "text-slate-500 dark:text-slate-300"}`}>
        {icon ? <span className="inline-flex h-3.5 w-3.5 items-center justify-center [&_svg]:h-3.5 [&_svg]:w-3.5" aria-hidden>{icon}</span> : null}
        <h3>{title}</h3>
      </div>
      {badge ? (
        <span className="rounded-full border border-signal-500/20 bg-signal-500/[0.08] px-3 py-1 text-[9px] font-bold uppercase tracking-[0.2em] text-signal-600 dark:text-signal-300">
          {badge}
        </span>
      ) : null}
    </div>

    <div className="flex flex-col gap-3">
      {children}
    </div>
  </section>
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

export const Card: FunctionComponent<{ title: string; description: string; badge?: string; children: ComponentChildren }> = ({
  title,
  description,
  badge,
  children,
}) => {
  const isOverridden = badge === "Project override" || badge === "Sprint override";
  const isMixed = badge === "Mixed sources";
  const isInherited = badge === "Inherited";

  return (
    <section className={`rounded-[2rem] border transition-colors duration-300 p-6 shadow-[0_10px_30px_rgba(15,23,42,0.04)] backdrop-blur-sm dark:shadow-[0_12px_36px_rgba(0,0,0,0.22)] ${
      isOverridden
        ? "border-amber-500/20 bg-amber-500/[0.03] dark:border-amber-500/20 dark:bg-amber-500/[0.02]"
        : isMixed
          ? "border-sky-500/20 bg-sky-500/[0.02] dark:border-sky-500/20 dark:bg-sky-500/[0.02]"
          : "border-black/[0.06] bg-white/72 dark:border-white/[0.06] dark:bg-white/[0.03]"
    }`}>
      <div className={`mb-5 flex flex-wrap items-start justify-between gap-3 border-b pb-4 transition-colors duration-300 ${
        isOverridden
          ? "border-amber-500/10 dark:border-amber-500/10"
          : isMixed
            ? "border-sky-500/10 dark:border-sky-500/10"
            : "border-black/[0.06] dark:border-white/[0.06]"
      }`}>
        <div>
          <h3 className="font-display text-2xl font-black tracking-tight text-slate-900 dark:text-white">{title}</h3>
          <p className="mt-1 max-w-2xl text-sm font-medium text-slate-500 dark:text-slate-400">{description}</p>
        </div>
        {badge ? (
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] transition-colors duration-300 ${
            isOverridden
              ? "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-400"
              : isMixed
                ? "border-sky-500/25 bg-sky-500/10 text-sky-700 dark:border-sky-400/25 dark:bg-sky-400/10 dark:text-sky-400"
                : "border-slate-500/20 bg-slate-500/5 text-slate-600 dark:border-slate-400/20 dark:bg-slate-400/10 dark:text-slate-400"
          }`}>
            <span className={`h-1.5 w-1.5 rounded-full ${
              isOverridden ? "bg-amber-500 dark:bg-amber-400" : isMixed ? "bg-sky-500 dark:bg-sky-400" : "bg-slate-400 dark:bg-slate-500"
            }`} />
            {badge}
          </span>
        ) : null}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
};

export const OverrideBadge: FunctionComponent<{ label: string }> = ({ label }) => (
  <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/25 bg-amber-500/12 px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-amber-700 dark:border-amber-300/25 dark:bg-amber-300/14 dark:text-amber-200">
    <span className="h-1.5 w-1.5 rounded-full bg-amber-500 dark:bg-amber-300" />
    {label}
  </span>
);

import { Row as SharedRow } from "../SettingsFormFields.js";

export const Row: FunctionComponent<{ label: string; description?: string; children: ComponentChildren; badge?: string; last?: boolean; info?: ComponentChildren }> = ({ label, description, children, badge, last, info }) => (
  <SharedRow label={label} description={description} badge={badge ? <OverrideBadge label={badge} /> : undefined} last={last} info={info}>
    {children}
  </SharedRow>
);

import { ProviderBrandIcon } from "../../providers/ProviderBrandIcon.js";
import type { ProviderId } from "../../../../types.js";

export const ProviderLogo: FunctionComponent<{
  providerId: ProviderId | string;
  disabled?: boolean;
}> = ({ providerId, disabled = false }) => (
  <ProviderBrandIcon id={providerId} disabled={disabled} />
);
