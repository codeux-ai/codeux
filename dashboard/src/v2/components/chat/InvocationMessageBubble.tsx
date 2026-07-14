import { type FunctionComponent } from "preact";
import { Cloud } from "lucide-preact";
import type { ExecutionInvocationMessageRecord } from "../../types.js";
import { renderMarkdown } from "../../../lib/markdown.js";
import {
  getInvocationWidgetData,
  getReasoningWidgetData,
  getSelfReflectionWidgetData,
  resolveRichWidget,
  sanitizeInvocationOutputText,
} from "../../lib/chat-widget-view-models.js";
import { formatChatTime } from "../../lib/chat-time.js";
import { PlanningRequestWidget } from "./widgets/PlanningRequestWidget.js";
import { ExternalReferenceWidget } from "./widgets/ExternalReferenceWidget.js";
import { ToolCallWidget } from "./widgets/ToolCallWidget.js";
import { ReasoningWidget } from "./widgets/ReasoningWidget.js";
import { SelfReflectionWidget } from "./widgets/SelfReflectionWidget.js";
import { LiveEntityStatusWidget } from "./widgets/LiveEntityStatusWidget.js";
import { AgentMoodAside, buildAgentMoodAsideSeed, resolveAgentMoodAsideText } from "./widgets/AgentMoodAside.js";
import { ChatAvatar, type AvatarRole } from "./ChatAvatar.js";
import type { ChatWidgetLiveData, RichWidgetDescriptor } from "../../lib/chat-widget-view-models.js";
import type { ChatLiveEntityWidget } from "../../lib/chat-live-entities.js";
import type { AgentAvatarConfig } from "../../types.js";
import { SpeechReplayButton } from "../speech/SpeechReplayButton.js";
import { useDashboardI18n } from "../../i18n/context.js";
import { chatMessages } from "../../i18n/messages/chat.js";

const asString = (value: unknown): string | null => (typeof value === "string" ? value : null);

const formatErrorCategory = (value: unknown, translate: ReturnType<typeof useDashboardI18n>["translate"]): string | null => {
  switch (value) {
    case "RATE_LIMITED":
      return translate(chatMessages, "rateLimit");
    case "QUOTA_EXHAUSTED":
      return translate(chatMessages, "quota");
    case "AUTH_FAILURE":
      return translate(chatMessages, "authFailure");
    case "PROVIDER_NOT_FOUND":
      return translate(chatMessages, "providerMissing");
    case "UNKNOWN":
      return translate(chatMessages, "error");
    default:
      return null;
  }
};

export interface InvocationMessageBubbleProps {
  message: ExecutionInvocationMessageRecord;
  agentAvatarConfig?: AgentAvatarConfig | null;
  agentName?: string | null;
  widgetLiveData?: ChatWidgetLiveData;
  liveEntities?: readonly ChatLiveEntityWidget[];
  onReplay?: (message: ExecutionInvocationMessageRecord) => void;
  replaying?: boolean;
}

export const InvocationMessageBubble: FunctionComponent<InvocationMessageBubbleProps> = ({
  message,
  agentAvatarConfig,
  agentName,
  widgetLiveData,
  liveEntities = [],
  onReplay,
  replaying = false,
}) => {
  const { locale, translate } = useDashboardI18n();
  const fromUser = message.role === "user";
  const fromTool = message.role === "tool";
  const fromSystem = message.role === "system";
  const widgetData = getInvocationWidgetData(message, widgetLiveData, locale);
  const richWidget: RichWidgetDescriptor = resolveRichWidget({
    metadata: message.metadata,
    content: message.contentMarkdown,
    toolCallsJson: message.toolCallsJson,
    locale,
  });
  const metadataKind = asString(message.metadata?.kind);
  const reflectionWidgetData = getSelfReflectionWidgetData(message, locale);

  // Reasoning and tool turns render as compact, full-width activity cards
  // rather than chat bubbles, so the transcript reads like the real session.
  switch (richWidget.kind) {
    case "reasoning": {
      const reasoningWidgetData = getReasoningWidgetData(message, locale);
      return (
        <div class="flex justify-start">
          <div class="w-full max-w-full lg:max-w-[760px] min-w-0 pl-11">
            <ReasoningWidget
              {...reasoningWidgetData}
              text={sanitizeInvocationOutputText(richWidget.text)}
            />
          </div>
        </div>
      );
    }
    case "tool":
      return (
        <div class="flex justify-start">
          <div class="w-full max-w-full lg:max-w-[760px] min-w-0 pl-11">
            <ToolCallWidget
              toolName={richWidget.toolName}
              status={richWidget.status}
              args={richWidget.args}
              output={richWidget.output}
              tokens={richWidget.tokens}
              callId={richWidget.callId}
            />
          </div>
        </div>
      );
    default:
      break;
  }

  if (reflectionWidgetData) {
    return (
      <div class="flex justify-start">
        <div class="w-full max-w-full lg:max-w-[760px] min-w-0 pl-11">
          <SelfReflectionWidget reflection={reflectionWidgetData} />
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

  const senderName = (fromUser || fromTool) ? translate(chatMessages, "user") : agentName || (message.metadata?.agentName as string) || translate(chatMessages, "assistant");
  const providerLabel = message.metadata?.provider as string | undefined;
  const modelLabel = message.metadata?.model as string | undefined;
  const rawStatus = typeof message.metadata?.status === "string" ? message.metadata.status : null;
  const hasInvocationResponse = Boolean(message.metadata?.response);
  const displayStatus = rawStatus === "queued" && hasInvocationResponse ? "processed" : rawStatus;
  const errorLabel = formatErrorCategory(message.metadata?.errorCategory, translate);
  const createdAtLabel = formatChatTime(message.createdAt, locale);
  const isExternalApi = Boolean(message.metadata?.isExternalApi);
  const hasPrimaryWidget = richWidget.kind === "planning"
    || (widgetData.type === "external_reference" && Boolean(widgetData.externalReference));
  const hasLiveEntities = !fromTool && liveEntities.length > 0;
  const liveEntitySlotClass = hasPrimaryWidget
    ? "mt-3"
    : widgetData.suppressBodyMarkdown ? "mt-0" : "mt-4 border-t border-white/5 pt-4";
  const moodAsideText = message.role === "assistant"
    ? resolveAgentMoodAsideText({
        metadata: message.metadata,
        seed: buildAgentMoodAsideSeed([message.id, message.contentMarkdown, senderName]),
        locale,
      })
    : null;

  return (
    <div className={`flex ${fromUser || fromTool ? "justify-end" : "justify-start"}`}>
      <span className="sr-only">
        {translate(chatMessages, "fromSenderAtTime", { sender: senderName, time: createdAtLabel, status: displayStatus ?? "—" })} {errorLabel ? `${translate(chatMessages, "error")}: ${errorLabel}.` : ""}
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

        <div className={`flex flex-col min-w-0 w-full max-w-[calc(100%-3rem)] rounded-2xl border backdrop-blur-md p-4 shadow-[0_2px_16px_rgba(0,0,0,0.04)] ${
          fromUser || fromTool
            ? "rounded-tr-sm border-signal-500/20 bg-signal-500/[0.08] dark:bg-signal-500/[0.1]"
            : "rounded-tl-sm border-slate-200/60 dark:border-white/10 bg-slate-100/80 dark:bg-white/5"
        }`}>
          {/* Header Row */}
          <div className={`flex flex-wrap items-center gap-2 mb-1.5 text-xs text-slate-500 dark:text-slate-400 ${fromUser || fromTool ? "justify-end flex-row-reverse" : "justify-start"}`}>
            <span className={`font-semibold text-slate-900 dark:text-slate-300 flex items-center gap-1.5 ${message.role === "assistant" && agentName ? "" : "capitalize"}`}>
              {message.role === "assistant" && agentName ? agentName : message.role}
              {isExternalApi && <Cloud className="h-3 w-3 text-signal-500" />}
            </span>
            {providerLabel && (
              <span className="px-1.5 py-0.5 rounded-sm bg-slate-200 text-slate-600 dark:bg-black/20 dark:text-slate-300 truncate max-w-[150px] inline-block">
                {providerLabel}
              </span>
            )}
            {modelLabel && (
              <span className="px-1.5 py-0.5 rounded-sm bg-slate-200 text-slate-600 dark:bg-black/20 dark:text-slate-300 truncate max-w-[150px] inline-block">
                {modelLabel}
              </span>
            )}
            {displayStatus && (
              <span className="px-1.5 py-0.5 rounded-sm bg-slate-200 text-slate-600 dark:bg-black/20 dark:text-slate-300 capitalize">
                {displayStatus}
              </span>
            )}
            {errorLabel && (
              <span className="rounded-sm border border-status-amber/30 bg-status-amber/10 px-1.5 py-0.5 text-status-amber">
                {errorLabel}
              </span>
            )}
            {createdAtLabel && <span>{createdAtLabel}</span>}
            {message.role === "assistant" && onReplay && !widgetData.suppressBodyMarkdown && message.contentMarkdown.trim() && (
              <SpeechReplayButton
                busy={replaying}
                label={translate(chatMessages, "replayMessageFrom", { sender: senderName })}
                onReplay={() => onReplay(message)}
              />
            )}
          </div>

          {/* Message Body */}
          {!widgetData.suppressBodyMarkdown && (
            <div className="prose prose-sm max-w-none text-[14px] leading-7 text-slate-800 dark:text-slate-200 prose-headings:text-inherit prose-p:text-inherit prose-strong:text-inherit prose-code:text-inherit prose-pre:overflow-x-auto prose-code:overflow-x-auto break-words overflow-wrap-anywhere min-w-0"
              dangerouslySetInnerHTML={{
                __html: renderMarkdown(sanitizeInvocationOutputText(message.contentMarkdown || `*${translate(chatMessages, "noMessageContent")}*`)),
              }}
            />
          )}

          <AgentMoodAside text={moodAsideText} />

          {message.toolCallsJson && !metadataKind && (
            <div className="mt-4 rounded border border-slate-200 bg-slate-200/30 p-3 text-xs dark:border-white/10 dark:bg-black/20">
              <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-slate-600 dark:text-slate-400">
                {JSON.stringify(message.toolCallsJson, null, 2)}
              </pre>
            </div>
          )}

          {/* Widget Slot */}
          {richWidget.kind === "planning" && (
            <div className="mt-4 border-t border-white/5 pt-4">
              <PlanningRequestWidget
                status={richWidget.status}
                planName={richWidget.planName}
                liveStatus={widgetData.liveStatus}
                executionPlan={widgetData.executionPlan}
              />
            </div>
          )}
          {widgetData.type === "external_reference" && widgetData.externalReference && (
            <div className={widgetData.suppressBodyMarkdown ? "mt-0" : "mt-4 border-t border-white/5 pt-4"}>
              <ExternalReferenceWidget status={widgetData.status} reference={widgetData.externalReference} />
            </div>
          )}
          {hasLiveEntities && (
            <div className={liveEntitySlotClass}>
              <LiveEntityStatusWidget entities={liveEntities} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
