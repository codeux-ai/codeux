import { createContext, type ComponentChildren, type FunctionComponent } from "preact";
import { useContext, useId, useMemo, useRef, useState } from "preact/hooks";
import { ArrowLeft, ArrowRight, BookOpenText } from "lucide-preact";
import type { SettingsValueSource } from "../../../../types.js";
import { getSettingsSubcategoryDoc, toHelpSections, type SettingsSubcategoryId } from "../../../lib/settings-subcategory-docs.js";
import { getFieldSourceLabel } from "../../../lib/settings-view-models.js";
import { InfoIconPopover } from "../../ui/InfoIconPopover.js";

interface SettingsDetailWorkspaceContextValue {
  enabled: boolean;
  activeSection: string | null;
  openSection: (sectionId: string) => void;
  closeSection: () => void;
}

const DISABLED_SETTINGS_DETAIL_WORKSPACE: SettingsDetailWorkspaceContextValue = {
  enabled: false,
  activeSection: null,
  openSection: () => {},
  closeSection: () => {},
};

const SettingsDetailWorkspaceContext = createContext<SettingsDetailWorkspaceContextValue>(DISABLED_SETTINGS_DETAIL_WORKSPACE);

export const useSettingsDetailWorkspace = (): SettingsDetailWorkspaceContextValue => (
  useContext(SettingsDetailWorkspaceContext)
);

export const SettingsDetailWorkspaceProvider: FunctionComponent<{
  enabled?: boolean;
  children: ComponentChildren;
}> = ({ enabled = true, children }) => (
  <SettingsDetailWorkspaceProviderState enabled={enabled}>
    {children}
  </SettingsDetailWorkspaceProviderState>
);

const SettingsDetailWorkspaceProviderState: FunctionComponent<{
  enabled: boolean;
  children: ComponentChildren;
}> = ({ enabled, children }) => {
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const value = useMemo<SettingsDetailWorkspaceContextValue>(() => ({
    enabled,
    activeSection: enabled ? activeSection : null,
    openSection: setActiveSection,
    closeSection: () => setActiveSection(null),
  }), [activeSection, enabled]);

  return (
    <SettingsDetailWorkspaceContext.Provider value={value}>
      <div
        data-settings-detail-active={enabled && activeSection ? "true" : "false"}
        className={enabled && activeSection ? "[&_[data-settings-overview-only]]:hidden" : undefined}
      >
        {children}
      </div>
    </SettingsDetailWorkspaceContext.Provider>
  );
};

export interface SettingsSectionHighlight {
  label: string;
  value: ComponentChildren;
  tone?: "neutral" | "active" | "warning";
}

export const SectionCard: FunctionComponent<{
  title: string;
  watermark?: string;
  children: ComponentChildren;
  danger?: boolean;
  badge?: string;
  icon?: ComponentChildren;
  actions?: ComponentChildren;
  helpId?: SettingsSubcategoryId | string;
  summary?: string;
  overview?: ComponentChildren;
  highlights?: SettingsSectionHighlight[];
  drilldown?: boolean;
  configureLabel?: string;
  sectionId?: string;
  featured?: boolean;
}> = ({
  title,
  watermark,
  children,
  danger,
  badge,
  icon,
  actions,
  helpId,
  summary,
  overview,
  highlights = [],
  drilldown,
  configureLabel = "Configure",
  sectionId,
  featured = false,
}) => {
  const titleId = useId();
  const detailsId = useId();
  const configureButtonRef = useRef<HTMLButtonElement>(null);
  const helpDoc = getSettingsSubcategoryDoc(helpId || title);
  const detailWorkspace = useContext(SettingsDetailWorkspaceContext);
  const resolvedSectionId = sectionId || String(helpId || title);
  const usesDrilldown = drilldown ?? detailWorkspace.enabled;
  const isFocusedDetail = usesDrilldown && detailWorkspace.activeSection === resolvedSectionId;
  const description = summary || helpDoc?.summary || `Configure ${title.toLowerCase()} when the defaults need to change.`;

  if (detailWorkspace.enabled && detailWorkspace.activeSection && !isFocusedDetail) {
    return null;
  }

  if (usesDrilldown && !isFocusedDetail) {
    return (
      <section
        aria-labelledby={titleId}
        data-settings-overview-card={resolvedSectionId}
        className={`group relative flex h-auto min-w-0 self-start flex-col overflow-hidden rounded-[1.75rem] border p-5 shadow-[var(--elevation-base)] transition-[border-color,box-shadow,transform] duration-300 hover:-translate-y-0.5 hover:shadow-[var(--elevation-raised)] motion-reduce:transform-none ${featured ? "xl:col-span-2" : ""} ${
          danger
            ? "border-status-red/20 bg-status-red/[0.03] dark:border-status-red/20 dark:bg-status-red/[0.04]"
            : "border-[color:var(--border-hairline)] bg-[var(--settings-card-surface)] hover:border-signal-500/20"
        }`}
      >
        <div aria-hidden className={`pointer-events-none absolute inset-y-0 left-0 w-1 ${danger ? "bg-status-red/65" : "bg-gradient-to-b from-signal-300 via-signal-500 to-cyan-600"}`} />
        <div aria-hidden className={`pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full blur-3xl ${danger ? "bg-status-red/[0.06]" : "bg-signal-500/[0.07]"}`} />
        <div className="relative flex items-start justify-between gap-4 pl-1">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              {icon ? (
                <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-[0.95rem] border ${danger ? "border-status-red/18 bg-status-red/[0.08] text-status-red" : "border-signal-500/16 bg-signal-500/[0.08] text-signal-600 dark:text-signal-300"}`} aria-hidden>
                  <span className="[&_svg]:h-[1.05rem] [&_svg]:w-[1.05rem]">{icon}</span>
                </span>
              ) : null}
              <div className="min-w-0">
                <div className={`font-mono text-[10px] font-bold uppercase tracking-[0.16em] ${danger ? "text-status-red/70" : "text-slate-400 dark:text-slate-500"}`}>
                  {watermark || "SET"} · Configuration area
                </div>
                <h3 id={titleId} className={`mt-1 font-display text-[1.05rem] font-semibold tracking-tight ${danger ? "text-status-red" : "text-slate-900 dark:text-white"}`}>{title}</h3>
              </div>
            </div>
            <p className="mt-3 max-w-3xl text-sm font-medium leading-relaxed text-slate-500 dark:text-slate-400">{description}</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {helpDoc ? (
              <>
                <InfoIconPopover
                  className="h-8 w-8 items-center justify-center rounded-full border border-black/[0.06] bg-black/[0.02] text-slate-500 transition-colors hover:border-signal-500/24 hover:bg-signal-500/[0.08] focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-500 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300"
                  title={`${helpDoc.title} settings`}
                  summary={helpDoc.summary}
                  sections={toHelpSections(helpDoc)}
                  label={`Show help for ${title}`}
                />
                <a href={helpDoc.docsHref} aria-label={`Open documentation for ${title}`} title={`Open documentation for ${title}`} className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-black/[0.06] bg-black/[0.02] text-slate-500 transition-colors hover:border-signal-500/24 hover:bg-signal-500/[0.08] hover:text-signal-600 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-500 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300">
                  <BookOpenText className="h-4 w-4" strokeWidth={1.8} aria-hidden />
                </a>
              </>
            ) : null}
            {badge ? <span className="rounded-full border border-signal-500/20 bg-signal-500/[0.08] px-3 py-1 text-[9px] font-bold uppercase tracking-[0.16em] text-signal-600 dark:text-signal-300">{badge}</span> : null}
          </div>
        </div>

        {highlights.length > 0 ? (
          <div className="mt-5 grid gap-2 sm:grid-cols-3">
            {highlights.slice(0, 3).map((highlight) => (
              <div key={highlight.label} className={`rounded-[1.1rem] border px-3.5 py-3 ${highlight.tone === "active" ? "border-signal-500/20 bg-signal-500/[0.07]" : highlight.tone === "warning" ? "border-status-amber/20 bg-status-amber/[0.07]" : "border-[color:var(--border-hairline)] bg-[var(--settings-inset-surface)]"}`}>
                <div className="text-[10px] font-bold uppercase tracking-[0.13em] text-slate-400">{highlight.label}</div>
                <div className="mt-1.5 break-words text-sm font-semibold text-slate-800 dark:text-slate-100">{highlight.value}</div>
              </div>
            ))}
          </div>
        ) : null}

        {overview ? <div className="mt-5">{overview}</div> : null}

        <div className="mt-5 flex border-t border-[color:var(--border-hairline)] pt-4">
          <button
            ref={configureButtonRef}
            type="button"
            onClick={() => detailWorkspace.openSection(resolvedSectionId)}
            aria-controls={detailsId}
            aria-label={`${configureLabel} ${title}`}
            className={`inline-flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border px-4 py-2.5 text-left text-xs font-bold transition-[background-color,border-color,color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-signal)] sm:min-h-10 sm:w-auto sm:min-w-[10rem] ${danger ? "border-status-red/20 bg-status-red/[0.06] text-status-red hover:bg-status-red/[0.1]" : "border-signal-500/20 bg-signal-500/[0.09] text-signal-800 hover:border-signal-500/30 hover:bg-signal-500/[0.15] hover:shadow-[0_8px_22px_rgba(var(--signal-rgb),0.1)] dark:text-signal-200"}`}
          >
            <span>{configureLabel}</span>
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transform-none" strokeWidth={2.2} aria-hidden />
          </button>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby={titleId} className={`relative overflow-hidden rounded-[1.75rem] border p-5 shadow-[var(--elevation-base)] backdrop-blur-sm ${featured || isFocusedDetail ? "xl:col-span-2 2xl:col-span-full" : ""} ${
    danger
      ? "border-status-red/20 bg-status-red/[0.03] dark:border-status-red/20 dark:bg-status-red/[0.04]"
      : "border-[color:var(--border-hairline)] bg-[var(--surface-glass)]"
  }`}>
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/35 to-transparent" />

    {isFocusedDetail ? (
      <button
        type="button"
        onClick={() => {
          detailWorkspace.closeSection();
          window.setTimeout(() => configureButtonRef.current?.focus({ preventScroll: true }), 0);
        }}
        className="mb-5 inline-flex min-h-9 items-center gap-2 rounded-xl border border-[color:var(--border-hairline)] bg-black/[0.025] px-3.5 py-2 text-xs font-bold text-slate-600 transition-colors hover:border-signal-500/25 hover:bg-signal-500/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-signal)] dark:bg-white/[0.035] dark:text-slate-300"
      >
        <ArrowLeft className="h-4 w-4" strokeWidth={2.2} aria-hidden />
        Back to category overview
      </button>
    ) : null}

    <div className={`flex justify-between gap-3 ${isFocusedDetail ? "items-start" : "items-center"}`}>
      <div className={`flex gap-2 ${isFocusedDetail ? "items-center" : "items-center text-[10px] font-bold uppercase tracking-[0.2em]"} ${danger ? "text-status-red/80" : "text-slate-500 dark:text-slate-300"}`}>
        {icon ? <span className={`inline-flex items-center justify-center ${isFocusedDetail ? "h-9 w-9 rounded-xl border border-signal-500/20 bg-signal-500/[0.08] text-signal-500 [&_svg]:h-4.5 [&_svg]:w-4.5" : "h-3.5 w-3.5 [&_svg]:h-3.5 [&_svg]:w-3.5"}`} aria-hidden>{icon}</span> : null}
        <div>
          {isFocusedDetail ? <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-signal-600 dark:text-signal-300">Focused settings</div> : null}
          <h3 id={titleId} className={isFocusedDetail ? "mt-1 font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-white" : undefined}>{title}</h3>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {actions ? actions : null}
        {helpDoc ? (
          <>
            <InfoIconPopover
              className="h-8 w-8 items-center justify-center rounded-full border border-black/[0.06] bg-black/[0.02] text-slate-500 transition-colors hover:border-signal-500/24 hover:bg-signal-500/[0.08] focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-500 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300 dark:hover:border-signal-300/24 dark:hover:bg-signal-300/[0.08]"
              title={`${helpDoc.title} settings`}
              summary={helpDoc.summary}
              sections={toHelpSections(helpDoc)}
              label={`Show help for ${title}`}
            />
            <a
              href={helpDoc.docsHref}
              aria-label={`Open documentation for ${title}`}
              title={`Open documentation for ${title}`}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-black/[0.06] bg-black/[0.02] text-slate-500 transition-colors hover:border-signal-500/24 hover:bg-signal-500/[0.08] hover:text-signal-600 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-500 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300 dark:hover:border-signal-300/24 dark:hover:bg-signal-300/[0.08] dark:hover:text-signal-200"
            >
              <BookOpenText className="h-4 w-4" strokeWidth={1.8} aria-hidden />
            </a>
          </>
        ) : null}
        {badge ? (
          <span className="rounded-full border border-signal-500/20 bg-signal-500/[0.08] px-3 py-1 text-[9px] font-bold uppercase tracking-[0.2em] text-signal-600 dark:text-signal-300">
            {badge}
          </span>
        ) : null}
      </div>
    </div>

    <p className="mt-3 max-w-3xl text-sm font-medium leading-relaxed text-slate-500 dark:text-slate-400">
      {description}
    </p>

    <div id={detailsId} className="mt-4 flex flex-col gap-3">
      <SettingsDetailWorkspaceContext.Provider value={DISABLED_SETTINGS_DETAIL_WORKSPACE}>
        {children}
      </SettingsDetailWorkspaceContext.Provider>
    </div>
  </section>
  );
};

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
    <section className={`rounded-[2rem] border transition-colors duration-300 p-6 shadow-[var(--elevation-base)] backdrop-blur-sm ${
      isOverridden
        ? "border-amber-500/20 bg-amber-500/[0.03] dark:border-amber-500/20 dark:bg-amber-500/[0.02]"
        : isMixed
          ? "border-sky-500/20 bg-sky-500/[0.02] dark:border-sky-500/20 dark:bg-sky-500/[0.02]"
          : "border-[color:var(--border-hairline)] bg-[var(--surface-glass)]"
    }`}>
      <div className={`mb-5 flex flex-wrap items-start justify-between gap-3 border-b pb-4 transition-colors duration-300 ${
        isOverridden
          ? "border-amber-500/10 dark:border-amber-500/10"
          : isMixed
            ? "border-sky-500/10 dark:border-sky-500/10"
            : "border-[color:var(--border-hairline)]"
      }`}>
        <div>
          <h3 className="font-display text-xl font-semibold tracking-tight text-slate-900 dark:text-white">{title}</h3>
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

export const OverrideBadge: FunctionComponent<{ label: string; contextLabel?: string; onReset?: () => void }> = ({ label, contextLabel, onReset }) => (
  <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/25 bg-amber-500/12 px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-amber-700 dark:border-amber-300/25 dark:bg-amber-300/14 dark:text-amber-200">
    <span className="h-1.5 w-1.5 rounded-full bg-amber-500 dark:bg-amber-300" />
    {label}
    {onReset && label === "Project override" ? (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onReset();
        }}
        title="Delete project override (revert to system default)"
        aria-label={`Delete project override for ${contextLabel || "setting"}`}
        className="ml-1 rounded-full p-0.5 text-amber-600 hover:bg-amber-500/20 hover:text-amber-800 dark:text-amber-300 dark:hover:bg-amber-300/25 dark:hover:text-amber-100 transition-colors duration-150 cursor-pointer"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" className="h-2.5 w-2.5">
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
          <path d="M3 3v5h5" />
        </svg>
      </button>
    ) : null}
  </span>
);

import {
  OptionCardChoiceGroup as SharedOptionCardChoiceGroup,
  Row as SharedRow,
  ToggleLinkedControlRow as SharedToggleLinkedControlRow,
} from "../SettingsFormFields.js";

export const OptionCardChoiceGroup = SharedOptionCardChoiceGroup;
export const ToggleLinkedControlRow = SharedToggleLinkedControlRow;

export const Row: FunctionComponent<{
  label: string;
  description?: string;
  children: ComponentChildren;
  badge?: string;
  last?: boolean;
  info?: ComponentChildren;
  onReset?: () => void;
}> = ({ label, description, children, badge, last, info, onReset }) => (
  <SharedRow label={label} description={description} badge={badge ? <OverrideBadge label={badge} contextLabel={label} onReset={onReset} /> : undefined} last={last} info={info}>
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
