import type { FunctionComponent } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import gsap from "gsap";
import { Bot, Plus, RefreshCw, Sparkles } from "lucide-preact";

import type { Source, AgentPreset } from "../../types.js";

export const AgentsHero: FunctionComponent<{
  selectedProject: Source | null;
  projectLoading?: boolean;
  loading?: boolean;
  presets?: AgentPreset[];
  onCreate: () => void;
  onSyncAll: () => void;
  syncingAll: boolean;
}> = ({ selectedProject, presets, onCreate, onSyncAll, syncingAll }) => {
  const heroRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!heroRef.current) return;
    gsap.fromTo(
      Array.from(heroRef.current.querySelectorAll("[data-hero-anim]")),
      { opacity: 0, y: 24 },
      { opacity: 1, y: 0, duration: 0.85, stagger: 0.09, ease: "power4.out" }
    );
  }, []);

  const total = presets?.length ?? 0;
  const synced = (presets ?? []).filter((p) => p.syncStatus === "synced").length;

  return (
    <div
      ref={heroRef}
      className="relative flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between"
    >
      <div className="space-y-5">
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-signal-500" data-hero-anim>
          <Sparkles className="h-3.5 w-3.5" strokeWidth={2.2} />
          Agent Workshop
        </div>
        <div className="relative overflow-hidden" data-hero-anim>
          <div className="pointer-events-none absolute -left-2 -top-8 font-display text-[6rem] font-black leading-none tracking-tighter text-black/[0.04] dark:text-white/[0.03] md:text-[8rem]">
            AGENTS
          </div>
          <h1 className="relative z-10 font-display text-5xl font-black tracking-tighter text-slate-900 dark:text-white md:text-7xl">
            Your <span className="text-signal-500">Workforce.</span>
          </h1>
        </div>
        <p className="max-w-2xl text-base leading-relaxed text-slate-500 md:text-lg dark:text-slate-400" data-hero-anim>
          Design, customize, and deploy AI specialists. Each agent ships with a
          distinct personality, an expressive avatar, and operator-grade system
          instructions.
        </p>

        {total > 0 && (
          <div className="flex flex-wrap items-center gap-2" data-hero-anim>
            <span className="inline-flex items-center gap-2 rounded-full border border-signal-500/20 bg-signal-500/8 px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-signal-600 dark:bg-signal-500/10 dark:text-signal-400">
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-signal-500 font-mono text-[9px] font-black text-white dark:text-void-900">
                {total}
              </span>
              Active
            </span>
            {synced > 0 && (
              <span className="inline-flex items-center gap-2 rounded-full border border-black/[0.06] bg-white/70 px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 backdrop-blur-md dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-400">
                <span className="h-1.5 w-1.5 rounded-full bg-signal-500 shadow-[0_0_8px_rgba(0,224,160,0.6)]" />
                {synced} synced
              </span>
            )}
            {selectedProject && (
              <span className="inline-flex items-center gap-2 rounded-full border border-black/[0.06] bg-white/70 px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 backdrop-blur-md dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-400">
                <Bot className="h-3 w-3" strokeWidth={2.4} />
                <span className="max-w-[10rem] truncate">{selectedProject.name}</span>
              </span>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3" data-hero-anim>
        <button
          type="button"
          onClick={onSyncAll}
          disabled={!selectedProject || syncingAll}
          className="inline-flex items-center gap-2 rounded-full border border-black/[0.06] bg-white/70 px-5 py-2.5 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-600 backdrop-blur-md transition-all hover:bg-white hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-300 dark:hover:bg-white/[0.06] dark:hover:text-white"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${syncingAll ? "animate-spin" : ""}`} strokeWidth={2.3} />
          Sync All
        </button>
        <button
          type="button"
          onClick={onCreate}
          disabled={!selectedProject}
          className="group/btn inline-flex items-center gap-2 rounded-full bg-signal-500 px-5 py-2.5 text-[11px] font-bold uppercase tracking-[0.14em] text-void-900 shadow-[0_0_24px_rgba(0,224,160,0.28)] transition-all hover:scale-[1.03] hover:bg-signal-400 hover:shadow-[0_0_32px_rgba(0,224,160,0.36)] focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
        >
          <Plus className="h-3.5 w-3.5 transition-transform group-hover/btn:rotate-90" strokeWidth={2.5} />
          New Agent
        </button>
      </div>
    </div>
  );
};
