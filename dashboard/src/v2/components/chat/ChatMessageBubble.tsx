import { type FunctionComponent } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import gsap from "gsap";
import { Check, CheckCheck, XCircle, Loader2 } from "lucide-preact";
import type { ChatMessageRecord, AgentAvatarConfig } from "../../types.js";
import { renderMarkdown } from "../../../lib/markdown.js";
import { getChatWidgetData, resolveRichWidget } from "../../lib/chat-widget-view-models.js";
import { formatChatTime } from "../../lib/chat-time.js";
import { PlanningRequestWidget } from "./widgets/PlanningRequestWidget.js";
import { AppCreationProgressWidget } from "./widgets/AppCreationProgressWidget.js";
import { ExternalReferenceWidget } from "./widgets/ExternalReferenceWidget.js";
import { LiveEntityStatusWidget } from "./widgets/LiveEntityStatusWidget.js";
import { ReasoningWidget } from "./widgets/ReasoningWidget.js";
import { ToolCallWidget } from "./widgets/ToolCallWidget.js";
import { AgentMoodAside, buildAgentMoodAsideSeed, resolveAgentMoodAsideText } from "./widgets/AgentMoodAside.js";
import { ChatAvatar, type AvatarRole } from "./ChatAvatar.js";
import { PromptSuggestionTags } from "./PromptSuggestionTags.js";
import { resolveDisplayDeliveryStatus } from "../../hooks/use-chat-thread-data.js";
import { useGsapDurations } from "../../lib/motion/constants.js";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import type { ChatWidgetLiveData, ParsedTurnTokens, RichWidgetDescriptor } from "../../lib/chat-widget-view-models.js";
import type { ChatLiveEntityWidget } from "../../lib/chat-live-entities.js";
import { getPromptSuggestionViewModels } from "../../lib/chat-suggestion-view-models.js";
import { isAgentScheduledWakeup, ScheduledWakeupWidget } from "./widgets/ScheduledWakeupWidget.js";
import { SpeechReplayButton } from "../speech/SpeechReplayButton.js";

export interface ChatMessageBubbleProps {
  message: ChatMessageRecord;
  allMessages?: ChatMessageRecord[];
  agentAvatarConfig?: AgentAvatarConfig;
  agentName?: string;
  animationDelay?: number;
  widgetLiveData?: ChatWidgetLiveData;
  liveEntities?: readonly ChatLiveEntityWidget[];
  onPromptSuggestionSelect?: (prompt: string) => void;
  onReplay?: (message: ChatMessageRecord) => void;
  replaying?: boolean;
}

export const ChatMessageBubble: FunctionComponent<ChatMessageBubbleProps> = ({
  message,
  allMessages = [],
  agentAvatarConfig,
  agentName,
  animationDelay = 0,
  widgetLiveData,
  liveEntities = [],
  onPromptSuggestionSelect,
  onReplay,
  replaying = false,
}) => {
  const fromDashboard = message.direction === "dashboard_to_connection";
  const isScheduledWakeup = fromDashboard && isAgentScheduledWakeup(message.metadata);
  const widgetData = getChatWidgetData(message, widgetLiveData);
  const richWidget = resolveRichWidget({
    metadata: message.metadata,
    content: message.bodyMarkdown,
    toolCallsJson: (message.metadata?.toolCallsJson as Record<string, unknown> | undefined) ?? null,
  });
  const planningWidget: Extract<RichWidgetDescriptor, { kind: "planning" }> | null =
    richWidget.kind === "planning" ? richWidget : null;
  const hasPlanningWidget = planningWidget !== null;
  const hasExternalReferenceWidget = widgetData.type === "external_reference" && Boolean(widgetData.externalReference);
  const hasPrimaryWidget = hasPlanningWidget || hasExternalReferenceWidget;
  const hasLiveEntityWidgets = liveEntities.length > 0;
  const hasWidgetSlot = hasPrimaryWidget || hasLiveEntityWidgets;
  const widgetSlotClassName = widgetData.suppressBodyMarkdown
    ? "mt-0 space-y-4"
    : "mt-4 border-t border-white/5 pt-4 space-y-4";
  const promptSuggestions = !fromDashboard
    ? getPromptSuggestionViewModels(message.metadata)
    : [];

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

  if (richWidget.kind === "reasoning") {
    return (
      <div className="flex justify-start">
        <div className="w-full max-w-full lg:max-w-[760px] min-w-0 pl-11">
          <ReasoningWidget text={richWidget.text} />
        </div>
      </div>
    );
  }

  if (richWidget.kind === "tool") {
    const tokens: ParsedTurnTokens | null = richWidget.tokens;
    return (
      <div className="flex justify-start">
        <div className="w-full max-w-full lg:max-w-[760px] min-w-0 pl-11">
          <ToolCallWidget
            toolName={richWidget.toolName}
            status={richWidget.status}
            args={richWidget.args}
            output={richWidget.output}
            tokens={tokens}
            callId={richWidget.callId}
          />
        </div>
      </div>
    );
  }

  let role: AvatarRole = "agent";
  if (fromDashboard) {
    role = "user";
  } else if (message.authorType === "system") {
    role = "system";
  } else if (message.metadata?.provider === "jules" || message.authorType === "connection") {
    role = agentAvatarConfig ? "agent" : "jules";
  }

  const senderName = fromDashboard
    ? isScheduledWakeup ? "Project Manager" : "User"
    : agentName || (message.metadata?.agentName as string) || "Assistant";
  const providerLabel = message.metadata?.provider as string | undefined;
  const createdAtLabel = formatChatTime(message.createdAt);
  const moodAsideText = (!fromDashboard && message.authorType === "connection")
    ? resolveAgentMoodAsideText({
        metadata: message.metadata,
        seed: buildAgentMoodAsideSeed([message.id, message.bodyMarkdown, senderName]),
      })
    : null;

  const displayDeliveryStatus = resolveDisplayDeliveryStatus(message, allMessages);

  const opacityClass = (fromDashboard && (displayDeliveryStatus === "pending" || displayDeliveryStatus === "failed"))
    ? "opacity-60"
    : "opacity-100";

  return (
    <div ref={bubbleRef} className={`flex ${fromDashboard ? "justify-end" : "justify-start"} ${opacityClass}`}>
      <span className="sr-only">
        From {senderName} at {createdAtLabel}. Status: {displayDeliveryStatus}.
      </span>
      <div className={`flex max-w-[760px] items-start gap-3 w-full ${fromDashboard ? "flex-row-reverse" : "flex-row"}`}>
        <div className="mt-1 shrink-0 w-8 h-8 flex items-center justify-center">
          <ChatAvatar
            role={role}
            provider={providerLabel}
            agentName={!fromDashboard ? agentName || senderName : undefined}
            avatarConfig={!fromDashboard ? agentAvatarConfig : undefined}
          />
        </div>

        <div className={`flex flex-col min-w-0 w-full max-w-[calc(100%-3rem)] rounded-2xl border backdrop-blur-md p-4 shadow-[0_2px_16px_rgba(0,0,0,0.04)] ${
          isScheduledWakeup
            ? "rounded-tr-sm border-violet-500/25 bg-violet-500/[0.05] dark:bg-violet-400/[0.08]"
            : fromDashboard
            ? "rounded-tr-sm border-signal-500/20 bg-signal-500/[0.08] dark:bg-signal-500/[0.1]"
            : "rounded-tl-sm border-slate-200/60 dark:border-white/10 bg-slate-100/80 dark:bg-white/5"
        }`}>
          {/* Header Row */}
          <div className={`flex items-center gap-2 mb-1.5 text-xs text-slate-500 dark:text-slate-400 ${fromDashboard ? "justify-end flex-row-reverse" : "justify-start"}`}>
            <span className="font-semibold text-slate-900 dark:text-slate-300">{senderName}</span>
            {providerLabel && (
              <span className="px-1.5 py-0.5 rounded-sm bg-slate-200 text-slate-600 dark:bg-black/20 dark:text-slate-300 truncate max-w-[150px] inline-block">
                {providerLabel}
              </span>
            )}
            {createdAtLabel && <span>{createdAtLabel}</span>}
            {!fromDashboard && onReplay && !widgetData.suppressBodyMarkdown && message.bodyMarkdown.trim() && (
              <SpeechReplayButton
                busy={replaying}
                label={`Replay message from ${senderName}`}
                onReplay={() => onReplay(message)}
              />
            )}
          </div>

          {/* Message Body */}
          {isScheduledWakeup ? (
            <ScheduledWakeupWidget
              instruction={message.bodyMarkdown}
              status={displayDeliveryStatus}
              scheduledFor={typeof message.metadata?.scheduledFor === "string" ? message.metadata.scheduledFor : null}
            />
          ) : !widgetData.suppressBodyMarkdown && (
            <div className="prose prose-sm max-w-none text-[14px] leading-7 text-slate-800 dark:text-slate-200 prose-headings:text-inherit prose-p:text-inherit prose-strong:text-inherit prose-code:text-inherit prose-pre:overflow-x-auto break-words overflow-wrap-anywhere min-w-0"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(message.bodyMarkdown) }}
            />
          )}

          <AgentMoodAside text={moodAsideText} />

          {promptSuggestions.length > 0 && (
            <PromptSuggestionTags
              suggestions={promptSuggestions}
              onSelect={(suggestion) => onPromptSuggestionSelect?.(suggestion.prompt)}
              className="mt-3"
            />
          )}

          {/* Widget Slot */}
          {hasWidgetSlot && (
            <div className={widgetSlotClassName}>
              {hasPlanningWidget && (
                <PlanningRequestWidget
                  status={planningWidget.status}
                  planName={planningWidget.planName}
                  liveStatus={widgetData.liveStatus}
                />
              )}
              {hasExternalReferenceWidget && widgetData.externalReference && (
                <ExternalReferenceWidget status={widgetData.status} reference={widgetData.externalReference} />
              )}
              {hasLiveEntityWidgets && (
                <div className={hasPrimaryWidget ? "border-t border-white/5 pt-4" : undefined}>
                  <LiveEntityStatusWidget entities={liveEntities} />
                </div>
              )}
            </div>
          )}

          {widgetData.type === "app_creation_progress" && widgetData.appCreationProgress && (
            <div className="mt-4 border-t border-white/5 pt-4">
              <AppCreationProgressWidget progress={widgetData.appCreationProgress} />
            </div>
          )}

          {fromDashboard && !isScheduledWakeup && (
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
