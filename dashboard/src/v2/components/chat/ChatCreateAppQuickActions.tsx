import type { FunctionComponent } from "preact";
import { Globe2, Monitor } from "lucide-preact";
import type { DashboardCreateAppQuickactionKind } from "../../types.js";

const CREATE_APP_ACTIONS: Array<{
  kind: DashboardCreateAppQuickactionKind;
  label: string;
  description: string;
  icon: typeof Monitor;
}> = [
  {
    kind: "desktop_app",
    label: "Create Desktop App",
    description: "Launch a desktop app sprint",
    icon: Monitor,
  },
  {
    kind: "web_app",
    label: "Create Web App",
    description: "Launch a web app sprint",
    icon: Globe2,
  },
];

export const ChatCreateAppQuickActions: FunctionComponent<{
  disabled?: boolean;
  sending?: boolean;
  hasProject: boolean;
  onSelect: (kind: DashboardCreateAppQuickactionKind) => void;
}> = ({ disabled = false, sending = false, hasProject, onSelect }) => {
  const isDisabled = disabled || sending || !hasProject;
  const status = !hasProject
    ? "Create app quick actions are unavailable until a project is selected."
    : sending
      ? "Create app quick actions are disabled while a message is sending."
      : "Create app quick actions are available.";

  return (
    <div className="min-w-0" aria-label="Create app quick actions">
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
        {CREATE_APP_ACTIONS.map(({ kind, label, description, icon: Icon }) => (
          <button
            key={kind}
            type="button"
            onClick={() => onSelect(kind)}
            disabled={isDisabled}
            aria-disabled={isDisabled}
            aria-label={label}
            aria-describedby={`create-app-quickaction-${kind}-description create-app-quickaction-status`}
            className={`group inline-flex min-h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-2xl border px-3 py-2 text-[11px] font-bold uppercase tracking-[0.12em] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/40 ${
              isDisabled
                ? "cursor-not-allowed border-black/[0.06] bg-black/[0.035] text-slate-400 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-500"
                : "border-signal-500/25 bg-signal-500/10 text-signal-700 hover:border-signal-500/45 hover:bg-signal-500/15 hover:text-signal-800 active:scale-[0.98] dark:text-signal-300 dark:hover:text-signal-200"
            }`}
          >
            <Icon className="h-4 w-4 shrink-0" strokeWidth={2.2} aria-hidden="true" />
            <span className="min-w-0 truncate">{label}</span>
            <span id={`create-app-quickaction-${kind}-description`} className="sr-only">
              {description}
            </span>
          </button>
        ))}
      </div>
      <div id="create-app-quickaction-status" role="status" aria-live="polite" className="sr-only">
        {status}
      </div>
    </div>
  );
};
