import type { FunctionComponent } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import gsap from "gsap";
import { ChevronRight } from "lucide-preact";
import type { AgentPreset } from "../../types.js";
import { AgentAvatarScene } from "./AgentAvatarScene.js";
import { getAccentHex } from "../../lib/agent-avatar.js";
import { WaveFluid } from "../ui/WaveFluid.js";

export const AgentPresetShowcaseCard: FunctionComponent<{
  preset: AgentPreset;
  isSelected: boolean;
  onClick: () => void;
}> = ({ preset, isSelected, onClick }) => {
  const cardRef = useRef<HTMLButtonElement>(null);
  const accentHex = getAccentHex(preset.avatarConfig?.accent);

  useLayoutEffect(() => {
    if (!cardRef.current) return;
    gsap.fromTo(
      cardRef.current,
      { opacity: 0, y: 20, scale: 0.97 },
      { opacity: 1, y: 0, scale: 1, duration: 0.6, ease: "power3.out" }
    );
  }, []);

  return (
    <button
      ref={cardRef}
      type="button"
      onClick={onClick}
      className={`group relative flex w-full overflow-hidden rounded-[1.75rem] border text-left transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2 ${
        isSelected
          ? "border-signal-500/60 bg-void-900 shadow-[0_8px_40px_rgba(0,224,160,0.12)]"
          : "border-white/[0.06] bg-void-800/50 hover:border-signal-500/30 hover:bg-void-800/80 hover:shadow-[0_4px_24px_rgba(0,0,0,0.3)]"
      }`}
    >
      {isSelected && <WaveFluid accentHex={accentHex} />}

      {/* Accent glow strip on left */}
      <div
        className={`absolute inset-y-0 left-0 w-1 transition-all duration-300 ${
          isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-60"
        }`}
        style={{ backgroundColor: accentHex, boxShadow: `0 0 12px ${accentHex}60` }}
      />

      <div className="relative z-10 flex w-full items-center gap-4 p-5">
        {/* Avatar thumbnail */}
        <div
          className={`relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl transition-shadow duration-300 ${
            isSelected
              ? "shadow-[0_0_20px_rgba(0,224,160,0.2)]"
              : "group-hover:shadow-[0_0_12px_rgba(0,224,160,0.1)]"
          }`}
          style={{
            background: `linear-gradient(135deg, ${accentHex}15, ${accentHex}08)`,
          }}
        >
          <div className="absolute inset-0">
            <AgentAvatarScene
              config={preset.avatarConfig}
              expression={isSelected ? "happy" : "bored"}
              className="h-full w-full"
            />
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <h3
            className={`font-display text-base font-bold tracking-tight transition-colors ${
              isSelected ? "text-white" : "text-slate-300 group-hover:text-white"
            }`}
          >
            {preset.name}
          </h3>
          {preset.labels.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {preset.labels.slice(0, 3).map((l) => (
                <span
                  key={l}
                  className="inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em]"
                  style={{
                    backgroundColor: `${accentHex}15`,
                    color: accentHex,
                  }}
                >
                  {l}
                </span>
              ))}
              {preset.labels.length > 3 && (
                <span className="inline-flex items-center rounded-full bg-white/5 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-500">
                  +{preset.labels.length - 3}
                </span>
              )}
            </div>
          )}
        </div>

        <ChevronRight
          className={`h-4.5 w-4.5 shrink-0 transition-all duration-300 ${
            isSelected
              ? "translate-x-1 text-signal-500"
              : "text-slate-600 group-hover:translate-x-1 group-hover:text-signal-400"
          }`}
          strokeWidth={2.5}
        />
      </div>
    </button>
  );
};
