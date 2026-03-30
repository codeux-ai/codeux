import type { FunctionComponent } from "preact";
import { ChevronRight } from "lucide-preact";
import type { AgentPreset } from "../../types.js";
import { AgentAvatarScene } from "./AgentAvatarScene.js";

export const AgentPresetShowcaseCard: FunctionComponent<{
  preset: AgentPreset;
  isSelected: boolean;
  onClick: () => void;
}> = ({ preset, isSelected, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={`group relative flex w-full flex-col overflow-hidden rounded-[1.5rem] border p-6 text-left transition-all hover:shadow-xl focus:outline-none focus:ring-4 ${
      isSelected
        ? "border-signal-500 bg-white shadow-[0_8px_30px_rgba(0,224,160,0.15)] ring-signal-500/20 dark:border-signal-500 dark:bg-void-900"
        : "border-black/[0.08] bg-white/60 hover:border-signal-500/50 hover:bg-white dark:border-white/[0.08] dark:bg-white/[0.02] dark:hover:border-signal-500/50 dark:hover:bg-void-800"
    }`}
  >
    <div className="relative z-10 flex items-start gap-4">
      <div
        className={`relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-[1rem] ${
          isSelected ? "bg-signal-500/10" : "bg-slate-100 dark:bg-void-800"
        }`}
      >
        <div className="absolute inset-0">
          <AgentAvatarScene
            config={preset.avatarConfig}
            expression="happy"
            className="h-full w-full object-cover"
          />
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h3
          className={`font-display text-lg font-bold tracking-tight ${
            isSelected ? "text-slate-900 dark:text-white" : "text-slate-700 dark:text-slate-300"
          }`}
        >
          {preset.name}
        </h3>
        {preset.labels.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {preset.labels.slice(0, 3).map((l) => (
              <span
                key={l}
                className="inline-flex items-center rounded-md bg-black/5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:bg-white/10 dark:text-slate-400"
              >
                {l}
              </span>
            ))}
            {preset.labels.length > 3 && (
              <span className="inline-flex items-center rounded-md bg-black/5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:bg-white/10 dark:text-slate-400">
                +{preset.labels.length - 3}
              </span>
            )}
          </div>
        )}
      </div>
      <ChevronRight
        className={`h-5 w-5 shrink-0 transition-transform ${
          isSelected
            ? "translate-x-1 text-signal-500"
            : "text-slate-400 group-hover:translate-x-1 group-hover:text-signal-400"
        }`}
        strokeWidth={2}
      />
    </div>
  </button>
);