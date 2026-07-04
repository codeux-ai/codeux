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
  const deliveryStatusLabel = displayDeliveryStatus.charAt(0).toUpperCase() + displayDeliveryStatus.slice(1);

  const opacityClass = (fromDashboard && (displayDeliveryStatus === "pending" || displayDeliveryStatus === "failed"))
    ? "opacity-60"
    : "opacity-100";

  return (
    <div ref={bubbleRef} className={`flex ${fromDashboard ? "justify-end" : "justify-start"} ${opacityClass}`}>
      <span className="sr-only">
        From {senderName} at {createdAtLabel}. Status: {displayDeliveryStatus}.
      </span>
      <div className={`flex max-w-[760px] items-start gap-3 w-full min-w-0 ${fromDashboard ? "flex-row-reverse" : "flex-row"}`}>
        <div className="mt-1 shrink-0 w-8 h-8 flex items-center justify-center">
          <ChatAvatar
            role={role}
            provider={providerLabel}
            agentName={!fromDashboard ? agentName || senderName : undefined}
            avatarConfig={!fromDashboard ? agentAvatarConfig : undefined}
          />
        </div>

        <article className={`flex flex-col min-w-0 w-full max-w-[calc(100%-3rem)] rounded-[1.35rem] border backdrop-blur-xl p-4 shadow-[0_12px_34px_rgba(15,23,42,0.06)] dark:shadow-[0_14px_42px_rgba(0,0,0,0.22)] ${
          fromDashboard
            ? "rounded-tr-md border-signal-500/22 bg-signal-500/[0.075] dark:bg-signal-500/[0.095]"
            : message.authorType === "system"
              ? "rounded-tl-md border-dashed border-status-amber/25 bg-status-amber/[0.045] dark:bg-status-amber/[0.06]"
              : "rounded-tl-md border-black/[0.06] bg-white/72 dark:border-white/[0.08] dark:bg-white/[0.045]"
        }`}>
          <header className={`mb-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400 ${fromDashboard ? "justify-end flex-row-reverse" : "justify-start"}`}>
            <span className="min-w-0 truncate font-semibold text-slate-900 dark:text-slate-200">{senderName}</span>
            {providerLabel && (
              <span className="inline-block max-w-[14rem] truncate rounded-md bg-black/[0.045] px-1.5 py-0.5 font-mono text-[10px] text-slate-500 dark:bg-black/20 dark:text-slate-300">
                {providerLabel}
              </span>
            )}
            {createdAtLabel && <time dateTime={message.createdAt} className="font-mono text-[10px] text-slate-400 dark:text-slate-500">{createdAtLabel}</time>}
          </header>

          <div className="prose prose-sm max-w-none min-w-0 text-[14px] leading-7 text-slate-800 [overflow-wrap:anywhere] dark:text-slate-200 prose-headings:text-inherit prose-p:text-inherit prose-strong:text-inherit prose-code:break-words prose-code:text-inherit prose-pre:max-w-full prose-pre:overflow-x-auto prose-pre:whitespace-pre"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(message.bodyMarkdown) }}
          />

          {/* Widget Slot */}
          {widgetData.type === "planning" && (
            <div className="mt-4 border-t border-white/5 pt-4">
              <PlanningRequestWidget status={widgetData.status} planName={widgetData.planName} />
            </div>
          )}

          {fromDashboard && (
             <div aria-label={`Delivery status: ${deliveryStatusLabel}`} className="mt-2 flex items-center justify-end gap-1.5 text-[10px] font-mono">
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
        </article>
      </div>
    </div>
  );
};
