import { h } from "preact";
import { useState } from "preact/hooks";
import {
  RefreshCw, Smile, Frown, Angry, Meh, Zap,
} from "lucide-preact";
import type { AgentAvatarConfig } from "../../types.js";
import type { AgentAvatarExpression } from "../../lib/agent-avatar.js";
import { LazyAgentAvatarScene } from "./LazyAgentAvatarScene.js";
import {
  ROBOT_CHASSIS_OPTIONS,
  ROBOT_EYE_OPTIONS,
  ROBOT_ANTENNA_OPTIONS,
  ROBOT_WING_OPTIONS,
  ROBOT_ACCENT_OPTIONS,
  ROBOT_BASE_COLOR_OPTIONS,
  SHOWCASE_EXPRESSIONS,
  generateRandomAgentAvatar,
} from "../../lib/agent-avatar.js";

interface AgentAvatarCustomizerProps {
  config: AgentAvatarConfig;
  onChange: (config: AgentAvatarConfig) => void;
  expression?: AgentAvatarExpression;
  fallbackMode?: boolean;
  className?: string;
  disabled?: boolean;
}

/* ── Expression icon + label map ── */
const EXPR_META: Record<string, { Icon: typeof Smile; label: string }> = {
  happy: { Icon: Smile, label: "Happy" },
  sad: { Icon: Frown, label: "Sad" },
  angry: { Icon: Angry, label: "Angry" },
  bored: { Icon: Meh, label: "Bored" },
  hyped: { Icon: Zap, label: "Hyped" },
};

/* ── Reusable tile picker ── */
function PartPicker<T extends { id: string; label: string }>({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  options: readonly T[];
  value: string | undefined;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
        {label}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const selected = value === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              disabled={disabled}
              onClick={() => onChange(opt.id)}
              className={`rounded-xl px-3 py-2 text-[11px] font-bold backdrop-blur-md transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 disabled:opacity-50 disabled:cursor-not-allowed ${
                selected
                  ? "bg-signal-500 text-void-900 shadow-[0_0_14px_rgba(0,224,160,0.25)]"
                  : "border border-black/[0.05] bg-white/40 text-slate-500 hover:border-signal-500/30 hover:bg-signal-500/8 hover:text-signal-600 dark:border-white/[0.07] dark:bg-white/[0.03] dark:text-slate-300 dark:hover:border-signal-500/30 dark:hover:text-signal-400"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── Color swatch picker ── */
function ColorSwatchPicker({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  options: readonly { id: string; label: string; hex: string }[];
  value: string | undefined;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
        {label}
      </span>
      <div className="flex flex-wrap gap-2.5">
        {options.map((opt) => {
          const selected = value === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              disabled={disabled}
              onClick={() => onChange(opt.id)}
              title={opt.label}
              className={`group relative h-9 w-9 rounded-full shadow-sm transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 disabled:opacity-50 disabled:cursor-not-allowed ${
                selected
                  ? "scale-110 ring-2 ring-signal-500/60 ring-offset-2 ring-offset-white dark:ring-offset-void-800"
                  : "hover:scale-110 ring-1 ring-black/[0.08] dark:ring-white/[0.08]"
              }`}
              style={{ backgroundColor: opt.hex }}
            >
              {selected && (
                <span className="absolute inset-0 flex items-center justify-center text-[9px] font-black text-white drop-shadow-sm">
                  &#10003;
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function AgentAvatarCustomizer({
  config,
  onChange,
  expression: externalExpression,
  fallbackMode = false,
  className = "",
  disabled = false,
}: AgentAvatarCustomizerProps) {
  const [previewExpression, setPreviewExpression] = useState<AgentAvatarExpression>(
    externalExpression ?? "happy"
  );

  const handleRandomize = () => {
    const seed = Date.now().toString(36) + Math.random().toString(36).substring(2);
    onChange(generateRandomAgentAvatar(seed));
  };

  const handleField = (field: keyof AgentAvatarConfig, value: string) => {
    onChange({ ...config, [field]: value });
  };

  const activeExpression = externalExpression ?? previewExpression;

  return (
    <div className={`flex flex-col gap-5 ${className}`}>
      {/* ── Preview stage ── */}
      <div className="relative overflow-hidden rounded-[1.6rem] border border-black/[0.05] bg-white/40 shadow-[0_2px_16px_rgba(0,0,0,0.04)] backdrop-blur-xl dark:border-white/[0.05] dark:bg-white/[0.025] dark:shadow-[0_4px_24px_rgba(0,0,0,0.25)]">
        <div className="h-[300px] w-full">
          <LazyAgentAvatarScene
            config={config}
            expression={activeExpression}
            fallbackMode={fallbackMode}
          />
        </div>

        {/* Randomize button */}
        <button
          onClick={handleRandomize}
          disabled={disabled}
          type="button"
          className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full border border-black/[0.06] bg-white/70 text-slate-500 shadow-sm backdrop-blur-md transition-all hover:bg-signal-500 hover:text-void-900 hover:shadow-[0_0_16px_rgba(0,224,160,0.3)] dark:border-white/[0.08] dark:bg-white/[0.08] dark:text-slate-300 dark:hover:bg-signal-500 dark:hover:text-void-900 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30"
          title="Randomize"
        >
          <RefreshCw size={14} strokeWidth={2.5} />
        </button>

        {/* Expression bar */}
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1.5 bg-gradient-to-t from-white/85 via-white/40 to-transparent px-4 py-3 dark:from-void-800/85 dark:via-void-800/40">
          {SHOWCASE_EXPRESSIONS.map((expr) => {
            const meta = EXPR_META[expr];
            const isActive = activeExpression === expr;
            return (
              <button
                key={expr}
                type="button"
                onClick={() => setPreviewExpression(expr)}
                title={meta.label}
                className={`flex flex-col items-center gap-0.5 rounded-xl px-2.5 py-1.5 backdrop-blur-md transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 ${
                  isActive
                    ? "bg-signal-500/15 shadow-[0_0_10px_rgba(0,224,160,0.15)] dark:bg-signal-500/20"
                    : "hover:bg-white/60 dark:hover:bg-white/[0.06]"
                }`}
              >
                <meta.Icon
                  className={`h-3.5 w-3.5 ${isActive ? "text-signal-600 dark:text-signal-400" : "text-slate-400 dark:text-slate-500"}`}
                  strokeWidth={2}
                />
                <span className={`text-[7px] font-bold uppercase tracking-[0.12em] ${isActive ? "text-signal-600 dark:text-signal-400" : "text-slate-400 dark:text-slate-500"}`}>
                  {meta.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Part pickers ── */}
      <div className="flex flex-col gap-4 rounded-[1.6rem] border border-black/[0.05] bg-white/40 p-5 backdrop-blur-xl dark:border-white/[0.05] dark:bg-white/[0.025]">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-signal-600 dark:text-signal-400">
            Customize Parts
          </span>
          <button
            type="button"
            onClick={handleRandomize}
            disabled={disabled}
            className="inline-flex items-center gap-1 rounded-md border border-black/[0.06] bg-white/60 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500 transition-colors hover:bg-white hover:text-slate-900 disabled:opacity-50 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-400 dark:hover:bg-white/[0.08] dark:hover:text-white"
          >
            <RefreshCw size={10} strokeWidth={2.4} />
            Randomize
          </button>
        </div>

        <PartPicker label="Chassis" options={ROBOT_CHASSIS_OPTIONS} value={config.chassis} onChange={(id) => handleField("chassis", id)} disabled={disabled} />
        <PartPicker label="Eyes" options={ROBOT_EYE_OPTIONS} value={config.eyes} onChange={(id) => handleField("eyes", id)} disabled={disabled} />
        <PartPicker label="Antenna" options={ROBOT_ANTENNA_OPTIONS} value={config.antenna} onChange={(id) => handleField("antenna", id)} disabled={disabled} />
        <PartPicker label="Propulsion" options={ROBOT_WING_OPTIONS} value={config.wings} onChange={(id) => handleField("wings", id)} disabled={disabled} />
        <ColorSwatchPicker label="Base Color" options={ROBOT_BASE_COLOR_OPTIONS} value={config.baseColor} onChange={(id) => handleField("baseColor", id)} disabled={disabled} />
        <ColorSwatchPicker label="Accent Color" options={ROBOT_ACCENT_OPTIONS} value={config.accent} onChange={(id) => handleField("accent", id)} disabled={disabled} />
      </div>
    </div>
  );
}
