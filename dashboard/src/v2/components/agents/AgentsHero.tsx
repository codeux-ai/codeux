import type { FunctionComponent } from "preact";
import { Bot, Plus, RefreshCw } from "lucide-preact";
import { WaveFluid } from "../ui/WaveFluid.js";

export const AgentsHero: FunctionComponent<{
  selectedProject: any;
  projectLoading?: boolean;
  loading?: boolean;
  presets?: any[];
  onCreate: () => void;
  onSyncAll: () => void;
  syncingAll: boolean;
}> = ({ selectedProject, onCreate, onSyncAll, syncingAll }) => (
  <div className="relative mb-8 overflow-hidden rounded-[2rem] bg-slate-900 px-8 py-12 text-white shadow-2xl md:px-12 md:py-16">
    <WaveFluid accentHex="#00E0A0" />
    <div className="relative z-10 mx-auto flex max-w-4xl flex-col items-start gap-6 text-left">
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-signal-500/20 text-signal-400 backdrop-blur-md">
          <Bot className="h-6 w-6" strokeWidth={1.8} />
        </div>
        <div className="flex flex-col">
          <span className="text-xs font-bold uppercase tracking-[0.14em] text-signal-400">Role</span>
          <h1 className="font-display text-3xl font-black tracking-tight text-white md:text-4xl">
            Project Agents
          </h1>
        </div>
      </div>
      <p className="max-w-2xl text-lg font-medium leading-relaxed text-slate-300 md:text-xl">
        Manage the AI agents available to this project. Each agent brings unique
        system instructions and memory configurations.
      </p>
      <div className="mt-4 flex flex-col md:flex-row flex-wrap items-stretch md:items-center gap-4">
        <button
          type="button"
          onClick={onCreate}
          disabled={!selectedProject}
          className="group inline-flex justify-center md:justify-start items-center gap-2 rounded-full bg-signal-500 px-6 py-3 font-bold text-slate-900 shadow-[0_0_20px_rgba(0,224,160,0.3)] transition-all hover:scale-105 hover:bg-signal-400 hover:shadow-[0_0_30px_rgba(0,224,160,0.5)] focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
        >
          <Plus className="h-5 w-5 transition-transform group-hover:rotate-90" strokeWidth={2.5} />
          <span>New Agent</span>
        </button>
        <button
          type="button"
          onClick={onSyncAll}
          disabled={!selectedProject || syncingAll}
          className="inline-flex justify-center md:justify-start items-center gap-2 rounded-full border border-white/10 bg-white/5 px-6 py-3 font-bold text-white backdrop-blur-sm transition-all hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw
            className={`h-5 w-5 ${syncingAll ? "animate-spin" : ""}`}
            strokeWidth={2.5}
          />
          <span>Sync All</span>
        </button>
      </div>
    </div>
  </div>
);