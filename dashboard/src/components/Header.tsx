import type { FunctionComponent } from "preact";

interface HeaderProps {
  sprintNumber?: number;
  featureBranch?: string;
  timestamp: string | null;
}

export const Header: FunctionComponent<HeaderProps> = ({ sprintNumber, featureBranch, timestamp }) => {
  return (
    <header className="border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-xl sticky top-0 z-20">
      <div className="max-w-7xl mx-auto px-6 py-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-white tracking-tight">Jules Sprint Dashboard</h1>
          <p className="text-xs text-slate-400 mt-1">
            {featureBranch ? `Branch: ${featureBranch}` : "Awaiting orchestration"}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-400 font-mono">Sprint {sprintNumber ?? "-"}</p>
          <p className="text-[11px] text-slate-500 font-mono">Updated {timestamp ?? "--:--:--"}</p>
        </div>
      </div>
    </header>
  );
};
