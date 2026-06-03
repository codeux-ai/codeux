import { type FunctionComponent } from "preact";
import type { ConversationRuntimeState } from "../../types.js";
import { getWorkingBubbleData } from "../../lib/chat-widget-view-models.js";
import { PlanningRequestWidget } from "./widgets/PlanningRequestWidget.js";
import { ChatAvatar, type AvatarRole } from "./ChatAvatar.js";

export interface WorkingBubbleProps {
  displayName: string | null;
  runtimeState?: ConversationRuntimeState | null;
}

export const WorkingBubble: FunctionComponent<WorkingBubbleProps> = ({ displayName, runtimeState }) => {
  const data = getWorkingBubbleData(runtimeState);

  let role: AvatarRole = "agent";
  if (runtimeState?.routeKind === "worker" || displayName) {
    role = "agent";
  } else if (runtimeState?.routeKind === "virtual" || data.isPlanning) {
    role = "jules";
  }

  return (
    <div className="flex justify-start">
      <div className="flex max-w-[760px] w-full items-start gap-3">
        <div className="mt-1 flex shrink-0 w-8 h-8 items-center justify-center">
          <ChatAvatar role={role} provider={data.providerLabel} agentName={displayName || "Assistant"} />
        </div>
        <div className="space-y-2 w-full max-w-[calc(100%-3rem)]">
          {data.isPlanning ? (
            <PlanningRequestWidget status="running" planName={data.planName || "Execution Plan"} />
          ) : (
            <div className="flex flex-col w-full rounded-2xl border bg-black/[0.03] backdrop-blur-md p-4 shadow-[0_2px_16px_rgba(0,0,0,0.04)] rounded-tl-sm border-black/[0.06] text-slate-700 dark:bg-white/5 dark:border-white/10 dark:text-slate-300">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-medium text-slate-700 dark:text-slate-300">
                  {displayName || "Listener"} is preparing a reply
                  <span className="ml-2 inline-flex items-center rounded-md border border-signal-500/30 bg-signal-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-signal-500">
                    Pending Reply
                  </span>
                </span>
                <span className="flex items-center gap-1 ml-1">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-signal-500" />
                  <span className="h-2 w-2 animate-pulse rounded-full bg-signal-500 [animation-delay:120ms]" />
                  <span className="h-2 w-2 animate-pulse rounded-full bg-signal-500 [animation-delay:240ms]" />
                </span>
              </div>
            </div>
          )}
          <div className="px-1 text-[10px] font-mono text-slate-500 dark:text-slate-400">Working</div>
        </div>
      </div>
    </div>
  );
};
