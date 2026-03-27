import type { FunctionComponent } from "preact";
import { resolveIdentityAppearance, ChatIdentityProps } from "../../lib/chat-appearance.js";

export const ChatRouteBadge: FunctionComponent<ChatIdentityProps> = (props) => {
  const appearance = resolveIdentityAppearance(props);

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${appearance.bgClass} ${appearance.textClass} border ${appearance.borderClass}`}>
      {appearance.label}
    </span>
  );
};
