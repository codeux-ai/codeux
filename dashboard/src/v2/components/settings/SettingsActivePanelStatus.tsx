import type { FunctionComponent, JSX } from "preact";
import type { SettingsPageState } from "../../hooks/use-settings-page-state.js";
import { getDocumentDashboardLocale, getSettingsShellMessage, type SettingsShellMessageKey } from "../../i18n/messages/settings-shell.js";

const formatCategoryLabel = (category: SettingsPageState["activeCategory"]): string => (
  `${category.charAt(0).toUpperCase()}${category.slice(1)}`
);

export const SettingsActivePanelStatus: FunctionComponent<{
  state: SettingsPageState;
  sticky?: boolean;
  stickyTop?: string;
  className?: string;
  style?: JSX.CSSProperties;
}> = ({
  state,
  sticky = true,
  stickyTop = "9.5rem",
  className,
  style,
}) => {
  const locale = getDocumentDashboardLocale();
  const t = (key: SettingsShellMessageKey, variables?: Parameters<typeof getSettingsShellMessage>[2]): string => getSettingsShellMessage(locale, key, variables);
  const { activeCategory, activeDirty, activeSaving, error, saveMessage, loading, resettingProject } = state;
  const activeCategoryLabel = state.activeCategoryConfig?.label ?? formatCategoryLabel(activeCategory);

  const panelStatus = error
    ? t("panelBlocked", { category: activeCategoryLabel, error })
    : resettingProject
      ? t("panelResetPending", { category: activeCategoryLabel })
      : activeSaving
        ? t("panelSavePending", { category: activeCategoryLabel })
        : saveMessage
          ? t("panelSavedMessage", { category: activeCategoryLabel, message: saveMessage })
          : activeDirty
            ? t("panelDirty", { category: activeCategoryLabel })
            : t("panelSaved", { category: activeCategoryLabel });
  const visibleSaveState = error
    ? t("blocked")
    : loading
      ? t("loading")
      : resettingProject
        ? t("resetting")
        : activeSaving
          ? t("saving")
          : activeDirty
            ? t("unsavedChanges")
            : saveMessage
              ? t("saved")
              : t("saved");
  const statusStyle = sticky
    ? ({
      ...style,
      "--settings-active-panel-top": stickyTop,
    } as JSX.CSSProperties)
    : style;
  const statusClassName = [
    sticky ? "sticky top-[var(--settings-active-panel-top)] z-20 mb-3" : null,
    "flex min-w-0 flex-wrap items-center gap-2 overflow-visible rounded-[1rem] border border-[color:var(--border-hairline)] bg-[var(--surface-glass)] px-3 py-2 text-xs font-semibold text-slate-500 shadow-[var(--elevation-base)] backdrop-blur-2xl dark:text-slate-300",
    className,
  ].filter(Boolean).join(" ");

  return (
    <>
      <div role={error ? "alert" : "status"} aria-live={error ? "assertive" : "polite"} aria-atomic="true" className="sr-only">
        {panelStatus}
      </div>
      <div
        data-settings-sticky={sticky ? "active-panel" : undefined}
        style={statusStyle}
        className={statusClassName}
      >
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">{t("activePanel")}</span>
        <span className="min-w-0 max-w-full break-words text-slate-800 dark:text-slate-100">{activeCategoryLabel}</span>
        <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">/</span>
        <span className={`min-w-0 max-w-full break-words ${error ? "text-status-red" : activeSaving || loading || resettingProject ? "text-signal-700 dark:text-signal-300" : activeDirty ? "text-amber-700 dark:text-amber-200" : "text-status-green"}`}>
          {visibleSaveState}
        </span>
      </div>
    </>
  );
};
