import type { FunctionComponent, ComponentType } from "preact";
import { resolveIdentityAppearance, ChatIdentityProps } from "../../lib/chat-appearance.js";

interface Props extends ChatIdentityProps {
  size?: "sm" | "md" | "lg";
  className?: string;
}

export const ChatIdentityAvatar: FunctionComponent<Props> = ({ size = "md", className = "", ...props }) => {
  const appearance = resolveIdentityAppearance(props);
  const sizeClass = size === "sm" ? "h-6 w-6 text-xs" : size === "lg" ? "h-12 w-12 text-lg" : "h-9 w-9 text-sm";
  const iconSize = size === "sm" ? 14 : size === "lg" ? 24 : 16;

  let IconContent;
  if (appearance.icon === "jules") {
    IconContent = (
      <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-pulse">
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
        <path d="M2 17l10 5 10-5" />
        <path d="M2 12l10 5 10-5" />
      </svg>
    );
  } else if (appearance.icon === "boat") {
    IconContent = (
      <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-bounce">
        <path d="M4 15c2 0 4-1.5 6-1.5s4 1.5 6 1.5 4-1.5 6-1.5" />
        <path d="M16 12L12 4l-4 8z" />
        <path d="M12 12v6" />
      </svg>
    );
  } else {
    const Icon = appearance.icon as ComponentType<{ width: number; height: number; strokeWidth: number }>;
    IconContent = <Icon width={iconSize} height={iconSize} strokeWidth={1.6} />;
  }

  return (
    <div
      className={`flex items-center justify-center rounded-[0.9rem] border ${appearance.bgClass} ${appearance.textClass} ${appearance.borderClass} ${sizeClass} ${className}`}
      aria-label={appearance.label}
      role="img"
    >
      {IconContent}
    </div>
  );
};
