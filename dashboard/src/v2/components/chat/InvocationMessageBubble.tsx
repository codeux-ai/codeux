import { type FunctionComponent } from "preact";
import { Cloud } from "lucide-preact";
import type { ExecutionInvocationMessageRecord } from "../../types.js";
import { renderMarkdown } from "../../../lib/markdown.js";
import { getInvocationWidgetData, sanitizeInvocationOutputText } from "../../lib/chat-widget-view-models.js";
import { formatChatTime } from "../../lib/chat-time.js";
import { PlanningRequestWidget } from "./widgets/PlanningRequestWidget.js";
import { ToolCallWidget } from "./widgets/ToolCallWidget.js";
import { ReasoningWidget } from "./widgets/ReasoningWidget.js";
import { ChatAvatar, type AvatarRole } from "./ChatAvatar.js";
import type { ParsedTurnTokens } from "../../lib/chat-widget-view-models.js";
import type { AgentAvatarConfig } from "../../types.js";

const asString = (value: unknown): string | null => (typeof value === "string" ? value : null);

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
  agentAvatarConfig?: AgentAvatarConfig | null;
  agentName?: string | null;
}

export const InvocationMessageBubble: FunctionComponent<InvocationMessageBubbleProps> = ({
  message,
  agentAvatarConfig,
  agentName,
}) => {
  const fromUser = message.role === "user";
  const fromTool = message.role === "tool";
  const fromSystem = message.role === "system";
  const widgetData = getInvocationWidgetData(message);
  const kind = asString(message.metadata?.kind);

  // Reasoning and tool turns render as compact, full-width activity cards
  // rather than chat bubbles, so the transcript reads like the real session.
  if (kind === "reasoning") {
    return (
      <div class="flex justify-start">
        <div class="w-full max-w-full lg:max-w-[760px] min-w-0 pl-11">
          <ReasoningWidget text={message.contentMarkdown || ""} />
        </div>
      </div>
    );
  }

  if (kind === "tool_call" || kind === "tool_result") {
    const tool = (message.toolCallsJson ?? {}) as Record<string, unknown>;
    const args = sanitizeInvocationOutputText(asString(tool.arguments) || "");
    const output = sanitizeInvocationOutputText(asString(tool.output) || "");
    const status = asString(message.metadata?.toolStatus) ?? asString(tool.resultStatus);
    const tokens = (message.metadata?.tokens ?? null) as ParsedTurnTokens | null;
    return (
      <div class="flex justify-start">
        <div class="w-full max-w-full lg:max-w-[760px] min-w-0 pl-11">
          <ToolCallWidget
            toolName={asString(message.metadata?.toolName)}
            status={status}
            args={args}
            output={output}
            tokens={tokens}
            callId={asString(message.metadata?.toolCallId)}
          />
        </div>
      </div>
    );
  }

  let role: AvatarRole = "agent";
  if (fromUser || fromTool) {
    role = "user";
  } else if (fromSystem) {
    role = "system";
  } else if (message.metadata?.provider === "jules") {
    role = "jules";
  }

  const senderName = (fromUser || fromTool) ? "User" : agentName || (message.metadata?.agentName as string) || "Assistant";
  const providerLabel = message.metadata?.provider as string | undefined;
  const modelLabel = message.metadata?.model as string | undefined;
  const rawStatus = typeof message.metadata?.status === "string" ? message.metadata.status : null;
  const hasInvocationResponse = Boolean(message.metadata?.response);
  const displayStatus = rawStatus === "queued" && hasInvocationResponse ? "processed" : rawStatus;
  const errorLabel = formatErrorCategory(message.metadata?.errorCategory);
  const createdAtLabel = formatChatTime(message.createdAt);
  const isExternalApi = Boolean(message.metadata?.isExternalApi);

  return (
    <div className={`flex ${fromUser || fromTool ? "justify-end" : "justify-start"}`}>
      <span className="sr-only">
        From {senderName} at {createdAtLabel}. {displayStatus ? `Status: ${displayStatus}.` : ""} {errorLabel ? `Error: ${errorLabel}.` : ""}
      </span>
      <div className={`flex min-w-0 max-w-full sm:max-w-xl md:max-w-2xl lg:max-w-[760px] items-start w-full gap-3 ${fromUser || fromTool ? "flex-row-reverse" : "flex-row"}`}>
        <div className="mt-1 shrink-0 w-8 h-8 flex items-center justify-center">
          <ChatAvatar
            role={role}
            provider={providerLabel}
            agentName={senderName}
            avatarConfig={message.role === "assistant" ? (agentAvatarConfig ?? undefined) : undefined}
          />
        </div>

        <article className={`flex flex-col min-w-0 w-full max-w-[calc(100%-3rem)] rounded-[1.35rem] border backdrop-blur-xl p-4 shadow-[0_12px_34px_rgba(15,23,42,0.06)] dark:shadow-[0_14px_42px_rgba(0,0,0,0.22)] ${
          fromUser || fromTool
            ? "rounded-tr-md border-signal-500/22 bg-signal-500/[0.075] dark:bg-signal-500/[0.095]"
            : fromSystem
              ? "rounded-tl-md border-dashed border-status-amber/25 bg-status-amber/[0.045] dark:bg-status-amber/[0.06]"
              : "rounded-tl-md border-black/[0.06] bg-white/72 dark:border-white/[0.08] dark:bg-white/[0.045]"
        }`}>
          <header className={`mb-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400 ${fromUser || fromTool ? "justify-end flex-row-reverse" : "justify-start"}`}>
            <span className={`flex min-w-0 items-center gap-1.5 truncate font-semibold text-slate-900 dark:text-slate-200 ${message.role === "assistant" && agentName ? "" : "capitalize"}`}>
              {message.role === "assistant" && agentName ? agentName : message.role}
              {isExternalApi && <Cloud className="h-3 w-3 text-signal-500" />}
            </span>
            {providerLabel && (
              <span className="inline-block max-w-[14rem] truncate rounded-md bg-black/[0.045] px-1.5 py-0.5 font-mono text-[10px] text-slate-500 dark:bg-black/20 dark:text-slate-300">
                {providerLabel}
              </span>
            )}
            {modelLabel && (
              <span className="inline-block max-w-[16rem] truncate rounded-md bg-black/[0.045] px-1.5 py-0.5 font-mono text-[10px] text-slate-500 dark:bg-black/20 dark:text-slate-300">
                {modelLabel}
              </span>
            )}
            {displayStatus && (
              <span className="rounded-md bg-black/[0.045] px-1.5 py-0.5 font-mono text-[10px] capitalize text-slate-500 dark:bg-black/20 dark:text-slate-300">
                {displayStatus}
              </span>
            )}
            {errorLabel && (
              <span className="rounded-md border border-status-amber/30 bg-status-amber/10 px-1.5 py-0.5 font-mono text-[10px] text-status-amber">
                {errorLabel}
              </span>
            )}
            {createdAtLabel && <time dateTime={message.createdAt} className="font-mono text-[10px] text-slate-400 dark:text-slate-500">{createdAtLabel}</time>}
          </header>

          <div className="prose prose-sm max-w-none min-w-0 text-[14px] leading-7 text-slate-800 [overflow-wrap:anywhere] dark:text-slate-200 prose-headings:text-inherit prose-p:text-inherit prose-strong:text-inherit prose-code:break-words prose-code:text-inherit prose-pre:max-w-full prose-pre:overflow-x-auto prose-pre:whitespace-pre"
            dangerouslySetInnerHTML={{
              __html: renderMarkdown(sanitizeInvocationOutputText(message.contentMarkdown || "*(No message content)*")),
            }}
          />

          {message.toolCallsJson && !kind && (
            <div className="mt-4 rounded-xl border border-black/[0.06] bg-black/[0.035] p-3 text-xs dark:border-white/[0.08] dark:bg-black/20">
              <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-slate-600 dark:text-slate-400">
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
        </article>
      </div>
    </div>
  );
};
