import type { JSX } from "preact";
import { ShieldCheck } from "lucide-preact";
import type { SettingsScope } from "../../hooks/use-settings-page-state.js";
import type { Source } from "../../types.js";
import { getDocumentDashboardLocale, getSettingsShellMessage, type SettingsShellMessageKey } from "../../i18n/messages/settings-shell.js";

export interface SettingsScopeControlsProps {
  activeScope: SettingsScope;
  setActiveScope: (scope: SettingsScope) => void | Promise<void>;
  selectedProject: Source | null;
  scopeStatusText: string;
  projectSourceSummary: string | null;
  filteredCategoryCount: number;
  isSearchActive: boolean;
  activeDirty: boolean;
  activeSaving: boolean;
  saveMessage: string | null;
  error: string | null;
  interactionStyle: JSX.CSSProperties;
}

const scopeStatusId = "settings-scope-status";

const contextChipClassName = "min-w-0 max-w-full break-words rounded-[1rem] border border-black/[0.06] bg-white/70 px-4 py-2 text-xs font-semibold text-slate-500 backdrop-blur-2xl sm:rounded-full dark:border-white/[0.06] dark:bg-void-800/60 dark:text-slate-300";
const projectSummaryChipClassName = "hidden min-w-0 max-w-full break-words rounded-[1rem] border border-slate-500/15 bg-slate-500/[0.06] px-4 py-2 text-xs font-semibold text-slate-600 backdrop-blur-2xl sm:rounded-full xl:block dark:border-slate-300/15 dark:bg-slate-300/[0.08] dark:text-slate-300";
const unsavedChipClassName = "min-w-0 max-w-full break-words rounded-[1rem] border border-amber-500/20 bg-amber-500/10 px-4 py-2 text-xs font-semibold text-amber-700 backdrop-blur-2xl sm:rounded-full dark:border-amber-300/20 dark:bg-amber-300/10 dark:text-amber-200";

export function SettingsScopeControls({
  activeScope,
  setActiveScope,
  selectedProject,
  scopeStatusText,
  projectSourceSummary,
  filteredCategoryCount,
  isSearchActive,
  activeDirty,
  activeSaving,
  saveMessage,
  error,
  interactionStyle,
}: SettingsScopeControlsProps): JSX.Element {
  const locale = getDocumentDashboardLocale();
  const t = (key: SettingsShellMessageKey, variables?: Parameters<typeof getSettingsShellMessage>[2]): string => getSettingsShellMessage(locale, key, variables);
  const scopeButtonClassName = (scope: SettingsScope): string => `h-8 rounded-[1rem] px-4 py-2 text-xs font-bold uppercase tracking-[0.16em] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-signal)] focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-void-900 ${
    activeScope === scope
      ? "bg-signal-500/[0.12] text-signal-700 dark:text-signal-300"
      : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
  }`;

  return (
    <>
      <div
        role="radiogroup"
        aria-label={t("settingsScope")}
        aria-describedby={`settings-scope-context settings-project-scope-disabled ${scopeStatusId}`}
        className="rounded-2xl border border-[color:var(--border-hairline)] bg-[var(--surface-glass)] p-1 backdrop-blur-2xl shadow-[var(--elevation-base)]"
      >
        <button
          type="button"
          role="radio"
          aria-checked={activeScope === "system"}
          onClick={() => { void setActiveScope("system"); }}
          style={interactionStyle}
          className={scopeButtonClassName("system")}
        >
          {t("system")}
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={activeScope === "project"}
          aria-describedby={!selectedProject ? "settings-project-scope-disabled" : undefined}
          onClick={() => {
            if (selectedProject) {
              void setActiveScope("project");
            }
          }}
          disabled={!selectedProject}
          style={interactionStyle}
          className={`${scopeButtonClassName("project")} disabled:cursor-not-allowed disabled:opacity-50 disabled:pointer-events-none`}
        >
          {t("project")}
        </button>
      </div>
      <div id={scopeStatusId} role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {scopeStatusText}
      </div>

      {activeScope === "system" ? (
        <div id="settings-scope-context" className="sr-only">
          {t("editingSystemDefaults")}
        </div>
      ) : (
        <div id="settings-scope-context" className={contextChipClassName}>
          {selectedProject
            ? t("editingProjectOverrides", { project: selectedProject.name })
            : t("selectProjectOverrides")}
        </div>
      )}
      {projectSourceSummary ? (
        <div className={projectSummaryChipClassName}>
          {projectSourceSummary}
        </div>
      ) : null}
      {!selectedProject ? (
        <div id="settings-project-scope-disabled" className="sr-only">
          {t("projectScopeLocked")}
        </div>
      ) : (
        <div id="settings-project-scope-disabled" className="sr-only">
          {t("projectScopeAvailable")}
        </div>
      )}

      {isSearchActive ? (
        <div className={contextChipClassName}>
          {t(filteredCategoryCount === 1 ? "visibleCategory" : "visibleCategories", { count: filteredCategoryCount })}
        </div>
      ) : null}

      {activeDirty ? (
        <div className={unsavedChipClassName}>
          {t("unsavedEdits")}
        </div>
      ) : null}
      {!activeDirty && !activeSaving && saveMessage && !error ? (
        <div className="inline-flex min-w-0 max-w-full items-center gap-1.5 break-words rounded-[1rem] border border-status-green/20 bg-status-green/10 px-4 py-2 text-xs font-semibold text-status-green backdrop-blur-2xl sm:rounded-full">
          <ShieldCheck className="h-3.5 w-3.5" strokeWidth={2.2} />
          {t("saved")}
        </div>
      ) : null}
    </>
  );
}
