import type { FunctionComponent } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import gsap from "gsap";
import { Bot, Plus, RefreshCw, Sparkles } from "lucide-preact";
import { WaveFluid } from "../ui/WaveFluid.js";
import { BorderTrace } from "../ui/BorderTrace.js";

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
      { opacity: 1, y: 0, duration: 0.8, stagger: 0.09, ease: "power4.out" }
    );
  }, []);

  const total = presets?.length ?? 0;

  return (
    <div
      ref={heroRef}
      className="group relative overflow-hidden rounded-[2rem] border border-black/[0.06] bg-white shadow-[0_4px_32px_rgba(0,0,0,0.05)] dark:border-white/[0.06] dark:bg-gradient-to-br dark:from-void-900 dark:via-void-800 dark:to-void-900 dark:shadow-[0_8px_40px_rgba(0,0,0,0.35)]"
    >
      <WaveFluid accentHex="#00E0A0" />
      <BorderTrace accentHex="#00E0A0" />

      {/* Decorative orbs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="agent-orb absolute -right-12 -top-12 h-44 w-44 rounded-full bg-signal-500/8 blur-3xl dark:bg-signal-500/10" />
        <div className="agent-orb absolute -left-16 bottom-0 h-36 w-36 rounded-full bg-violet-500/5 blur-3xl dark:bg-violet-500/8" />
        <div className="agent-orb absolute right-1/3 top-1/2 h-20 w-20 rounded-full bg-ember-500/5 blur-2xl dark:bg-ember-500/8" />
      </div>

      <div className="relative z-10 px-8 py-10 md:px-14 md:py-14">
        <div className="flex flex-col gap-7 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-4" data-hero-anim>
              <div className="flex h-13 w-13 items-center justify-center rounded-2xl bg-signal-500/10 text-signal-600 shadow-[0_0_20px_rgba(0,224,160,0.08)] backdrop-blur-md dark:bg-signal-500/15 dark:text-signal-400 dark:shadow-[0_0_24px_rgba(0,224,160,0.12)]">
                <Bot className="h-6 w-6" strokeWidth={1.6} />
              </div>
              <div className="flex flex-col">
                <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-signal-600 dark:text-signal-400">
                  <Sparkles className="h-3 w-3" strokeWidth={2.5} />
                  Agent Workshop
                </span>
                <h1 className="font-display text-3xl font-black tracking-tight text-slate-900 md:text-4xl dark:text-white">
                  Your Agents
                </h1>
              </div>
            </div>
            <p className="max-w-lg text-sm font-medium leading-relaxed text-slate-500 md:text-base dark:text-slate-400" data-hero-anim>
              Build, customize, and deploy your AI workforce. Each agent has
              unique skills, personality, and a custom robot avatar.
            </p>

            {total > 0 && (
              <div className="flex flex-wrap gap-2.5" data-hero-anim>
                <span className="inline-flex items-center gap-2 rounded-full border border-signal-500/15 bg-signal-500/6 px-3.5 py-1.5 text-[11px] font-bold text-signal-600 dark:border-signal-500/20 dark:bg-signal-500/10 dark:text-signal-400">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-signal-500 font-mono text-[10px] font-bold text-white dark:text-void-900">
                    {total}
                  </span>
                  Active Agent{total !== 1 ? "s" : ""}
                </span>
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-3" data-hero-anim>
            <button
              type="button"
              onClick={onCreate}
              disabled={!selectedProject}
              className="group/btn inline-flex items-center gap-2 rounded-full bg-signal-500 px-6 py-3 text-sm font-bold text-slate-900 shadow-lg shadow-signal-500/15 transition-all hover:scale-[1.03] hover:bg-signal-400 hover:shadow-signal-500/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100 dark:text-void-900 dark:shadow-signal-500/20"
            >
              <Plus className="h-4.5 w-4.5 transition-transform group-hover/btn:rotate-90" strokeWidth={2.5} />
              New Agent
            </button>
            <button
              type="button"
              onClick={onSyncAll}
              disabled={!selectedProject || syncingAll}
              className="inline-flex items-center gap-2 rounded-full border border-black/[0.08] bg-black/[0.03] px-5 py-3 text-sm font-bold text-slate-600 transition-all hover:bg-black/[0.06] focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-white dark:hover:bg-white/[0.08]"
            >
              <RefreshCw className={`h-4 w-4 ${syncingAll ? "animate-spin" : ""}`} strokeWidth={2.5} />
              Sync All
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
