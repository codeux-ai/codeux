import { type FunctionComponent } from "preact";
import type { ChatMessageRecord } from "../../types.js";
import { renderMarkdown } from "../../../lib/markdown.js";
import { getChatWidgetData } from "../../lib/chat-widget-view-models.js";
import { formatChatTime } from "../../lib/chat-time.js";
import { PlanningRequestWidget } from "./widgets/PlanningRequestWidget.js";
import { ChatAvatar, type AvatarRole } from "./ChatAvatar.js";

export interface ChatMessageBubbleProps {
  message: ChatMessageRecord;
}

export const ChatMessageBubble: FunctionComponent<ChatMessageBubbleProps> = ({ message }) => {
  const fromDashboard = message.direction === "dashboard_to_connection";
  const widgetData = getChatWidgetData(message);

  let role: AvatarRole = "agent";
  if (fromDashboard) {
    role = "user";
  } else if (message.authorType === "system") {
    role = "system";
  } else if (message.metadata?.provider === "jules" || message.authorType === "connection") {
    role = "jules";
  }

  const senderName = fromDashboard ? "User" : (message.metadata?.agentName as string) || "Assistant";
  const providerLabel = message.metadata?.provider as string | undefined;
  const createdAtLabel = formatChatTime(message.createdAt);

  return (
    <article className={`flex ${fromDashboard ? "justify-end" : "justify-start"}`}>
      <div className={`flex max-w-[760px] items-start gap-3 w-full ${fromDashboard ? "flex-row-reverse" : "flex-row"}`}>
        <div className="mt-1 shrink-0 w-8 h-8 flex items-center justify-center">
          <ChatAvatar role={role} provider={providerLabel} agentName={senderName} />
        </div>

        <div className={`flex flex-col w-full max-w-[calc(100%-3rem)] rounded-2xl border bg-white/5 backdrop-blur-md p-4 shadow-[0_2px_16px_rgba(0,0,0,0.04)] ${
          fromDashboard
            ? "rounded-tr-sm border-signal-500/20"
            : "rounded-tl-sm border-white/10"
        }`}>
          {/* Header Row */}
          <div className={`flex items-center gap-3 mb-2 text-[11px] font-mono text-slate-400 ${fromDashboard ? "justify-end flex-row-reverse" : "justify-start"}`}>
            <span className="font-semibold text-slate-300">{senderName}</span>
            {providerLabel && (
              <span className="px-1.5 py-0.5 rounded-sm bg-black/20 text-slate-300">
                {providerLabel}
              </span>
            )}
            {createdAtLabel && <span>{createdAtLabel}</span>}
          </div>

          {/* Message Body */}
          <div className="prose prose-sm max-w-none text-[14px] leading-7 text-slate-200 prose-headings:text-inherit prose-p:text-inherit prose-strong:text-inherit prose-code:text-inherit break-words"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(message.bodyMarkdown) }}
          />

          {/* Widget Slot */}
          {widgetData.type === "planning" && (
            <div className="mt-4 border-t border-white/5 pt-4">
              <PlanningRequestWidget status={widgetData.status} planName={widgetData.planName} />
            </div>
          )}

          {fromDashboard && (
             <div className="mt-2 text-[10px] font-mono text-slate-500 text-right">
               {message.deliveryStatus}
             </div>
          )}
        </div>
      </div>
    </article>
  );
};
