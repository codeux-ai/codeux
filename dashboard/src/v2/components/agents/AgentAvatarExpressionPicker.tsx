import { h } from "preact";
import { Smile } from "lucide-preact";
import type { AgentAvatarExpression } from "../../lib/agent-avatar.js";
import { AGENT_AVATAR_EXPRESSIONS } from "../../lib/agent-avatar.js";
import { EXPRESSION_META } from "./AgentAvatarStage.js";

interface AgentAvatarExpressionPickerProps {
  value: AgentAvatarExpression;
  onChange: (value: AgentAvatarExpression) => void;
  className?: string;
  disabled?: boolean;
}

export function AgentAvatarExpressionPicker({
  value,
  onChange,
  className = "",
  disabled = false,
}: AgentAvatarExpressionPickerProps) {
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
        Expression
      </span>
      <div className="flex flex-wrap gap-1.5">
        {AGENT_AVATAR_EXPRESSIONS.map((expression) => {
          const selected = value === expression;
          const meta = EXPRESSION_META[expression] || { Icon: Smile, label: expression };
          return (
            <button
              key={expression}
              type="button"
              disabled={disabled}
              onClick={() => onChange(expression)}
              aria-pressed={selected}
              className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-[11px] font-bold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 disabled:cursor-not-allowed disabled:opacity-50 ${
                selected
                  ? "bg-signal-500 text-void-900 shadow-[0_0_14px_rgba(0,224,160,0.25)]"
                  : "border border-black/[0.06] bg-white/55 text-slate-500 hover:border-signal-500/30 hover:bg-signal-500/[0.08] hover:text-signal-600 dark:border-white/[0.07] dark:bg-white/[0.03] dark:text-slate-300 dark:hover:border-signal-500/30 dark:hover:text-signal-400"
              }`}
            >
              <meta.Icon className="h-3.5 w-3.5" strokeWidth={2.4} />
              {meta.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
