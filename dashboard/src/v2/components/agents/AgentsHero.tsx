import type { FunctionComponent } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import gsap from "gsap";
import { Bot, Plus, RefreshCw, Sparkles } from "lucide-preact";
import { WaveFluid } from "../ui/WaveFluid.js";
import { BorderTrace } from "../ui/BorderTrace.js";

export const AgentsHero: FunctionComponent<{
  selectedProject: any;
  projectLoading?: boolean;
  loading?: boolean;
  presets?: any[];
  onCreate: () => void;
  onSyncAll: () => void;
  syncingAll: boolean;
}> = ({ selectedProject, presets, onCreate, onSyncAll, syncingAll }) => {
  const heroRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!heroRef.current) return;
    gsap.fromTo(
      Array.from(heroRef.current.querySelectorAll("[data-hero-anim]")),
      { opacity: 0, y: 28 },
      { opacity: 1, y: 0, duration: 0.9, stagger: 0.1, ease: "power4.out" }
    );
  }, []);

  const total = presets?.length ?? 0;

  return (
    <div
      ref={heroRef}
      className="group relative overflow-hidden rounded-[2rem] border border-white/[0.06] bg-gradient-to-br from-void-900 via-void-800 to-void-900 shadow-[0_8px_40px_rgba(0,0,0,0.4)]"
    >
      <WaveFluid accentHex="#00E0A0" />
      <BorderTrace accentHex="#00E0A0" />

      {/* Floating decorative orbs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="agent-orb absolute -right-12 -top-12 h-48 w-48 rounded-full bg-signal-500/10 blur-3xl" />
        <div className="agent-orb absolute -left-16 bottom-0 h-40 w-40 rounded-full bg-violet-500/8 blur-3xl" />
        <div className="agent-orb absolute right-1/3 top-1/2 h-24 w-24 rounded-full bg-ember-500/8 blur-2xl" />
      </div>

      <div className="relative z-10 px-8 py-12 md:px-14 md:py-16">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-col gap-5">
            <div className="flex items-center gap-4" data-hero-anim>
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-signal-500/15 text-signal-400 shadow-[0_0_24px_rgba(0,224,160,0.15)] backdrop-blur-md">
                <Bot className="h-7 w-7" strokeWidth={1.6} />
              </div>
              <div className="flex flex-col">
                <span className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-signal-400">
                  <Sparkles className="h-3 w-3" strokeWidth={2.5} />
                  Agent Workshop
                </span>
                <h1 className="font-display text-4xl font-black tracking-tight text-white md:text-5xl">
                  Your Agents
                </h1>
              </div>
            </div>
            <p className="max-w-xl text-base font-medium leading-relaxed text-slate-400 md:text-lg" data-hero-anim>
              Build, customize, and deploy your AI workforce. Each agent has its own
              personality, skills, and adorable robot avatar.
            </p>

            {/* Stats pills */}
            {total > 0 && (
              <div className="flex flex-wrap gap-3" data-hero-anim>
                <span className="inline-flex items-center gap-2 rounded-full border border-signal-500/20 bg-signal-500/10 px-4 py-2 text-xs font-bold text-signal-400">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-signal-500 font-mono text-[10px] text-void-900">
                    {total}
                  </span>
                  Total Agents
                </span>
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-3" data-hero-anim>
            <button
              type="button"
              onClick={onCreate}
              disabled={!selectedProject}
              className="group/btn inline-flex items-center gap-2.5 rounded-full bg-signal-500 px-7 py-3.5 text-sm font-bold text-void-900 shadow-[0_0_24px_rgba(0,224,160,0.3)] transition-all hover:scale-[1.04] hover:bg-signal-400 hover:shadow-[0_0_36px_rgba(0,224,160,0.5)] focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
            >
              <Plus className="h-5 w-5 transition-transform group-hover/btn:rotate-90" strokeWidth={2.5} />
              New Agent
            </button>
            <button
              type="button"
              onClick={onSyncAll}
              disabled={!selectedProject || syncingAll}
              className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.04] px-6 py-3.5 text-sm font-bold text-white backdrop-blur-sm transition-all hover:bg-white/[0.08] focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw className={`h-4.5 w-4.5 ${syncingAll ? "animate-spin" : ""}`} strokeWidth={2.5} />
              Sync All
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
