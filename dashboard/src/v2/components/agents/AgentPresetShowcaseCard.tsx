import type { FunctionComponent } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import gsap from "gsap";
import { ChevronRight, AlertTriangle } from "lucide-preact";
import type { AgentPreset } from "../../types.js";
import { AgentAvatarSvg } from "./AgentAvatarSvg.js";
import { getAccentHex } from "../../lib/agent-avatar.js";

const syncBadge = (preset: AgentPreset) => {
  switch (preset.syncStatus) {
    case "out_of_sync":
      return { cls: "border-amber-400/30 bg-amber-400/15 text-amber-600 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-400", label: "Out of Sync", icon: true };
    case "missing_source":
      return { cls: "border-status-red/20 bg-status-red/8 text-status-red", label: "Missing", icon: true };
    case "synced":
      return { cls: "border-signal-500/20 bg-signal-500/8 text-signal-600 dark:text-signal-400", label: "Synced", icon: false };
    default:
      return { cls: "border-black/[0.06] bg-black/[0.03] text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-400", label: "Local", icon: false };
  }
};

export const AgentPresetShowcaseCard: FunctionComponent<{
  preset: AgentPreset;
  routeTags: string[];
  isSelected: boolean;
  onClick: () => void;
}> = ({ preset, routeTags, isSelected, onClick }) => {
  const cardRef = useRef<HTMLButtonElement>(null);
  const accentHex = getAccentHex(preset.avatarConfig?.accent);
  const badge = syncBadge(preset);

  useLayoutEffect(() => {
    if (!cardRef.current) return;
    gsap.fromTo(
      cardRef.current,
      { opacity: 0, y: 16, scale: 0.98 },
      { opacity: 1, y: 0, scale: 1, duration: 0.55, ease: "power3.out" }
    );
  }, []);

  return (
    <button
      ref={cardRef}
      type="button"
      onClick={onClick}
      className={`group relative flex w-full overflow-hidden rounded-[1.4rem] border text-left backdrop-blur-xl transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2 ${
        isSelected
          ? "border-signal-500/40 bg-white/85 shadow-[0_8px_32px_rgba(0,224,160,0.12)] dark:border-signal-500/40 dark:bg-void-800/75 dark:shadow-[0_8px_32px_rgba(0,224,160,0.10)]"
          : "border-black/[0.06] bg-white/55 hover:-translate-y-0.5 hover:border-signal-500/30 hover:bg-white/80 hover:shadow-[0_8px_24px_rgba(0,224,160,0.06)] dark:border-white/[0.06] dark:bg-void-800/40 dark:hover:border-signal-500/30 dark:hover:bg-void-800/60 dark:hover:shadow-[0_8px_24px_rgba(0,0,0,0.25)]"
      }`}
    >
      {/* Left accent strip */}
      <div
        className={`absolute inset-y-0 left-0 w-[3px] rounded-l-full transition-opacity duration-300 ${isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-50"}`}
        style={{ backgroundColor: accentHex }}
      />

      <div className="relative z-10 flex w-full items-center gap-4 px-5 py-4">
        {/* SVG Avatar thumbnail — no WebGL */}
        <div
          className={`relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl transition-shadow duration-300 ${
            isSelected ? "shadow-[0_0_16px_rgba(0,224,160,0.12)]" : ""
          }`}
          style={{ background: `linear-gradient(135deg, ${accentHex}12, ${accentHex}06)` }}
        >
          <AgentAvatarSvg
            config={preset.avatarConfig}
            expression={isSelected ? "happy" : "bored"}
            className="h-full w-full"
          />
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <h3
            className={`font-display text-[15px] font-bold tracking-tight transition-colors ${
              isSelected
                ? "text-slate-900 dark:text-white"
                : "text-slate-700 dark:text-slate-300 group-hover:text-slate-900 dark:group-hover:text-white"
            }`}
          >
            {preset.name}
          </h3>
          <div className="flex flex-wrap items-center gap-1.5">
            {routeTags.slice(0, 2).map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em]"
                style={{ backgroundColor: `${accentHex}10`, color: accentHex }}
              >
                {tag}
              </span>
            ))}
            {routeTags.length > 2 && (
              <span className="text-[9px] font-bold text-slate-400">+{routeTags.length - 2}</span>
            )}
            <span className={`ml-auto inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.1em] ${badge.cls}`}>
              {badge.icon && <AlertTriangle className="h-2.5 w-2.5" strokeWidth={2.5} />}
              {badge.label}
            </span>
          </div>
        </div>

        <ChevronRight
          className={`h-4 w-4 shrink-0 transition-all duration-300 ${
            isSelected ? "translate-x-0.5 text-signal-500" : "text-slate-300 group-hover:translate-x-0.5 group-hover:text-signal-400 dark:text-slate-600"
          }`}
          strokeWidth={2.5}
        />
      </div>
    </button>
  );
};
