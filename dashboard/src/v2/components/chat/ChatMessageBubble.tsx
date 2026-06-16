import { type FunctionComponent } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import gsap from "gsap";
import { Check, CheckCheck, XCircle, Loader2 } from "lucide-preact";
import type { ChatMessageRecord, AgentAvatarConfig } from "../../types.js";
import { renderMarkdown } from "../../../lib/markdown.js";
import { getChatWidgetData } from "../../lib/chat-widget-view-models.js";
import { formatChatTime } from "../../lib/chat-time.js";
import { PlanningRequestWidget } from "./widgets/PlanningRequestWidget.js";
import { ChatAvatar, type AvatarRole } from "./ChatAvatar.js";
import { resolveDisplayDeliveryStatus } from "../../hooks/use-chat-thread-data.js";
import { useGsapDurations } from "../../lib/motion/constants.js";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";

export interface ChatMessageBubbleProps {
  message: ChatMessageRecord;
  allMessages?: ChatMessageRecord[];
  agentAvatarConfig?: AgentAvatarConfig;
  agentName?: string;
  animationDelay?: number;
}

export const ChatMessageBubble: FunctionComponent<ChatMessageBubbleProps> = ({
  message,
  allMessages = [],
  agentAvatarConfig,
  agentName,
  animationDelay = 0,
}) => {
  const fromDashboard = message.direction === "dashboard_to_connection";
  const widgetData = getChatWidgetData(message);

  const bubbleRef = useRef<HTMLDivElement>(null);
  const durations = useGsapDurations();
  const reducedMotion = useReducedMotion();

  useLayoutEffect(() => {
    if (bubbleRef.current) {
      gsap.fromTo(
        bubbleRef.current,
        { opacity: 0, y: reducedMotion ? 0 : 8 },
        { opacity: 1, y: 0, duration: durations.base, ease: 'power2.out', delay: animationDelay }
      );
    }
  }, []);

  let role: AvatarRole = "agent";
  if (fromDashboard) {
    role = "user";
  } else if (message.authorType === "system") {
    role = "system";
  } else if (message.metadata?.provider === "jules" || message.authorType === "connection") {
    role = agentAvatarConfig ? "agent" : "jules";
  }

  const senderName = fromDashboard
    ? "User"
    : agentName || (message.metadata?.agentName as string) || "Assistant";
  const providerLabel = message.metadata?.provider as string | undefined;
  const createdAtLabel = formatChatTime(message.createdAt);

  const displayDeliveryStatus = resolveDisplayDeliveryStatus(message, allMessages);

  const opacityClass = (fromDashboard && (displayDeliveryStatus === "pending" || displayDeliveryStatus === "failed"))
    ? "opacity-60"
    : "opacity-100";

  return (
    <div ref={bubbleRef} className={`flex ${fromDashboard ? "justify-end" : "justify-start"} ${opacityClass}`}>
      <div className={`flex max-w-[760px] items-start gap-3 w-full ${fromDashboard ? "flex-row-reverse" : "flex-row"}`}>
        <div className="mt-1 shrink-0 w-8 h-8 flex items-center justify-center">
          <ChatAvatar
            role={role}
            provider={providerLabel}
            agentName={!fromDashboard ? agentName || senderName : undefined}
            avatarConfig={!fromDashboard ? agentAvatarConfig : undefined}
          />
        </div>

        <div className={`flex flex-col min-w-0 w-full max-w-[calc(100%-3rem)] rounded-2xl border bg-slate-100/80 backdrop-blur-md p-4 shadow-[0_2px_16px_rgba(0,0,0,0.04)] dark:bg-white/5 ${
          fromDashboard
            ? "rounded-tr-sm border-signal-500/20"
            : "rounded-tl-sm border-slate-200/60 dark:border-white/10"
        }`}>
          {/* Header Row */}
          <div className={`flex items-center gap-3 mb-2 text-[11px] font-mono text-slate-400 ${fromDashboard ? "justify-end flex-row-reverse" : "justify-start"}`}>
            <span className="font-semibold text-slate-900 dark:text-slate-300">{senderName}</span>
            {providerLabel && (
              <span className="px-1.5 py-0.5 rounded-sm bg-slate-200 text-slate-600 dark:bg-black/20 dark:text-slate-300 truncate max-w-[150px] inline-block">
                {providerLabel}
              </span>
            )}
            {createdAtLabel && <span>{createdAtLabel}</span>}
          </div>

          {/* Message Body */}
          <div className="prose prose-sm max-w-none text-[14px] leading-7 text-slate-800 dark:text-slate-200 prose-headings:text-inherit prose-p:text-inherit prose-strong:text-inherit prose-code:text-inherit break-words overflow-wrap-anywhere min-w-0"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(message.bodyMarkdown) }}
          />

          {/* Widget Slot */}
          {widgetData.type === "planning" && (
            <div className="mt-4 border-t border-white/5 pt-4">
              <PlanningRequestWidget status={widgetData.status} planName={widgetData.planName} />
            </div>
          )}

          {fromDashboard && (
             <div className="mt-2 flex items-center justify-end gap-1.5 text-[10px] font-mono">
               {displayDeliveryStatus === "pending" && (
                 <>
                   <Loader2 className="h-3 w-3 animate-spin text-slate-400" />
                   <span className="text-slate-400">Queued</span>
                 </>
               )}
               {displayDeliveryStatus === "delivered" && (
                 <>
                   <Check className="h-3 w-3 text-slate-400" />
                   <span className="text-slate-400">Delivered</span>
                 </>
               )}
               {displayDeliveryStatus === "processed" && (
                 <>
                   <CheckCheck className="h-3 w-3 text-signal-500" />
                   <span className="text-signal-500">Processed</span>
                 </>
               )}
               {displayDeliveryStatus === "failed" && (
                 <>
                   <XCircle className="h-3 w-3 text-status-red" />
                   <span className="text-status-red">Failed</span>
                 </>
               )}
             </div>
          )}
        </div>
      </div>
    </div>
  );
};
