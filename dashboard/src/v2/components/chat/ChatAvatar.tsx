import { type FunctionComponent } from "preact";
import { User, Terminal, Bot } from "lucide-preact";
import { ContainerShipDef } from "../ui/PlanningShip.js";
import { RobotLogo } from "../brand/RobotLogo.js";
import { AgentAvatarSvg } from "../agents/AgentAvatarSvg.js";
import { normalizeAgentAvatarConfig } from "../../lib/agent-avatar.js";
import type { AgentAvatarConfig } from "../../types.js";

export type AvatarRole = "user" | "jules" | "system" | "agent" | "container";

export interface ChatAvatarProps {
  role: AvatarRole;
  provider?: string;
  agentName?: string;
  /** Optional per-agent avatar config — when provided, renders the customized robot. */
  avatarConfig?: AgentAvatarConfig;
  isDark?: boolean;
}

/* Map any string to a stable accent + variant pair so two agents with
   different names get visually distinct robots in the chat. */
function variantFromName(name: string): { accent: string; chassis: string } {
  const accents = ["jade", "amber", "violet", "coral", "sky", "fuchsia"];
  const chassis = ["classic", "square", "tall", "pebble"];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i);
    hash = hash & hash;
  }
  const h = Math.abs(hash);
  return {
    accent: accents[h % accents.length],
    chassis: chassis[Math.floor(h / accents.length) % chassis.length],
  };
}

export const ChatAvatar: FunctionComponent<ChatAvatarProps> = ({
  role,
  provider: _provider,
  agentName,
  avatarConfig,
  isDark = true,
}) => {
  const getLabel = () => {
    if (role === "jules") return "Jules";
    if (role === "container") return "Container Worker";
    if (role === "system") return "System";
    if (role === "user") return "User";
    return agentName || "Agent";
  };

  const renderIcon = () => {
    switch (role) {
      case "jules":
        // Brand mark — the Code UX logo robot in miniature, with the jade
        // jewel pulse retained via the legacy `jules-j-glow` class so the
        // existing CSS pulse animation continues to drive its breath.
        return (
          <div class="w-full h-full p-0.5 jules-j-glow" aria-hidden="true">
            <RobotLogo size="100%" rounded={false} idle={true} className="cux-trigger" />
          </div>
        );

      case "container":
        // The container ship is a distinct concept (a worker container, not a
        // brand agent), so we keep its dedicated illustration.
        return (
          <svg viewBox="-60 -40 120 80" aria-hidden="true" class="w-full h-full">
            {/* @ts-ignore */}
            <ContainerShipDef accentColor="#00E0A0" isMoving={true} isDark={isDark} />
          </svg>
        );

      case "system":
        return <Terminal class="w-5 h-5 text-slate-500" aria-hidden="true" />;

      case "user":
        return <User class="w-5 h-5 text-slate-400" aria-hidden="true" />;

      case "agent":
      default: {
        // Logo-faithful mini robot. If we have a config use it, otherwise
        // pick a deterministic variant from the agent's name so different
        // agents are visually distinct in the chat.
        if (avatarConfig) {
          try {
            const config = normalizeAgentAvatarConfig(avatarConfig);
            return (
              <div class="w-full h-full p-0.5 overflow-hidden" data-cux-agent-name={agentName ?? ""}>
                <AgentAvatarSvg config={config} size={32} expression="happy" className="w-full h-full" />
              </div>
            );
          } catch (err) {
            // Fall back to Bot icon if config is invalid
          }
        }
        return <Bot class="w-5 h-5 text-slate-400" aria-hidden="true" />;
      }
    }
  };

  const getContainerStyles = () => {
    switch (role) {
      case "jules":
        return "bg-void-900 border-void-700 text-signal-500";
      case "container":
        return "bg-slate-900 border-slate-700 text-slate-300";
      case "system":
        return "bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700";
      case "user":
        return "bg-slate-200 dark:bg-slate-700 border-slate-300 dark:border-slate-600";
      case "agent":
      default:
        return "bg-void-900/95 border-void-700/80 dark:bg-void-900 dark:border-void-700";
    }
  };

  return (
    <div
      class={`flex-shrink-0 w-8 h-8 rounded-md border flex items-center justify-center overflow-hidden ${getContainerStyles()}`}
      role="img"
      aria-label={getLabel()}
      title={getLabel()}
    >
      {renderIcon()}
    </div>
  );
};
