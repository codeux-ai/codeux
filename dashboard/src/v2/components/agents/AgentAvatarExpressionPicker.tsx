import { h } from "preact";
import type { AgentAvatarExpression } from "../../lib/agent-avatar.js";
import { AGENT_AVATAR_EXPRESSIONS } from "../../lib/agent-avatar.js";

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
      <label className="text-sm font-medium text-gray-700">Expression</label>
      <div className="flex flex-wrap gap-2">
        {AGENT_AVATAR_EXPRESSIONS.map((expression) => (
          <button
            key={expression}
            onClick={() => onChange(expression)}
            disabled={disabled}
            className={`px-3 py-1 text-sm rounded-md transition-colors ${
              value === expression
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
            type="button"
          >
            {expression.replace("_", " ")}
          </button>
        ))}
      </div>
    </div>
  );
}
