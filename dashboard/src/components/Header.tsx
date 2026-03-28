import type { FunctionComponent } from "preact";

export type DashboardView = "dashboard" | "settings";

interface HeaderProps {
  sprintNumber?: number;
  featureBranch?: string;
  timestamp: string | null;
  view: DashboardView;
  onChangeView: (view: DashboardView) => void;
}

export const Header: FunctionComponent<HeaderProps> = ({ sprintNumber, featureBranch, timestamp, view, onChangeView }) => {
  return (
    <header className="border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-xl sticky top-0 z-20">
      <div className="max-w-7xl mx-auto px-6 py-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-white tracking-tight">Jules Sprint Dashboard v1.0</h1>
          <p className="text-xs text-slate-400 mt-1">
            {featureBranch ? `Branch: ${featureBranch}` : "Awaiting orchestration"}
          </p>
        </div>
        <div className="flex items-end gap-6">
          <nav aria-label="View Navigation" className="flex items-center rounded-lg border border-slate-700/60 bg-slate-900/50 p-1">
            <button
              type="button"
              onClick={() => onChangeView("dashboard")}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                view === "dashboard" ? "bg-slate-700 text-white" : "text-slate-400 hover:text-white hover:bg-slate-800"
              }`}
            >
              Dashboard
            </button>
            <button
              type="button"
              onClick={() => onChangeView("settings")}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                view === "settings" ? "bg-slate-700 text-white" : "text-slate-400 hover:text-white hover:bg-slate-800"
              }`}
            >
              Settings
            </button>
          </nav>
          <div className="text-right">
            <p className="text-xs text-slate-400 font-mono">Sprint {sprintNumber ?? "-"}</p>
            <p className="text-[11px] text-slate-500 font-mono">Updated {timestamp ?? "--:--:--"}</p>
          </div>
        </div>
      </div>
    </header>
  );
};
