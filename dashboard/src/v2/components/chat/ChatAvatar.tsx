import { type FunctionComponent } from "preact";
import { User, Terminal, Bot } from "lucide-preact";
import { ContainerShipDef } from "../ui/PlanningShip.js";

export type AvatarRole = "user" | "jules" | "system" | "agent" | "container";

export interface ChatAvatarProps {
  role: AvatarRole;
  provider?: string;
  agentName?: string;
  isDark?: boolean;
}

export const ChatAvatar: FunctionComponent<ChatAvatarProps> = ({ role, provider, agentName, isDark = true }) => {
  const getLabel = () => {
    if (role === 'jules') return 'Jules';
    if (role === 'container') return 'Container Worker';
    if (role === 'system') return 'System';
    if (role === 'user') return 'User';
    return agentName || 'Agent';
  };

  const renderIcon = () => {
    switch (role) {
      case 'jules':
        return (
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" class="w-full h-full p-1 jules-j-glow">
            <path
              d="M16 4V16C16 18.2091 14.2091 20 12 20C9.79086 20 8 18.2091 8 16V14"
              stroke="#00E0A0"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              class="jules-j-draw"
              style={{ animation: "jules-j-draw 3s ease-in-out infinite", animationFillMode: "both" }}
            />
          </svg>
        );
      case 'container':
        // The container ship is naturally quite wide, so we scale it to fit nicely within a square box
        return (
          <svg viewBox="-60 -40 120 80" aria-hidden="true" class="w-full h-full">
            {/* @ts-ignore */}
            <ContainerShipDef accentColor="#00E0A0" isMoving={true} isDark={isDark} />
          </svg>
        );
      case 'system':
        return <Terminal class="w-5 h-5 text-slate-500" aria-hidden="true" />;
      case 'user':
        return <User class="w-5 h-5 text-slate-400" aria-hidden="true" />;
      case 'agent':
      default:
        return <Bot class="w-5 h-5 text-amber-500" aria-hidden="true" />;
    }
  };

  const getContainerStyles = () => {
    switch (role) {
      case 'jules':
        return "bg-void-900 border-void-700 text-signal-500";
      case 'container':
        return "bg-slate-900 border-slate-700 text-slate-300";
      case 'system':
        return "bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700";
      case 'user':
        return "bg-slate-200 dark:bg-slate-700 border-slate-300 dark:border-slate-600";
      case 'agent':
      default:
        return "bg-amber-100 dark:bg-amber-900/30 border-amber-200 dark:border-amber-700";
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
