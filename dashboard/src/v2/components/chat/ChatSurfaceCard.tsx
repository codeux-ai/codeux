import type { FunctionComponent, ComponentChildren } from "preact";
import { type ChatIdentityRole, getAvatarStyles } from "../../lib/chat-appearance.js";

interface ChatSurfaceCardProps {
  role: ChatIdentityRole;
  children: ComponentChildren;
  align?: "left" | "right";
  className?: string;
}

export const ChatSurfaceCard: FunctionComponent<ChatSurfaceCardProps> = ({
  role,
  children,
  align = "left",
  className = "",
}) => {
  const isRight = align === "right";
  const radiusClass = isRight ? "rounded-[1.5rem] rounded-tr-sm" : "rounded-[1.5rem] rounded-tl-sm";
  const styles = getAvatarStyles(role);

  const bgBorderTextClass = role === "user" || role === "system"
    ? `border border-black/[0.06] bg-white/75 text-slate-700 dark:border-white/[0.06] dark:bg-void-800/70 dark:text-slate-200`
    : `border ${styles.borderClass} ${styles.bgClass} text-slate-900 dark:text-white`;

  return (
    <div
      className={`${radiusClass} px-5 py-4 shadow-[0_2px_16px_rgba(0,0,0,0.04)] ${bgBorderTextClass} ${className}`}
    >
      {children}
    </div>
  );
};
