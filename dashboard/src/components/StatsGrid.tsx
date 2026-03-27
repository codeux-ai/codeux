import type { FunctionComponent } from "preact";
import type { DashboardStats } from "../types.js";

interface StatsGridProps {
  stats: DashboardStats;
}

const Tile: FunctionComponent<{ label: string; value: number; tone: string }> = ({ label, value, tone }) => (
  <div className="bg-slate-900/50 backdrop-blur-md border border-slate-800 rounded-xl p-4">
    <p className="text-[10px] tracking-[0.2em] uppercase text-slate-500 mb-2">{label}</p>
    <p className={`text-2xl font-bold ${tone}`}>{value}</p>
  </div>
);

export const StatsGrid: FunctionComponent<StatsGridProps> = ({ stats }) => (
  <section className="grid grid-cols-2 lg:grid-cols-5 xl:grid-cols-9 gap-4 mb-8">
    <Tile label="Total" value={stats.total} tone="text-white" />
    <Tile label="Running" value={stats.running} tone="text-sky-400" />
    <Tile label="Completed" value={stats.completed} tone="text-emerald-400" />
    <Tile label="Failed" value={stats.failed} tone="text-red-400" />
    <Tile label="CI" value={stats.ci} tone="text-cyan-300" />
    <Tile label="Automerge" value={stats.automerge} tone="text-lime-300" />
    <Tile label="Merged" value={stats.merged} tone="text-emerald-300" />
    <Tile label="Merge Blocked" value={stats.mergeBlocked} tone="text-amber-300" />
    <Tile label="Conflicts" value={stats.mergeConflicts} tone="text-red-300" />
  </section>
);
