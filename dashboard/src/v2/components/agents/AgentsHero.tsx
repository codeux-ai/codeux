import type { FunctionComponent } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import gsap from "gsap";
import { Bot, Plus, RefreshCw, Sparkles } from "lucide-preact";

import type { Source, AgentPreset } from "../../types.js";
import { PageHeader } from "../layout/PageHeader.js";

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

  const drift = total - synced;

  return (
    <div ref={heroRef} className="relative flex flex-col gap-5 overflow-hidden rounded-[2rem] border border-black/[0.06] bg-white/55 p-6 shadow-[0_2px_20px_rgba(0,0,0,0.04)] backdrop-blur-2xl md:p-7 dark:border-white/[0.06] dark:bg-void-800/50 dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
      <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/80 to-transparent dark:via-white/10" />
      <PageHeader
        data-hero-anim
        icon={Sparkles}
        eyebrow="Agent Workshop"
        title="Your Workforce"
        subtitle="Design, customize, and deploy AI specialists. Each agent ships with a distinct personality, an expressive avatar, and operator-grade system instructions."
        actions={
          <>
            <button
              type="button"
              onClick={onSyncAll}
              disabled={!selectedProject || syncingAll}
              aria-label={syncingAll ? "Syncing all agent presets from repository markdown" : "Sync all agent presets from repository markdown"}
              className="inline-flex items-center gap-2 rounded-full border border-black/[0.06] bg-white/70 px-5 py-2.5 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-600 backdrop-blur-md transition-all hover:bg-white hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-white/70 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-300 dark:hover:bg-white/[0.06] dark:hover:text-white disabled:dark:hover:bg-white/[0.03] disabled:dark:hover:text-slate-300"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${syncingAll ? "animate-spin" : ""}`} strokeWidth={2.3} />
              Sync All
            </button>
            <button
              type="button"
              onClick={onCreate}
              disabled={!selectedProject}
              aria-label="Create a new agent preset"
              className="group/btn inline-flex items-center gap-2 rounded-full bg-signal-500 px-5 py-2.5 text-[11px] font-bold uppercase tracking-[0.14em] text-void-900 shadow-[0_0_24px_rgba(0,224,160,0.28)] transition-all hover:scale-[1.03] hover:bg-signal-400 hover:shadow-[0_0_32px_rgba(0,224,160,0.36)] focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
            >
              <Plus className="h-3.5 w-3.5 transition-transform group-hover/btn:rotate-90" strokeWidth={2.5} />
              New Agent
            </button>
          </>
        }
      />

      {total > 0 && (
        <div className="flex flex-wrap items-center gap-2" data-hero-anim>
          <span className="inline-flex items-center gap-2 rounded-full border border-signal-500/30 bg-signal-500/10 px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-signal-600 shadow-sm dark:border-signal-500/25 dark:bg-signal-500/15 dark:text-signal-400">
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-signal-500 font-mono text-[9px] font-black text-white dark:text-void-900">
              {total}
            </span>
            Active
          </span>
          {synced > 0 && (
            <span className="inline-flex items-center gap-2 rounded-full border border-black/[0.08] bg-white/80 px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 shadow-sm backdrop-blur-md dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-slate-400">
              <span className="h-1.5 w-1.5 rounded-full bg-signal-500 shadow-[0_0_8px_rgba(0,224,160,0.6)]" />
              {synced} synced
            </span>
          )}
          {drift > 0 && (
            <span className="inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-400/10 px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-amber-600 shadow-sm backdrop-blur-md dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-400">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              {drift} need sync
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
  );
};
