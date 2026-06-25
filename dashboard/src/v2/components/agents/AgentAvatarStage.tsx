import type { FunctionComponent } from "preact";
import { RefreshCw, Smile, Frown, Angry, Meh, Zap } from "lucide-preact";
import type { AgentAvatarConfig } from "../../types.js";
import type { AgentAvatarExpression } from "../../lib/agent-avatar.js";
import { LazyAgentAvatarScene } from "./LazyAgentAvatarScene.js";
import { SHOWCASE_EXPRESSIONS } from "../../lib/agent-avatar.js";

/* ── Expression icon + label map (single source of truth) ── */
export const EXPRESSION_META: Record<string, { Icon: typeof Smile; label: string }> = {
  happy: { Icon: Smile, label: "Happy" },
  sad: { Icon: Frown, label: "Sad" },
  angry: { Icon: Angry, label: "Angry" },
  bored: { Icon: Meh, label: "Bored" },
  hyped: { Icon: Zap, label: "Hyped" },
};

/**
 * Reusable, polished avatar "portrait" stage. Renders the live 3D scene over a
 * brand-tinted gradient with a glassy expression control and an optional
 * randomize button — so the info card and the editor share one identity look.
 */
export const AgentAvatarStage: FunctionComponent<{
  config?: AgentAvatarConfig;
  expression: AgentAvatarExpression;
  accentHex: string;
  onExpressionChange?: (expression: AgentAvatarExpression) => void;
  onRandomize?: () => void;
  heightClass?: string;
  className?: string;
  fallbackMode?: boolean;
  disabled?: boolean;
}> = ({
  config,
  expression,
  accentHex,
  onExpressionChange,
  onRandomize,
  heightClass = "h-[300px]",
  className = "",
  fallbackMode = false,
  disabled = false,
}) => {
  const activeMeta = EXPRESSION_META[expression];
  return (
    <div
      className={`relative overflow-hidden rounded-[1.5rem] border border-black/[0.06] bg-white/40 shadow-sm backdrop-blur-2xl dark:border-white/[0.07] dark:bg-void-800/40 ${className}`}
      style={{
        backgroundImage: `radial-gradient(circle at 50% 38%, ${accentHex}26, transparent 62%)`,
      }}
    >
      {/* Soft accent halo behind the bot */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[38%] h-44 w-44 -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl"
        style={{ backgroundColor: `${accentHex}26` }}
      />

      <div className={`relative w-full ${heightClass}`}>
        <LazyAgentAvatarScene
          config={config}
          expression={expression}
          fallbackMode={fallbackMode}
          className="h-full w-full"
        />
      </div>

      {/* Randomize — floating glass dice */}
      {onRandomize && (
        <button
          type="button"
          onClick={onRandomize}
          disabled={disabled}
          title="Randomize appearance"
          aria-label="Randomize appearance"
          className="group/rnd absolute right-3 top-3 inline-flex h-9 items-center gap-1.5 rounded-full border border-black/[0.06] bg-white/75 px-3 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 shadow-sm backdrop-blur-md transition-all hover:bg-signal-500 hover:text-void-900 hover:shadow-[0_0_18px_rgba(0,224,160,0.35)] focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:bg-white/[0.08] dark:text-slate-300 dark:hover:bg-signal-500 dark:hover:text-void-900"
        >
          <RefreshCw className="h-3.5 w-3.5 transition-transform duration-500 group-hover/rnd:rotate-180" strokeWidth={2.5} />
          Shuffle
        </button>
      )}

      {/* Bottom gradient + expression control */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-white/90 via-white/45 to-transparent dark:from-void-900/90 dark:via-void-900/40" />

      {onExpressionChange && (
        <div className="absolute inset-x-0 bottom-3 flex flex-col items-center gap-1.5 px-4">
          <div className="flex items-center gap-1 rounded-full border border-black/[0.06] bg-white/75 p-1 shadow-[0_4px_16px_rgba(0,0,0,0.06)] backdrop-blur-xl dark:border-white/[0.08] dark:bg-void-800/75">
            {SHOWCASE_EXPRESSIONS.map((expr) => {
              const meta = EXPRESSION_META[expr];
              const isActive = expression === expr;
              return (
                <button
                  key={expr}
                  type="button"
                  onClick={() => onExpressionChange(expr)}
                  title={meta.label}
                  aria-label={meta.label}
                  aria-pressed={isActive}
                  className={`flex h-8 w-8 items-center justify-center rounded-full transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/40 ${
                    isActive
                      ? "bg-signal-500 text-void-900 shadow-[0_0_12px_rgba(0,224,160,0.4)]"
                      : "text-slate-400 hover:bg-black/[0.04] hover:text-slate-600 dark:text-slate-500 dark:hover:bg-white/[0.06] dark:hover:text-slate-300"
                  }`}
                >
                  <meta.Icon className="h-4 w-4" strokeWidth={2.2} />
                </button>
              );
            })}
          </div>
          {activeMeta && (
            <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
              {activeMeta.label}
            </span>
          )}
        </div>
      )}
    </div>
  );
};
