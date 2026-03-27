import type { FunctionComponent } from "preact";
import type { ChatActivityState } from "../../lib/chat-appearance.js";

interface ChatActivityWidgetProps {
  state: ChatActivityState;
  message?: string;
  className?: string;
}

const getLabelForState = (state: ChatActivityState, message?: string) => {
  if (message) return message;
  switch (state) {
    case "planning": return "Planning next steps";
    case "waiting": return "Waiting for reply";
    case "compacting": return "Compacting history";
    case "transitioning": return "Switching context";
    case "idle": return "Idle";
    default: return "Working";
  }
};

export const ChatActivityWidget: FunctionComponent<ChatActivityWidgetProps> = ({
  state,
  message,
  className = "",
}) => {
  if (state === "idle") {
    return null;
  }

  const label = getLabelForState(state, message);

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <span className="text-[13px] font-medium text-slate-500 dark:text-slate-400">
        {label}
      </span>
      <span className="flex items-center gap-1">
        <span className="h-2 w-2 animate-pulse rounded-full bg-signal-500" />
        <span className="h-2 w-2 animate-pulse rounded-full bg-signal-500 [animation-delay:120ms]" />
        <span className="h-2 w-2 animate-pulse rounded-full bg-signal-500 [animation-delay:240ms]" />
      </span>
    </div>
  );
};
