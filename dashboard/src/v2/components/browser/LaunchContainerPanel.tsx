import type { FunctionComponent } from "preact";
import { Play, Loader2 } from "lucide-preact";
import type { Sprint } from "../../types.js";
import { buildInteractionTransition } from "../../lib/motion/tokens.js";
import { useDashboardI18n } from "../../i18n/index.js";
import {
  browserPreviewMessages,
  type BrowserPreviewMessageKey,
  type BrowserPreviewMessageVariables,
} from "../../i18n/messages/browser-preview.js";

interface LaunchContainerPanelProps {
  sprints: Sprint[];
  launchSprintId: string;
  onLaunchSprintChange: (sprintId: string) => void;
  onLaunchContainer: () => void;
  launchEnabled: boolean;
  launchBusy: boolean;
}

const controlTransition = buildInteractionTransition("controlFeedback");

export const LaunchContainerPanel: FunctionComponent<LaunchContainerPanelProps> = ({
  sprints,
  launchSprintId,
  onLaunchSprintChange,
  onLaunchContainer,
  launchEnabled,
  launchBusy,
}) => {
  const { translate } = useDashboardI18n();
  const t = (key: BrowserPreviewMessageKey, variables?: BrowserPreviewMessageVariables) => (
    translate(browserPreviewMessages, key, variables)
  );
  const selectedSprintName = sprints.find((sprint) => sprint.id === launchSprintId)?.name || null;
  const sprintSuffix = selectedSprintName ? t("launchForSprintSuffix", { name: selectedSprintName }) : "";
  const disabledReason = launchBusy
    ? t("launchAlreadyPending", { suffix: sprintSuffix })
    : sprints.length === 0
      ? t("noSprintLaunchReason")
      : !launchEnabled
        ? t("noProjectLaunchReason")
        : !launchSprintId
          ? t("selectSprintLaunchReason")
          : null;
  const selectUnavailable = !launchEnabled || launchBusy || sprints.length === 0;
  const launchUnavailable = selectUnavailable || !launchSprintId;
  const statusMessage = launchBusy
    ? t("launchPendingStatus", { suffix: sprintSuffix })
    : disabledReason || t("launchReadyStatus");

  return (
    <div
      className="rounded-[1.75rem] border border-[color:var(--border-hairline)] bg-[var(--surface-glass)] p-5 shadow-[var(--elevation-base)] backdrop-blur-xl"
      role="region"
      aria-labelledby="launch-container-title"
      aria-busy={launchBusy}
    >
      <div className="flex items-center justify-between gap-3">
        <div id="launch-container-title" className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
          {t("launchContainer")}
        </div>
        <div className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] ${
          launchBusy
            ? "border-ember-500/30 bg-ember-500/10 text-ember-600 dark:text-ember-400"
            : launchUnavailable
              ? "border-slate-400/25 bg-slate-500/10 text-slate-600 dark:border-slate-500/40 dark:bg-slate-500/15 dark:text-slate-300"
              : "border-signal-500/30 bg-signal-500/10 text-signal-600 dark:text-signal-400"
        }`}>
          {launchBusy ? t("launchStatus") : launchUnavailable ? t("unavailableStatus") : t("readyStatus")}
        </div>
      </div>
      <div className="mt-4 space-y-3">
        <div id="launch-container-status" role="status" aria-live="polite" aria-atomic="true" className="min-h-4 text-xs text-slate-500 mb-2">
          {statusMessage}
        </div>
        <label htmlFor="launch-container-sprint" className="sr-only">{t("sprintToPreview")}</label>
        <select
          id="launch-container-sprint"
          value={launchSprintId}
          onChange={(event) => onLaunchSprintChange((event.currentTarget as HTMLSelectElement).value)}
          disabled={selectUnavailable}
          aria-disabled={selectUnavailable}
          aria-busy={launchBusy}
          aria-describedby="launch-container-status"
          title={selectUnavailable ? statusMessage : t("chooseSprintToPreview")}
          className={`w-full rounded-2xl border border-black/[0.08] bg-white/85 px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-signal-500/40 dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-slate-200 ${
            selectUnavailable ? "cursor-not-allowed opacity-50" : ""
          }`}
          style={{ transition: controlTransition }}
        >
          {sprints.length === 0 && <option value="">{t("noSprintsAvailable")}</option>}
          {sprints.map((sprint) => (
            <option key={sprint.id} value={sprint.id}>
              {sprint.name}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => {
            if (launchEnabled && !launchBusy && sprints.length > 0 && launchSprintId) {
              onLaunchContainer();
            }
          }}
          disabled={launchUnavailable}
          aria-disabled={launchUnavailable}
          aria-busy={launchBusy}
          aria-describedby="launch-container-status"
          aria-label={launchBusy ? t("launchingPreviewContainer") : t("launchContainerLower")}
          title={launchUnavailable ? statusMessage : t("launchContainerForSprint")}
          className={`inline-flex h-10 w-full items-center justify-center gap-2 rounded-2xl px-4 text-sm font-semibold text-void-900 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 ${
            launchUnavailable
              ? "bg-signal-500 cursor-not-allowed opacity-50"
              : "bg-signal-500 hover:bg-signal-400"
          }`}
          style={{ transition: controlTransition }}
        >
          {launchBusy ? (
            <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" strokeWidth={2.5} />
          ) : (
            <Play aria-hidden="true" className="h-4 w-4" strokeWidth={2.2} />
          )}
          {launchBusy
            ? t("launchingEllipsis")
            : sprints.length === 0
              ? t("disabledNoSprint")
              : !launchEnabled
                ? t("disabledNoProject")
                : !launchSprintId
                  ? t("disabledSelectSprint")
                  : t("launchContainer")}
        </button>
      </div>
    </div>
  );
};
