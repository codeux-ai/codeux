import type { FunctionComponent } from "preact";
import { type ChatIdentityRole, getAvatarStyles } from "../../lib/chat-appearance.js";

interface ChatRouteBadgeProps {
  role: ChatIdentityRole;
  labelOverride?: string;
  className?: string;
}

export const ChatRouteBadge: FunctionComponent<ChatRouteBadgeProps> = ({
  role,
  labelOverride,
  className = "",
}) => {
  const styles = getAvatarStyles(role);
  const label = labelOverride || styles.label;

  return (
    <div
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${styles.borderClass} ${styles.bgClass} ${styles.colorClass} ${className}`}
    >
      <span className={`bg-gradient-to-br bg-clip-text text-transparent ${styles.gradientFrom} ${styles.gradientTo}`}>
        {label}
      </span>
    </div>
  );
};
