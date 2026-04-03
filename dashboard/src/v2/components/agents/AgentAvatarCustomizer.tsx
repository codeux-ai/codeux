import { h } from "preact";
import { useState } from "preact/hooks";
import type { AgentAvatarConfig } from "../../types.js";
import type { AgentAvatarExpression } from "../../lib/agent-avatar.js";
import { AgentAvatarScene } from "./AgentAvatarScene.js";
import {
  ROBOT_CHASSIS_OPTIONS,
  ROBOT_EYE_OPTIONS,
  ROBOT_ANTENNA_OPTIONS,
  ROBOT_WING_OPTIONS,
  ROBOT_ACCENT_OPTIONS,
  SHOWCASE_EXPRESSIONS,
  generateRandomAgentAvatar,
} from "../../lib/agent-avatar.js";
import { RefreshCw } from "lucide-preact";

interface AgentAvatarCustomizerProps {
  config: AgentAvatarConfig;
  onChange: (config: AgentAvatarConfig) => void;
  expression?: AgentAvatarExpression;
  fallbackMode?: boolean;
  className?: string;
  disabled?: boolean;
}

const EXPRESSION_EMOJI: Record<string, string> = {
  happy: "\u{1F60A}",
  sad: "\u{1F622}",
  angry: "\u{1F620}",
  bored: "\u{1F611}",
  hyped: "\u{1F929}",
};

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
      <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-slate-400">
        {label}
      </span>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => {
          const selected = value === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              disabled={disabled}
              onClick={() => onChange(opt.id)}
              className={`rounded-xl px-3 py-2 text-xs font-bold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 disabled:opacity-50 disabled:cursor-not-allowed ${
                selected
                  ? "bg-signal-500 text-void-900 shadow-[0_0_12px_rgba(0,224,160,0.3)] scale-105"
                  : "border border-white/[0.08] bg-white/[0.04] text-slate-400 hover:border-signal-500/40 hover:bg-signal-500/10 hover:text-signal-400"
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

function ColorSwatchPicker({
  value,
  onChange,
  disabled,
}: {
  value: string | undefined;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-slate-400">
        Accent Color
      </span>
      <div className="flex flex-wrap gap-2.5">
        {ROBOT_ACCENT_OPTIONS.map((opt) => {
          const selected = value === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              disabled={disabled}
              onClick={() => onChange(opt.id)}
              title={opt.label}
              className={`group relative h-9 w-9 rounded-full transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 disabled:opacity-50 disabled:cursor-not-allowed ${
                selected ? "scale-110 ring-2 ring-white/40 ring-offset-2 ring-offset-void-900" : "hover:scale-110"
              }`}
              style={{ backgroundColor: opt.hex }}
            >
              {selected && (
                <span className="absolute inset-0 flex items-center justify-center text-[10px] font-black text-white drop-shadow-md">
                  &#10003;
                </span>
              )}
              <span
                className="absolute -inset-1 rounded-full opacity-0 transition-opacity group-hover:opacity-100"
                style={{
                  boxShadow: `0 0 16px ${opt.hex}60`,
                }}
              />
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
    <div className={`flex flex-col gap-6 ${className}`}>
      {/* Preview stage */}
      <div className="relative overflow-hidden rounded-[1.75rem] border border-white/[0.06] bg-void-800/60 shadow-[0_4px_24px_rgba(0,0,0,0.3)]">
        <div className="h-[320px] w-full">
          <AgentAvatarScene
            config={config}
            expression={activeExpression}
            fallbackMode={fallbackMode}
          />
        </div>

        {/* Floating randomize button */}
        <button
          onClick={handleRandomize}
          disabled={disabled}
          type="button"
          className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-void-900/80 text-signal-400 backdrop-blur-sm transition-all hover:bg-signal-500 hover:text-void-900 hover:shadow-[0_0_20px_rgba(0,224,160,0.4)] disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30"
          title="Randomize"
        >
          <RefreshCw size={16} strokeWidth={2.5} />
        </button>

        {/* Expression bar */}
        <div className="absolute bottom-0 inset-x-0 flex items-center justify-center gap-2 bg-gradient-to-t from-void-900/90 to-transparent px-4 py-4">
          {SHOWCASE_EXPRESSIONS.map((expr) => (
            <button
              key={expr}
              type="button"
              onClick={() => setPreviewExpression(expr)}
              className={`flex flex-col items-center gap-1 rounded-xl px-3 py-2 transition-all focus:outline-none ${
                activeExpression === expr
                  ? "bg-signal-500/20 shadow-[0_0_12px_rgba(0,224,160,0.2)]"
                  : "hover:bg-white/5"
              }`}
            >
              <span className="text-lg leading-none">{EXPRESSION_EMOJI[expr]}</span>
              <span
                className={`text-[8px] font-bold uppercase tracking-[0.14em] ${
                  activeExpression === expr ? "text-signal-400" : "text-slate-500"
                }`}
              >
                {expr}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Part pickers */}
      <div className="flex flex-col gap-5 rounded-[1.75rem] border border-white/[0.06] bg-void-800/40 p-6 backdrop-blur-xl">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-signal-500">
            Customize Parts
          </span>
        </div>

        <PartPicker
          label="Chassis"
          options={ROBOT_CHASSIS_OPTIONS}
          value={config.chassis}
          onChange={(id) => handleField("chassis", id)}
          disabled={disabled}
        />

        <PartPicker
          label="Eyes"
          options={ROBOT_EYE_OPTIONS}
          value={config.eyes}
          onChange={(id) => handleField("eyes", id)}
          disabled={disabled}
        />

        <PartPicker
          label="Antenna"
          options={ROBOT_ANTENNA_OPTIONS}
          value={config.antenna}
          onChange={(id) => handleField("antenna", id)}
          disabled={disabled}
        />

        <PartPicker
          label="Propulsion"
          options={ROBOT_WING_OPTIONS}
          value={config.wings}
          onChange={(id) => handleField("wings", id)}
          disabled={disabled}
        />

        <ColorSwatchPicker
          value={config.accent}
          onChange={(id) => handleField("accent", id)}
          disabled={disabled}
        />
      </div>
    </div>
  );
}
