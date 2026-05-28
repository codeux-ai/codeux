import { RefreshCw, Shapes, Palette } from "lucide-preact";
import type { AgentAvatarConfig } from "../../types.js";
import {
  ROBOT_CHASSIS_OPTIONS,
  ROBOT_EYE_OPTIONS,
  ROBOT_ANTENNA_OPTIONS,
  ROBOT_WING_OPTIONS,
  ROBOT_HEADPHONES_OPTIONS,
  ROBOT_ACCENT_OPTIONS,
  ROBOT_BASE_COLOR_OPTIONS,
  ROBOT_VISOR_COLOR_OPTIONS,
  generateRandomAgentAvatar,
} from "../../lib/agent-avatar.js";

interface AgentAvatarCustomizerProps {
  config: AgentAvatarConfig;
  onChange: (config: AgentAvatarConfig) => void;
  className?: string;
  disabled?: boolean;
}

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
              aria-pressed={selected}
              className={`rounded-xl px-3 py-2 text-[11px] font-bold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 disabled:cursor-not-allowed disabled:opacity-50 ${
                selected
                  ? "bg-signal-500 text-void-900 shadow-[0_0_14px_rgba(0,224,160,0.25)]"
                  : "border border-black/[0.06] bg-white/55 text-slate-500 hover:border-signal-500/30 hover:bg-signal-500/[0.08] hover:text-signal-600 dark:border-white/[0.07] dark:bg-white/[0.03] dark:text-slate-300 dark:hover:border-signal-500/30 dark:hover:text-signal-400"
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
  const selectedOpt = options.find((o) => o.id === value);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
          {label}
        </span>
        {selectedOpt && (
          <span className="text-[9px] font-semibold text-slate-400 dark:text-slate-500">
            {selectedOpt.label}
          </span>
        )}
      </div>
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
              aria-label={opt.label}
              aria-pressed={selected}
              className={`group relative h-8 w-8 rounded-full shadow-sm transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 disabled:cursor-not-allowed disabled:opacity-50 ${
                selected
                  ? "scale-110 ring-2 ring-signal-500/60 ring-offset-2 ring-offset-white dark:ring-offset-void-800"
                  : "ring-1 ring-black/[0.08] hover:scale-110 dark:ring-white/[0.08]"
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

/* ── Grouped sub-section ── */
function CustomizerGroup({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Shapes;
  title: string;
  children: preact.ComponentChildren;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-black/[0.05] bg-white/40 p-4 backdrop-blur-md dark:border-white/[0.05] dark:bg-white/[0.02]">
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-signal-500/10 text-signal-600 dark:bg-signal-500/15 dark:text-signal-400">
          <Icon className="h-3.5 w-3.5" strokeWidth={2.4} />
        </span>
        <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
          {title}
        </span>
      </div>
      {children}
    </div>
  );
}

/**
 * Controls-only avatar customizer. The live portrait lives in the Identity
 * card via {@link AgentAvatarStage}; this panel only edits the config so the
 * operator can watch the bot change as they tweak parts and colors.
 */
export function AgentAvatarCustomizer({
  config,
  onChange,
  className = "",
  disabled = false,
}: AgentAvatarCustomizerProps) {
  const handleRandomize = () => {
    const seed = Date.now().toString(36) + Math.random().toString(36).substring(2);
    onChange(generateRandomAgentAvatar(seed));
  };

  const handleField = (field: keyof AgentAvatarConfig, value: string) => {
    onChange({ ...config, [field]: value });
  };

  return (
    <div className={`flex flex-col gap-4 ${className}`}>
      <div className="flex items-center justify-between">
        <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
          Tweak parts and colors — the portrait updates live.
        </p>
        <button
          type="button"
          onClick={handleRandomize}
          disabled={disabled}
          className="group/rnd inline-flex shrink-0 items-center gap-1.5 rounded-full border border-black/[0.06] bg-white/60 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 transition-colors hover:bg-signal-500/[0.1] hover:text-signal-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-400 dark:hover:text-signal-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30"
        >
          <RefreshCw className="h-3 w-3 transition-transform duration-500 group-hover/rnd:rotate-180" strokeWidth={2.4} />
          Randomize
        </button>
      </div>

      <CustomizerGroup icon={Shapes} title="Form">
        <PartPicker label="Chassis" options={ROBOT_CHASSIS_OPTIONS} value={config.chassis} onChange={(id) => handleField("chassis", id)} disabled={disabled} />
        <PartPicker label="Eyes" options={ROBOT_EYE_OPTIONS} value={config.eyes} onChange={(id) => handleField("eyes", id)} disabled={disabled} />
        <PartPicker label="Antenna" options={ROBOT_ANTENNA_OPTIONS} value={config.antenna} onChange={(id) => handleField("antenna", id)} disabled={disabled} />
        <PartPicker label="Headphones" options={ROBOT_HEADPHONES_OPTIONS} value={config.headphones} onChange={(id) => handleField("headphones", id)} disabled={disabled} />
        <PartPicker label="Aura" options={ROBOT_WING_OPTIONS} value={config.wings} onChange={(id) => handleField("wings", id)} disabled={disabled} />
      </CustomizerGroup>

      <CustomizerGroup icon={Palette} title="Palette">
        <ColorSwatchPicker label="Base Color" options={ROBOT_BASE_COLOR_OPTIONS} value={config.baseColor} onChange={(id) => handleField("baseColor", id)} disabled={disabled} />
        <ColorSwatchPicker label="Accent Color" options={ROBOT_ACCENT_OPTIONS} value={config.accent} onChange={(id) => handleField("accent", id)} disabled={disabled} />
        <ColorSwatchPicker label="Visor Color" options={ROBOT_VISOR_COLOR_OPTIONS} value={config.visorColor} onChange={(id) => handleField("visorColor", id)} disabled={disabled} />
      </CustomizerGroup>
    </div>
  );
}
