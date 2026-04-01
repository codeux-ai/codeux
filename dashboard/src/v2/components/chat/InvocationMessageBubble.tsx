import { type FunctionComponent } from "preact";
import type { ExecutionInvocationMessageRecord } from "../../types.js";
import { renderMarkdown } from "../../../lib/markdown.js";
import { getInvocationWidgetData } from "../../lib/chat-widget-view-models.js";
import { formatChatTime } from "../../lib/chat-time.js";
import { PlanningRequestWidget } from "./widgets/PlanningRequestWidget.js";
import { ChatAvatar, type AvatarRole } from "./ChatAvatar.js";

const formatErrorCategory = (value: unknown): string | null => {
  switch (value) {
    case "RATE_LIMITED":
      return "Rate limit";
    case "QUOTA_EXHAUSTED":
      return "Quota";
    case "AUTH_FAILURE":
      return "Auth failure";
    case "PROVIDER_NOT_FOUND":
      return "Provider missing";
    case "UNKNOWN":
      return "Error";
    default:
      return null;
  }
};

export interface InvocationMessageBubbleProps {
  message: ExecutionInvocationMessageRecord;
}

export const InvocationMessageBubble: FunctionComponent<InvocationMessageBubbleProps> = ({ message }) => {
  const fromUser = message.role === "user";
  const fromTool = message.role === "tool";
  const fromSystem = message.role === "system";
  const widgetData = getInvocationWidgetData(message);

  let role: AvatarRole = "agent";
  if (fromUser || fromTool) {
    role = "user";
  } else if (fromSystem) {
    role = "system";
  } else if (message.metadata?.provider === "jules") {
    role = "jules";
  }

  const senderName = (fromUser || fromTool) ? "User" : (message.metadata?.agentName as string) || "Assistant";
  const providerLabel = message.metadata?.provider as string | undefined;
  const modelLabel = message.metadata?.model as string | undefined;
  const errorLabel = formatErrorCategory(message.metadata?.errorCategory);
  const createdAtLabel = formatChatTime(message.createdAt);

  return (
    <article className={`flex ${fromUser || fromTool ? "justify-end" : "justify-start"}`}>
      <div className={`flex max-w-[760px] items-start w-full gap-3 ${fromUser || fromTool ? "flex-row-reverse" : "flex-row"}`}>
        <div className="mt-1 shrink-0 w-8 h-8 flex items-center justify-center">
          <ChatAvatar role={role} provider={providerLabel} agentName={senderName} />
        </div>

        <div className={`flex flex-col w-full max-w-[calc(100%-3rem)] rounded-2xl border bg-white/5 backdrop-blur-md p-4 shadow-[0_2px_16px_rgba(0,0,0,0.04)] ${
          fromUser || fromTool
            ? "rounded-tr-sm border-signal-500/20"
            : "rounded-tl-sm border-white/10"
        }`}>
          {/* Header Row */}
          <div className={`flex items-center gap-3 mb-2 text-[11px] font-mono text-slate-400 ${fromUser || fromTool ? "justify-end flex-row-reverse" : "justify-start"}`}>
            <span className="font-semibold text-slate-300 capitalize">{message.role}</span>
            {providerLabel && (
              <span className="px-1.5 py-0.5 rounded-sm bg-black/20 text-slate-300">
                {providerLabel}
              </span>
            )}
            {modelLabel && (
              <span className="px-1.5 py-0.5 rounded-sm bg-black/20 text-slate-300">
                {modelLabel}
              </span>
            )}
            {errorLabel && (
              <span className="rounded-sm border border-status-amber/30 bg-status-amber/10 px-1.5 py-0.5 text-status-amber">
                {errorLabel}
              </span>
            )}
            {createdAtLabel && <span>{createdAtLabel}</span>}
          </div>

          {/* Message Body */}
          <div className="prose prose-sm max-w-none text-[14px] leading-7 text-slate-200 prose-headings:text-inherit prose-p:text-inherit prose-strong:text-inherit prose-code:text-inherit break-words"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(message.contentMarkdown || "*(No message content)*") }}
          />

          {message.toolCallsJson && (
            <div className="mt-4 rounded border border-white/10 bg-black/20 p-3 text-xs">
              <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-slate-400">
                {JSON.stringify(message.toolCallsJson, null, 2)}
              </pre>
            </div>
          )}

          {/* Widget Slot */}
          {widgetData.type === "planning" && (
            <div className="mt-4 border-t border-white/5 pt-4">
              <PlanningRequestWidget status={widgetData.status} planName={widgetData.planName} />
            </div>
          )}
        </div>
      </div>
    </article>
  );
};
