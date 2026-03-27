import type { FunctionComponent } from "preact";
import { getWidgetAppearance } from "../../lib/chat-appearance.js";

interface ChatActivityWidgetProps {
  status: "planning" | "waiting" | "compaction" | "transition";
  displayName?: string | null;
}

export const ChatActivityWidget: FunctionComponent<ChatActivityWidgetProps> = ({ status, displayName }) => {
  const { text, icon: Icon, colorClass } = getWidgetAppearance(status);

  return (
    <div className="flex items-center gap-2">
      <span className="text-[13px] font-medium text-slate-500 dark:text-slate-400">
        {displayName ? `${displayName} is ` : ""}{text.toLowerCase()}
      </span>
      <span className="flex items-center gap-1" aria-label={text} role="status">
        <span className={`h-2 w-2 animate-pulse rounded-full ${colorClass.replace("text-", "bg-")}`} />
        <span className={`h-2 w-2 animate-pulse rounded-full ${colorClass.replace("text-", "bg-")} [animation-delay:120ms]`} />
        <span className={`h-2 w-2 animate-pulse rounded-full ${colorClass.replace("text-", "bg-")} [animation-delay:240ms]`} />
      </span>
    </div>
  );
};
