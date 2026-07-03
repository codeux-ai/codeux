import type { FunctionComponent } from "preact";
import { Play, Loader2 } from "lucide-preact";
import type { Sprint } from "../../types.js";

interface LaunchContainerPanelProps {
  sprints: Sprint[];
  launchSprintId: string;
  onLaunchSprintChange: (sprintId: string) => void;
  onLaunchContainer: () => void;
  launchEnabled: boolean;
  launchBusy: boolean;
}

export const LaunchContainerPanel: FunctionComponent<LaunchContainerPanelProps> = ({
  sprints,
  launchSprintId,
  onLaunchSprintChange,
  onLaunchContainer,
  launchEnabled,
  launchBusy,
}) => {
  const disabledReason = launchBusy
    ? "A preview is already launching."
    : !launchEnabled
      ? "Select a project with Browser Preview enabled to start a container."
      : sprints.length === 0
        ? "No sprint is available to launch."
        : null;

  return (
    <div className="rounded-[1.75rem] border border-black/[0.06] bg-white/72 p-5 shadow-[0_18px_48px_rgba(15,23,42,0.06)] backdrop-blur-xl dark:border-white/[0.06] dark:bg-void-900/45 dark:shadow-[0_20px_60px_rgba(0,0,0,0.24)]" role="region" aria-labelledby="launch-container-title">
      <div id="launch-container-title" className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
        Launch Container
      </div>
      <div className="mt-4 space-y-3">
        <div id="launch-container-status" role="status" aria-live="polite" className="min-h-4 text-xs text-slate-500 mb-2">
          {disabledReason}
        </div>
        <label htmlFor="launch-container-sprint" className="sr-only">Sprint to preview</label>
        <select
          id="launch-container-sprint"
          value={launchSprintId}
          onChange={(event) => onLaunchSprintChange((event.currentTarget as HTMLSelectElement).value)}
          disabled={!launchEnabled || launchBusy || sprints.length === 0}
          aria-disabled={!launchEnabled || launchBusy || sprints.length === 0}
          aria-describedby={disabledReason ? "launch-container-status" : undefined}
          className={`w-full rounded-2xl border border-black/[0.08] bg-white/85 px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-signal-500/40 dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-slate-200 ${
            (!launchEnabled || launchBusy || sprints.length === 0) ? "cursor-not-allowed opacity-50" : ""
          }`}
        >
          {sprints.length === 0 && <option value="">No sprints available</option>}
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
          disabled={!launchEnabled || launchBusy || sprints.length === 0 || !launchSprintId}
          aria-disabled={!launchEnabled || launchBusy || sprints.length === 0 || !launchSprintId}
          aria-busy={launchBusy}
          aria-describedby={disabledReason ? "launch-container-status" : undefined}
          aria-label={launchBusy ? "Launching preview container" : "Launch preview container"}
          className={`inline-flex h-10 w-full items-center justify-center gap-2 rounded-2xl px-4 text-sm font-semibold text-void-900 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 ${
            (!launchEnabled || launchBusy || sprints.length === 0 || !launchSprintId)
              ? "bg-signal-500 cursor-not-allowed opacity-50"
              : "bg-signal-500 hover:bg-signal-400"
          }`}
        >
          {launchBusy ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />
          ) : (
            <Play className="h-4 w-4" strokeWidth={2.2} />
          )}
          {launchBusy ? "Launching..." : !launchEnabled ? "Disabled: No Project" : sprints.length === 0 ? "Disabled: No Sprint" : "Launch Container"}
        </button>
      </div>
    </div>
  );
};
