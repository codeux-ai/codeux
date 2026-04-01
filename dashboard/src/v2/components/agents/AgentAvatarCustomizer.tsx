import { h } from "preact";
import type { AgentAvatarConfig } from "../../types.js";
import type { AgentAvatarExpression } from "../../lib/agent-avatar.js";
import { AgentAvatarScene } from "./AgentAvatarScene.js";
import {
  AGENT_AVATAR_BODIES,
  AGENT_AVATAR_HAIRS,
  AGENT_AVATAR_FACES,
  AGENT_AVATAR_SHIRTS,
  AGENT_AVATAR_BOTTOMS,
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

export function AgentAvatarCustomizer({
  config,
  onChange,
  expression = "happy",
  fallbackMode = false,
  className = "",
  disabled = false,
}: AgentAvatarCustomizerProps) {
  const handleRandomize = () => {
    // Generate a random seed based on timestamp
    const seed = Date.now().toString(36) + Math.random().toString(36).substring(2);
    onChange(generateRandomAgentAvatar(seed));
  };

  const handleFieldChange = (field: keyof AgentAvatarConfig, value: string) => {
    onChange({ ...config, [field]: value });
  };

  return (
    <div className={`flex flex-col md:flex-row gap-6 ${className}`}>
      {/* Avatar Preview */}
      <div className="flex-1 min-w-[300px] h-[400px] bg-gray-50 rounded-xl overflow-hidden border border-gray-200 relative">
        <AgentAvatarScene
          config={config}
          expression={expression}
          fallbackMode={fallbackMode}
        />
        <button
          onClick={handleRandomize}
          disabled={disabled}
          className="touch-target absolute bottom-4 right-4 p-2 bg-white rounded-full shadow-md hover:bg-gray-50 text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title="Randomize Avatar"
          type="button"
        >
          <RefreshCw size={20} />
        </button>
      </div>

      {/* Controls */}
      <div className="w-full md:w-64 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Body
          </label>
          <select
            value={config.body || "male"}
            onChange={(e) => handleFieldChange("body", e.currentTarget.value)}
            disabled={disabled}
            className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
          >
            {AGENT_AVATAR_BODIES.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Hair
          </label>
          <select
            value={config.hair || "style1"}
            onChange={(e) => handleFieldChange("hair", e.currentTarget.value)}
            disabled={disabled}
            className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
          >
            {AGENT_AVATAR_HAIRS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Face
          </label>
          <select
            value={config.face || "style1"}
            onChange={(e) => handleFieldChange("face", e.currentTarget.value)}
            disabled={disabled}
            className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
          >
            {AGENT_AVATAR_FACES.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Shirt
          </label>
          <select
            value={config.shirt || "style1"}
            onChange={(e) => handleFieldChange("shirt", e.currentTarget.value)}
            disabled={disabled}
            className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
          >
            {AGENT_AVATAR_SHIRTS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Bottom
          </label>
          <select
            value={config.bottom || "style1"}
            onChange={(e) => handleFieldChange("bottom", e.currentTarget.value)}
            disabled={disabled}
            className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
          >
            {AGENT_AVATAR_BOTTOMS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
