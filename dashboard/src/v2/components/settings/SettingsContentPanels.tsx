import type { FunctionComponent, JSX } from "preact";
import type { SettingsPageState } from "../../hooks/use-settings-page-state.js";
import { SettingsGeneralPanel } from "./panels/SettingsGeneralPanel.js";
import { SettingsAppearancePanel } from "./panels/SettingsAppearancePanel.js";
import { SettingsModelsPanel } from "./panels/SettingsModelsPanel.js";
import { SettingsSprintPanel } from "./panels/SettingsSprintPanel.js";
import { SettingsBrowserPanel } from "./panels/SettingsBrowserPanel.js";
import { SettingsAgentsPanel } from "./panels/SettingsAgentsPanel.js";
import { SettingsMemoryPanel } from "./panels/SettingsMemoryPanel.js";
import { SettingsIntegrationsPanel } from "./panels/SettingsIntegrationsPanel.js";
import { SettingsMcpPanel } from "./panels/SettingsMcpPanel.js";
import { SettingsDangerPanel } from "./panels/SettingsDangerPanel.js";
import { ActionFeedbackRegion } from "../ui/ActionFeedbackRegion.js";
import { useInteractionTokens } from "../../lib/motion/tokens.js";

export const SettingsContentPanels: FunctionComponent<{
  state: SettingsPageState;
  stickyTop?: string;
}> = ({ state, stickyTop = "9.5rem" }) => {
  const { activeCategory, activeDirty, activeSaving, error, saveMessage, loading, resettingProject } = state;
  const tokens = useInteractionTokens();
  const activeCategoryLabel = state.activeCategoryConfig?.label ?? `${activeCategory.charAt(0).toUpperCase()}${activeCategory.slice(1)}`;

  const panelStatus = error
    ? `${activeCategoryLabel} settings blocked: ${error}`
    : resettingProject
      ? `${activeCategoryLabel} project override reset is pending.`
    : activeSaving
      ? `${activeCategoryLabel} settings save is pending.`
      : saveMessage
        ? `${activeCategoryLabel} settings saved. ${saveMessage}`
        : activeDirty
          ? `${activeCategoryLabel} settings have local unsaved changes.`
          : `${activeCategoryLabel} settings are saved.`;
  const visibleSaveState = error
    ? "Blocked"
    : loading
      ? "Loading"
      : resettingProject
        ? "Resetting"
        : activeSaving
          ? "Saving"
          : activeDirty
              ? "Unsaved changes"
              : saveMessage
                ? "Saved"
                : "Saved";
  const stickyStyle = {
    "--settings-active-panel-top": stickyTop,
  } as JSX.CSSProperties;

  const renderPanel = () => {
    switch (activeCategory) {
      case "general":
        return <SettingsGeneralPanel state={state} />;
      case "appearance":
        return <SettingsAppearancePanel state={state} />;
      case "models":
        return <SettingsModelsPanel state={state} />;
      case "sprint":
        return <SettingsSprintPanel state={state} />;
      case "browser":
        return <SettingsBrowserPanel state={state} />;
      case "agents":
        return <SettingsAgentsPanel state={state} />;
      case "memory":
        return <SettingsMemoryPanel state={state} />;
      case "integrations":
        return <SettingsIntegrationsPanel state={state} />;
      case "mcp":
        return <SettingsMcpPanel state={state} />;
      case "danger":
        return <SettingsDangerPanel state={state} />;
      default:
        return null;
    }
  };

  return (
    <div aria-busy={activeSaving || loading || resettingProject ? "true" : undefined} data-reset-busy={resettingProject ? "true" : undefined} data-settings-state={error ? "error" : resettingProject ? "resetting" : activeSaving ? "saving" : activeDirty ? "dirty" : "saved"}>
      <div role={error ? "alert" : "status"} aria-live={error ? "assertive" : "polite"} aria-atomic="true" className="sr-only">
        {panelStatus}
      </div>
      <div
        data-settings-sticky="active-panel"
        style={stickyStyle}
        className="sticky top-[var(--settings-active-panel-top)] z-20 mb-3 flex min-w-0 flex-wrap items-center gap-2 overflow-visible rounded-[1rem] border border-[color:var(--border-hairline)] bg-[var(--surface-glass)] px-3 py-2 text-xs font-semibold text-slate-500 shadow-[var(--elevation-base)] backdrop-blur-2xl dark:text-slate-300"
      >
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">Active panel</span>
        <span className="min-w-0 max-w-full break-words text-slate-800 dark:text-slate-100">{activeCategoryLabel}</span>
        <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">/</span>
        <span className={`min-w-0 max-w-full break-words ${error ? "text-status-red" : activeSaving || loading || resettingProject ? "text-signal-700 dark:text-signal-300" : activeDirty ? "text-amber-700 dark:text-amber-200" : "text-status-green"}`}>
          {visibleSaveState}
        </span>
      </div>
      <ActionFeedbackRegion
        status={error ? "error" : loading || activeSaving || resettingProject ? "pending" : saveMessage ? "success" : activeDirty ? "warning" : "idle"}
        message={error || (loading ? "Loading settings without clearing current values..." : resettingProject ? "Resetting project overrides. Current values remain visible." : activeSaving ? "Saving settings. Current values remain visible." : saveMessage || (activeDirty ? "You have unsaved changes in this settings scope." : null))}
        autoDismiss={false}
      />
      <div
        key={activeCategory}
        data-active-category={activeCategory}
        data-motion-contract="enterExit"
        className="mt-3 motion-safe:animate-form-slide-down motion-reduce:animate-none"
        style={{
          transitionDuration: tokens.enterExit.duration,
          transitionTimingFunction: tokens.enterExit.ease,
        }}
      >
        {renderPanel()}
      </div>
    </div>
  );
};
