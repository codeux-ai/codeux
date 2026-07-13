import type { FunctionComponent, RefObject } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import { AlertTriangle, ArrowUp, BriefcaseBusiness, Gauge, Gamepad2, GitBranch, Globe2, History, LayoutDashboard, ListTodo, Monitor, Radar, RefreshCw, Rocket, ShoppingCart, Sparkles, Volume2, VolumeX, WandSparkles, Wrench } from "lucide-preact";
import type { AgentPresetRecord, ChatMessageRecord, ChatThread, DashboardCreateAppQuickactionKind, ExecutionInvocationRecord, Source } from "../../../types.js";
import { renderMarkdown } from "../../../../lib/markdown.js";
import { formatChatTime } from "../../../lib/chat-time.js";
import { getChatWidgetData } from "../../../lib/chat-widget-view-models.js";
import { PlanningRequestWidget } from "../widgets/PlanningRequestWidget.js";
import { ExternalReferenceWidget } from "../widgets/ExternalReferenceWidget.js";
import { LazyAgentAvatarScene } from "../../agents/LazyAgentAvatarScene.js";
import { DEFAULT_AGENT_AVATAR_CONFIG } from "../../../lib/agent-avatar.js";
import { useReducedMotion } from "../../../hooks/use-reduced-motion.js";
import { resolveDisplayDeliveryStatus } from "../../../hooks/use-chat-thread-data.js";
import { useAgentMood, type AgentMoodState } from "./use-agent-mood.js";
import { AgentAmbientEffects } from "./AgentAmbientEffects.js";
import { parseBubbleSegments, StageWidgetRenderer } from "./StageWidgets.js";
import { isAgentScheduledWakeup, ScheduledWakeupWidget } from "../widgets/ScheduledWakeupWidget.js";
import { buildCinematicQuickActions } from "../../../lib/cinematic-quick-actions.js";
import { useProjectEffectiveSettings } from "../../../hooks/use-project-effective-settings.js";
import { SpeechInputButton } from "../../speech/SpeechInputButton.js";
import { SpeechReplayButton } from "../../speech/SpeechReplayButton.js";
import { useSpeechPlayback } from "../../../hooks/use-speech-playback.js";
import { speechTextFromMarkdown } from "../../../lib/speech-playback.js";
import type { AgentResponseEffect } from "../../../../../../src/contracts/connection-chat-types.js";
import {
  getAgentResponseEffectCaption,
  resolveAgentResponseEffect,
} from "../../../lib/agent-response-effects.js";
import { STAGE_ACTIVITY_MESSAGE_MIN_INTERVAL_MS } from "../../../lib/agent-humor-messages.js";
import { resolveCinematicActivityDisplayState } from "../../../lib/cinematic-activity.js";
import { StageActivityStrip } from "./StageActivityStrip.js";
import { useCinematicWorkTool } from "./use-cinematic-work-tool.js";
import { useCinematicInvocationFeedback } from "../../../hooks/use-cinematic-invocation-feedback.js";
import { CinematicInvocationProgressBubble } from "./CinematicInvocationProgressBubble.js";

/* ════════════════════════════════════════════════════════════════════════
 *  CinematicStage — the default "3D Chat" view of the chat page.
 *
 *  Layout (desktop):
 *  ┌──────────────────────────────────────────────────────────────┐
 *  │  thread chip                                    open threads │
 *  │        ☁ thought bubble                                      │
 *  │   ┌───────────┐   ┌────────────────────────────────────┐    │
 *  │   │  3D agent │   │  conversation canvas (speech        │    │
 *  │   │  (stage)  │◄──│  bubbles, rich widgets, history     │    │
 *  │   │           │   │  fading upward)                     │    │
 *  │   └───────────┘   └────────────────────────────────────┘    │
 *  │   name plate · live mood caption                             │
 *  │                 ╭──────────── composer pill ───────────╮     │
 *  └──────────────────────────────────────────────────────────────┘
 *
 *  The bot's expression + caption come from useAgentMood, which only ever
 *  reflects real runtime state (routing, container spin-up, replies,
 *  errors, idle decay). Reduced motion falls back to the static SVG bot.
 * ════════════════════════════════════════════════════════════════════════ */

export interface CinematicStageProps {
  selectedProject: Source | null;
  selectedThread: ChatThread | null;
  messages: ChatMessageRecord[];
  threadMessagesLoading: boolean;
  hasAwaitedReply: boolean;
  invocations: ExecutionInvocationRecord[];
  sending: boolean;
  error: string | null;
  input: string;
  setInput: (value: string) => void;
  onSpeechTranscript: (text: string) => void;
  handleSend: (overrideText?: string) => Promise<void>;
  handleCreateAppQuickaction: (kind: DashboardCreateAppQuickactionKind) => Promise<void>;
  initialEligibilityLoaded: boolean;
  canCreateInitialAppQuickactions: boolean;
  navigateHistory: (direction: "up" | "down") => boolean;
  composerRef: RefObject<HTMLTextAreaElement>;
  activeConnection: { displayName: string; status: string } | null;
  agentPreset?: AgentPresetRecord;
  onOpenThreads: () => void;
}

const CREATE_APP_ACTION_ICONS: Record<DashboardCreateAppQuickactionKind, typeof Monitor> = {
  web_app: Globe2,
  desktop_app: Monitor,
  online_shop: ShoppingCart,
  portfolio: BriefcaseBusiness,
  game: Gamepad2,
};

const PROMPT_ACTION_ICONS: Record<string, typeof Monitor> = {
  "status-report": Gauge,
  "sprint-progress": Rocket,
  "whats-failing": AlertTriangle,
  "plan-next-steps": ListTodo,
  "add-nodes-workflow": GitBranch,
  "add-dashboard": LayoutDashboard,
  "create-skill": WandSparkles,
  "list-skills": Wrench,
};

const QUICK_ACTION_ICON_STYLES: Record<string, string> = {
  "create-web_app": "bg-sky-500/12 text-sky-600 ring-sky-500/20 dark:bg-sky-400/12 dark:text-sky-300",
  "create-desktop_app": "bg-indigo-500/12 text-indigo-600 ring-indigo-500/20 dark:bg-indigo-400/12 dark:text-indigo-300",
  "create-online_shop": "bg-amber-500/14 text-amber-700 ring-amber-500/25 dark:bg-amber-400/12 dark:text-amber-300",
  "create-portfolio": "bg-rose-500/12 text-rose-600 ring-rose-500/20 dark:bg-rose-400/12 dark:text-rose-300",
  "create-game": "bg-fuchsia-500/12 text-fuchsia-600 ring-fuchsia-500/20 dark:bg-fuchsia-400/12 dark:text-fuchsia-300",
  "status-report": "bg-cyan-500/12 text-cyan-700 ring-cyan-500/20 dark:bg-cyan-400/12 dark:text-cyan-300",
  "sprint-progress": "bg-violet-500/12 text-violet-600 ring-violet-500/20 dark:bg-violet-400/12 dark:text-violet-300",
  "whats-failing": "bg-red-500/10 text-red-600 ring-red-500/20 dark:bg-red-400/10 dark:text-red-300",
  "plan-next-steps": "bg-orange-500/12 text-orange-700 ring-orange-500/20 dark:bg-orange-400/12 dark:text-orange-300",
  "add-nodes-workflow": "bg-lime-500/12 text-lime-700 ring-lime-500/20 dark:bg-lime-400/12 dark:text-lime-300",
  "add-dashboard": "bg-blue-500/12 text-blue-600 ring-blue-500/20 dark:bg-blue-400/12 dark:text-blue-300",
  "create-skill": "bg-purple-500/12 text-purple-600 ring-purple-500/20 dark:bg-purple-400/12 dark:text-purple-300",
  "list-skills": "bg-teal-500/12 text-teal-700 ring-teal-500/20 dark:bg-teal-400/12 dark:text-teal-300",
};

const QUICK_ACTION_SCATTER_STYLES: Record<string, string> = {
  "create-web_app": "md:ml-0 md:mt-0",
  "create-desktop_app": "md:ml-3 md:-mt-1",
  "create-online_shop": "md:ml-5 md:mt-1",
  "create-portfolio": "md:ml-3 md:-mt-0.5",
  "create-game": "md:ml-12 md:mt-1",
  "status-report": "md:ml-1 md:mt-0",
  "sprint-progress": "md:ml-5 md:-mt-1",
  "whats-failing": "md:ml-8 md:mt-1",
  "plan-next-steps": "md:ml-2 md:-mt-0.5",
  "add-nodes-workflow": "md:ml-0 md:mt-0",
  "add-dashboard": "md:ml-4 md:-mt-1",
  "create-skill": "md:ml-8 md:mt-1",
  "list-skills": "md:ml-6 md:-mt-0.5",
};

const QUICK_ACTION_GROUPS = [
  { zone: "create", label: "Create" },
  { zone: "insight", label: "Project pulse" },
  { zone: "workflow", label: "Workflows" },
] as const;

const canSpeakAgentMessage = (message: ChatMessageRecord): boolean => (
  !getChatWidgetData(message).suppressBodyMarkdown
  && speechTextFromMarkdown(message.bodyMarkdown || "").length > 0
);

/** GSAP entrance shared by bubbles — mirrors ChatMessageBubble's timing. */
function useBubbleEnter(ref: RefObject<HTMLElement>, reducedMotion: boolean) {
  useLayoutEffect(() => {
    if (!ref.current) return;
    gsap.fromTo(
      ref.current,
      { opacity: 0, y: reducedMotion ? 0 : 14, scale: reducedMotion ? 1 : 0.98 },
      { opacity: 1, y: 0, scale: 1, duration: 0.5, ease: "power3.out" },
    );
  }, []);
}

/** Markdown container classes shared by agent bubbles — includes glass table
 *  styling for GFM tables (agents report sprints/status as tables today). */
const BUBBLE_MARKDOWN_CLASSES = [
  "prose max-w-none break-words text-slate-800 dark:text-slate-200",
  "prose-headings:text-inherit prose-p:text-inherit prose-strong:text-inherit prose-code:text-inherit prose-pre:overflow-x-auto",
  "[&_table]:my-3 [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_table]:border-collapse",
  "[&_th]:whitespace-nowrap [&_th]:border-b [&_th]:border-black/10 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-[10px] [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-[0.12em] [&_th]:text-slate-500",
  "[&_td]:border-b [&_td]:border-black/[0.05] [&_td]:px-3 [&_td]:py-2 [&_td]:text-[13px]",
  "dark:[&_th]:border-white/10 dark:[&_th]:text-slate-400 dark:[&_td]:border-white/[0.06]",
].join(" ");

/* ── Agent speech bubble — the single spotlight reply beside the bot.
 *  Only the latest agent message is ever staged; long replies scroll
 *  INSIDE the bubble so the stage composition never breaks. ── */
const AgentSpeechBubble: FunctionComponent<{
  message: ChatMessageRecord;
  agentName: string;
  onAction?: (prompt: string) => void;
  onReplay: (message: ChatMessageRecord) => void;
  replaying: boolean;
}> = ({ message, agentName, onAction, onReplay, replaying }) => {
  const ref = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  useBubbleEnter(ref, reducedMotion);
  const widgetData = getChatWidgetData(message);
  const createdAtLabel = formatChatTime(message.createdAt);
  const segments = parseBubbleSegments(message.bodyMarkdown || "");

  return (
    <div ref={ref} className="relative flex min-h-0 justify-start">
      {/* Tail — points left toward the bot on desktop */}
      <span
        aria-hidden="true"
        className="absolute -left-1.5 top-7 hidden h-3.5 w-3.5 rotate-45 border-b border-l border-signal-500/25 bg-white/95 dark:bg-void-800/95 md:block"
      />
      <div className="flex min-h-0 w-full max-w-[720px] flex-col rounded-3xl rounded-tl-lg border border-signal-500/25 bg-white/95 p-5 shadow-[0_12px_48px_rgba(0,224,160,0.10),0_4px_24px_rgba(0,0,0,0.06)] backdrop-blur-md dark:bg-void-800/95 dark:shadow-[0_12px_48px_rgba(0,224,160,0.08),0_8px_32px_rgba(0,0,0,0.35)] lg:max-w-[680px] xl:max-w-[780px] 2xl:max-w-[880px]">
        <div className="mb-2 flex shrink-0 items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
          <span className="text-signal-600 dark:text-signal-400">{agentName}</span>
          {createdAtLabel && <span className="font-mono font-normal tracking-normal">{createdAtLabel}</span>}
          {canSpeakAgentMessage(message) && (
            <SpeechReplayButton
              busy={replaying}
              label={`Replay message from ${agentName}`}
              onReplay={() => onReplay(message)}
            />
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
          {segments.map((segment, index) =>
            segment.kind === "agent" ? null : segment.kind === "widget" ? (
              <StageWidgetRenderer key={index} widget={segment.widget} onAction={onAction} />
            ) : (
              !widgetData.suppressBodyMarkdown && (
                <div
                  key={index}
                  className={`${BUBBLE_MARKDOWN_CLASSES} prose-base text-[15px] leading-8 lg:text-base lg:leading-8 xl:text-[17px] xl:leading-9 2xl:text-lg 2xl:leading-9`}
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(segment.markdown) }}
                />
              )
            ),
          )}
          {widgetData.type === "planning" && (
            <div className="mt-4 border-t border-black/[0.05] pt-4 dark:border-white/[0.06]">
              <PlanningRequestWidget status={widgetData.status} planName={widgetData.planName} />
            </div>
          )}
          {widgetData.type === "external_reference" && widgetData.externalReference && (
            <div className={widgetData.suppressBodyMarkdown ? "mt-0" : "mt-4 border-t border-black/[0.05] pt-4 dark:border-white/[0.06]"}>
              <ExternalReferenceWidget status={widgetData.status} reference={widgetData.externalReference} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/* ── User bubble — compact jade pill on the right ── */
const UserBubble: FunctionComponent<{
  message: ChatMessageRecord;
  allMessages: ChatMessageRecord[];
}> = ({ message, allMessages }) => {
  const ref = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  useBubbleEnter(ref, reducedMotion);
  const status = resolveDisplayDeliveryStatus(message, allMessages);
  const createdAtLabel = formatChatTime(message.createdAt);
  const isScheduledWakeup = isAgentScheduledWakeup(message.metadata);

  if (isScheduledWakeup) {
    return (
      <div ref={ref} className="flex shrink-0 justify-end">
        <div className="w-full max-w-[560px]">
          <ScheduledWakeupWidget
            instruction={message.bodyMarkdown}
            status={status}
            scheduledFor={typeof message.metadata?.scheduledFor === "string" ? message.metadata.scheduledFor : null}
            compact
          />
        </div>
      </div>
    );
  }

  return (
    <div ref={ref} className={`flex shrink-0 justify-end ${status === "pending" || status === "failed" ? "opacity-60" : ""}`}>
      <div className="max-w-[560px] rounded-3xl rounded-br-lg border border-signal-500/20 bg-signal-500/[0.08] px-4 py-3 backdrop-blur-md dark:bg-signal-500/[0.1]">
        <div
          className="prose prose-sm max-w-none break-words text-[14px] leading-6 text-slate-800 prose-p:text-inherit dark:text-slate-200"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(message.bodyMarkdown) }}
        />
        <div className="mt-1 flex items-center justify-end gap-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-slate-400 dark:text-slate-500">
          {createdAtLabel && <span>{createdAtLabel}</span>}
          <span className={status === "failed" ? "text-status-red" : status === "processed" ? "text-signal-500" : ""}>
            {status === "pending" ? "queued" : status}
          </span>
        </div>
      </div>
    </div>
  );
};

/* ── Scripted greeting + suggestion chips (rich empty state) ── */
const SUGGESTIONS = [
  { icon: ListTodo, label: "Plan the next sprint", prompt: "Plan our next sprint: look at the open work and propose a task breakdown." },
  { icon: Radar, label: "Status report", prompt: "Give me a status report on this project — what is running, what is blocked, and what needs me?" },
  { icon: Wrench, label: "Fix what's failing", prompt: "Investigate the most recent failure in this project and propose a fix." },
] as const;

const GreetingBubble: FunctionComponent<{
  agentName: string;
  projectName: string | null;
  onSuggestion: (prompt: string) => void;
}> = ({ agentName, projectName, onSuggestion }) => {
  const ref = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  useBubbleEnter(ref, reducedMotion);
  return (
    <div ref={ref} className="relative flex justify-start">
      <span aria-hidden="true" className="absolute -left-1.5 top-7 hidden h-3.5 w-3.5 rotate-45 border-b border-l border-signal-500/25 bg-white/95 dark:bg-void-800/95 md:block" />
      <div className="w-full max-w-[720px] rounded-3xl rounded-tl-lg border border-signal-500/25 bg-white/95 p-6 shadow-[0_12px_48px_rgba(0,224,160,0.10),0_4px_24px_rgba(0,0,0,0.06)] backdrop-blur-md dark:bg-void-800/95">
        <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em]">
          <Sparkles className="h-3.5 w-3.5 text-signal-500" aria-hidden="true" />
          <span className="text-signal-600 dark:text-signal-400">{agentName}</span>
        </div>
        <p className="font-display text-2xl font-black tracking-tight text-slate-900 dark:text-white">
          What are we building today?
        </p>
        <p className="mt-2 text-[14px] leading-7 text-slate-600 dark:text-slate-300">
          I'm your project manager{projectName ? <> for <span className="font-semibold text-slate-900 dark:text-white">{projectName}</span></> : null}.
          Ask me anything, or start from one of these:
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {SUGGESTIONS.map(({ icon: Icon, label, prompt }) => (
            <button
              key={label}
              type="button"
              onClick={() => onSuggestion(prompt)}
              className="inline-flex items-center gap-2 rounded-full border border-black/[0.08] bg-black/[0.03] px-4 py-2 text-[12px] font-semibold text-slate-700 transition hover:border-signal-500/40 hover:bg-signal-500/10 hover:text-signal-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200 dark:hover:text-signal-400"
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

/* ════════════════════════════════════════════════════════════════════════ */

export const CinematicStage: FunctionComponent<CinematicStageProps> = ({
  selectedProject,
  selectedThread,
  messages,
  threadMessagesLoading,
  hasAwaitedReply,
  invocations,
  sending,
  error,
  input,
  setInput,
  onSpeechTranscript,
  handleSend,
  handleCreateAppQuickaction,
  initialEligibilityLoaded,
  canCreateInitialAppQuickactions,
  navigateHistory,
  composerRef,
  activeConnection,
  agentPreset,
  onOpenThreads,
}) => {
  const floatRef = useRef<HTMLDivElement>(null);
  const exchangeLogRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const [composerFocused, setComposerFocused] = useState(false);
  const [activityNowMs, setActivityNowMs] = useState(Date.now);
  const { data: effectiveSettings } = useProjectEffectiveSettings(selectedProject?.id || null);
  const voiceAvailable = Boolean(effectiveSettings?.settings.speech?.synthesis?.enabled);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const speechPlayback = useSpeechPlayback();
  const speechBaselineThreadIdRef = useRef<string | null>(null);
  const speechBaselineReadyRef = useRef(false);
  const seenAgentMessageIdsRef = useRef<Set<string>>(new Set());
  const pendingAutoPlayMessageRef = useRef<ChatMessageRecord | null>(null);
  const expectingFreshAgentReplyRef = useRef(false);

  const agentName = agentPreset?.name || activeConnection?.displayName || "Project Manager";
  const avatarConfig = agentPreset?.avatarConfig || DEFAULT_AGENT_AVATAR_CONFIG;
  useEffect(() => {
    const timer = window.setInterval(() => setActivityNowMs(Date.now()), STAGE_ACTIVITY_MESSAGE_MIN_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);
  const activityState = resolveCinematicActivityDisplayState({
    agentId: agentPreset?.id,
    error,
    hasAwaitedReply,
    invocations,
    nowMs: activityNowMs,
    projectManagerAgentPresetId: agentPreset?.id,
    selectedThread,
  });
  const invocationFeedback = useCinematicInvocationFeedback({
    invocations,
    projectId: selectedProject?.id,
    projectManagerAgentPresetId: agentPreset?.id,
  });
  const invocationFeedbackContextRef = useRef<{
    contextKey: string;
    invocationKey: string;
  } | null>(null);
  const stageContextKey = `${selectedProject?.id ?? "no-project"}:${selectedThread?.id ?? "new-thread"}`;
  const invocationKey = invocationFeedback.activeInvocation
    ? `${invocationFeedback.activeInvocation.projectId}:${invocationFeedback.activeInvocation.id}`
    : null;
  if (!invocationKey) {
    invocationFeedbackContextRef.current = null;
  } else if (invocationFeedbackContextRef.current?.invocationKey !== invocationKey) {
    invocationFeedbackContextRef.current = { contextKey: stageContextKey, invocationKey };
  } else if (
    selectedThread
    && invocationFeedbackContextRef.current.contextKey === `${selectedProject?.id ?? "no-project"}:new-thread`
  ) {
    // The first send creates and selects its thread after invocation startup;
    // retain that one logical context transition without following later
    // user-driven thread changes.
    invocationFeedbackContextRef.current.contextKey = stageContextKey;
  }
  const matchingInvocationFeedback = invocationFeedback.activeInvocation
    && invocationFeedbackContextRef.current?.invocationKey === invocationKey
    && invocationFeedbackContextRef.current.contextKey === stageContextKey
    ? invocationFeedback.activeInvocation
    : null;
  useLayoutEffect(() => {
    if (!matchingInvocationFeedback || !exchangeLogRef.current) return;
    exchangeLogRef.current.scrollTop = exchangeLogRef.current.scrollHeight;
  }, [
    matchingInvocationFeedback?.id,
    invocationFeedback.message,
    invocationFeedback.toolCount,
  ]);
  // The runtime stores agent replies with authorType "system", so speech vs.
  // user bubbles are decided by direction alone — never filter on authorType.
  const visibleMessages = messages;

  /* Only the current beat is staged: the newest agent reply, plus any user
     messages sent after it (awaiting their answer). Everything older is one
     click away in Threads — the stage is a spotlight, not an archive. */
  let latestAgentIndex = -1;
  for (let i = visibleMessages.length - 1; i >= 0; i--) {
    if (visibleMessages[i].direction !== "dashboard_to_connection") {
      latestAgentIndex = i;
      break;
    }
  }
  const latestAgentMessage = latestAgentIndex >= 0 ? visibleMessages[latestAgentIndex] : null;
  const latestResponseEffect = latestAgentMessage
    ? resolveAgentResponseEffect(latestAgentMessage.metadata, latestAgentMessage.bodyMarkdown || "")
    : undefined;
  const latestResponseEffectKey = latestAgentMessage && latestResponseEffect
    ? `${latestAgentMessage.id}:${latestResponseEffect.emotion}:${latestResponseEffect.animation}:${latestResponseEffect.durationMs}:${latestResponseEffect.caption ?? ""}`
    : null;
  const [activeResponseEffect, setActiveResponseEffect] = useState<AgentResponseEffect | null>(null);
  useEffect(() => {
    if (!latestResponseEffect || !latestResponseEffectKey) {
      setActiveResponseEffect(null);
      return;
    }
    setActiveResponseEffect(latestResponseEffect);
    const timer = window.setTimeout(() => setActiveResponseEffect(null), latestResponseEffect.durationMs);
    return () => window.clearTimeout(timer);
  }, [latestResponseEffectKey]);
  const pendingUserMessages = visibleMessages
    .slice(latestAgentIndex + 1)
    .filter((message) => message.direction === "dashboard_to_connection")
    .slice(-2); // at most two queued sends staged at once
  const earlierMessageCount = Math.max(0, visibleMessages.length - (latestAgentMessage ? 1 : 0) - pendingUserMessages.length);

  // Background execution remains observable, but never selects the Project
  // Manager's thinking expression, thought bubble, or work tool.
  const runtimeBusy = activityState.projectManagerActive;
  const workingPhase: "starting" | "working" | null = runtimeBusy
    ? (activityState.foregroundCue?.phase === "container_startup" ? "starting" : "working")
    : null;
  const quickActions = buildCinematicQuickActions({
    hasProject: Boolean(selectedProject),
    initialEligibilityLoaded,
    canCreateInitialAppQuickactions,
  });
  const quickActionGroups = QUICK_ACTION_GROUPS
    .map((group) => ({
      ...group,
      actions: quickActions.filter((action) => action.zone === group.zone),
    }))
    .filter((group) => group.actions.length > 0);

  const sendStageMessage = async (overrideText?: string): Promise<void> => {
    expectingFreshAgentReplyRef.current = true;
    await handleSend(overrideText);
  };

  useEffect(() => {
    const projectId = selectedProject?.id;
    if (!projectId || !voiceAvailable) {
      setVoiceEnabled(false);
      return;
    }
    setVoiceEnabled(window.localStorage.getItem(`codeux:chat-voice:${projectId}`) !== "off");
  }, [selectedProject?.id, voiceAvailable]);

  // Loading or opening a thread establishes a historical baseline. Only an
  // agent message appended after that baseline is eligible for auto-play.
  useEffect(() => {
    const threadId = selectedThread?.id ?? null;
    if (speechBaselineThreadIdRef.current !== threadId) {
      const preserveExpectedFirstReply = expectingFreshAgentReplyRef.current
        && speechBaselineThreadIdRef.current === null
        && threadId !== null;
      speechBaselineThreadIdRef.current = threadId;
      speechBaselineReadyRef.current = false;
      seenAgentMessageIdsRef.current = new Set();
      pendingAutoPlayMessageRef.current = null;
      if (!preserveExpectedFirstReply) expectingFreshAgentReplyRef.current = false;
      speechPlayback.stop();
    }
    if (!threadId || threadMessagesLoading) return;

    const agentMessages = messages.filter((message) => (
      message.threadId === threadId && message.direction !== "dashboard_to_connection"
    ));
    if (pendingAutoPlayMessageRef.current) {
      pendingAutoPlayMessageRef.current = agentMessages.find(
        (message) => message.id === pendingAutoPlayMessageRef.current?.id,
      ) ?? pendingAutoPlayMessageRef.current;
    }
    if (!speechBaselineReadyRef.current) {
      seenAgentMessageIdsRef.current = new Set(agentMessages.map((message) => message.id));
      speechBaselineReadyRef.current = true;
      if (expectingFreshAgentReplyRef.current) {
        let latestDashboardMessageIndex = -1;
        for (let index = messages.length - 1; index >= 0; index -= 1) {
          if (messages[index].threadId === threadId && messages[index].direction === "dashboard_to_connection") {
            latestDashboardMessageIndex = index;
            break;
          }
        }
        const firstReply = messages
          .slice(latestDashboardMessageIndex + 1)
          .filter((message) => (
            message.threadId === threadId
            && message.direction !== "dashboard_to_connection"
            && canSpeakAgentMessage(message)
          ))
          .at(-1);
        if (latestDashboardMessageIndex >= 0 && firstReply && voiceAvailable && voiceEnabled) {
          pendingAutoPlayMessageRef.current = firstReply;
          expectingFreshAgentReplyRef.current = false;
        }
      }
      return;
    }

    const newAgentMessages = agentMessages.filter((message) => !seenAgentMessageIdsRef.current.has(message.id));
    for (const message of newAgentMessages) seenAgentMessageIdsRef.current.add(message.id);
    const newSpeakableAgentMessages = newAgentMessages.filter(canSpeakAgentMessage);
    if (newSpeakableAgentMessages.length > 0 && voiceAvailable && voiceEnabled) {
      pendingAutoPlayMessageRef.current = newSpeakableAgentMessages[newSpeakableAgentMessages.length - 1];
      expectingFreshAgentReplyRef.current = false;
    }
  }, [messages, selectedThread?.id, threadMessagesLoading, voiceAvailable, voiceEnabled]);

  useEffect(() => {
    const pendingMessage = pendingAutoPlayMessageRef.current;
    if (!pendingMessage || runtimeBusy || !voiceAvailable || !voiceEnabled) return;
    pendingAutoPlayMessageRef.current = null;
    void speechPlayback.play({
      markdown: pendingMessage.bodyMarkdown,
      messageId: pendingMessage.id,
      projectId: selectedProject?.id ?? null,
    });
  }, [messages, runtimeBusy, selectedProject?.id, voiceAvailable, voiceEnabled]);

  useEffect(() => {
    if (error) expectingFreshAgentReplyRef.current = false;
  }, [error]);

  const toggleVoice = (): void => {
    if (!voiceAvailable || !selectedProject?.id) return;
    const next = !voiceEnabled;
    setVoiceEnabled(next);
    window.localStorage.setItem(`codeux:chat-voice:${selectedProject.id}`, next ? "on" : "off");
    if (!next) {
      pendingAutoPlayMessageRef.current = null;
      speechPlayback.stop();
    }
  };

  const activeTool = useCinematicWorkTool({
    active: Boolean(matchingInvocationFeedback),
    activityKey: matchingInvocationFeedback?.id ?? "inactive-project-manager-invocation",
    reducedMotion,
  });

  const mood: AgentMoodState = useAgentMood({
    error,
    sending,
    hasWorkingReply: runtimeBusy,
    workingPhase,
    messages: visibleMessages,
    userEngaged: composerFocused || input.trim().length > 0,
    agentName,
    reducedMotion,
    ambientPaused: Boolean(activeResponseEffect),
  });
  // Runtime truth always wins. A validated reply effect may only replace the
  // otherwise idle/listening micro-expression for its bounded lifetime.
  const responseEffect = !error && !sending && !runtimeBusy ? activeResponseEffect : null;
  const stageExpression = responseEffect?.emotion ?? mood.expression;
  const stageAnimation = reducedMotion
    ? undefined
    : responseEffect?.animation ?? (mood.ambientMotionEnabled ? mood.ambientCue?.animation : undefined);
  const stageCaption = responseEffect ? getAgentResponseEffectCaption(responseEffect) : mood.caption;

  /* Cinematic drift — the whole bot slowly floats, leans, and wanders a few
     pixels on top of the scene's own idle bob, so it never reads as parked. */
  useLayoutEffect(() => {
    const el = floatRef.current;
    if (!el || !mood.ambientMotionEnabled) return;
    const tl = gsap.timeline({ repeat: -1, yoyo: true, defaults: { ease: "sine.inOut" } });
    tl.to(el, { y: -16, x: 6, rotation: 1.4, duration: 3.4 })
      .to(el, { y: 4, x: -8, rotation: -1.1, duration: 3.0 })
      .to(el, { y: -10, x: 2, rotation: 0.6, duration: 3.6 });
    return () => {
      tl.kill();
      gsap.set(el, { x: 0, y: 0, rotation: 0 });
    };
  }, [mood.ambientMotionEnabled]);

  const applySuggestion = (prompt: string): void => {
    void sendStageMessage(prompt).finally(() => {
      requestAnimationFrame(() => {
        composerRef.current?.focus({ preventScroll: true });
      });
    });
  };

  const showGreeting = !threadMessagesLoading
    && visibleMessages.length === 0
    && !matchingInvocationFeedback;

  return (
    <div
      className="relative flex-1 min-h-0 overflow-hidden"
      data-testid="cinematic-stage"
      data-background-activity-count={activityState.backgroundActivityCount}
    >
      {/* ── Ambient backdrop — aurora glow, pure CSS, zero extra GPU cost ── */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className={`${mood.ambientMotionEnabled ? "stage-aurora" : ""} absolute left-1/2 top-[16%] h-[52vh] w-[52vh] -translate-x-1/2 rounded-full bg-signal-500/[0.06] blur-3xl dark:bg-signal-500/[0.05]`} />
        <div className={`${mood.ambientMotionEnabled ? "stage-aurora-slow" : ""} absolute -right-[12%] bottom-[4%] h-[50%] w-[40%] rounded-full bg-purple-500/[0.04] blur-3xl dark:bg-purple-500/[0.04]`} />
      </div>

      {/* ── Context strip — thread identity + escape hatch to Threads ── */}
      <div className="absolute inset-x-0 top-0 z-30 flex items-center justify-between gap-3 px-4 pt-4 md:px-6">
        <div className="flex min-w-0 items-center gap-2 rounded-full border border-black/[0.06] bg-white/70 px-3.5 py-1.5 backdrop-blur-md dark:border-white/[0.08] dark:bg-void-800/70">
          <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${runtimeBusy ? "animate-pulse bg-signal-500 motion-reduce:animate-none" : "bg-signal-500/60"}`} />
          <span className="truncate text-[11px] font-semibold text-slate-700 dark:text-slate-200">
            {selectedThread?.title || "New conversation"}
          </span>
          {selectedThread && (
            <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.1em] text-slate-400">
              {selectedThread.messageCount} msg
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onOpenThreads}
          className="inline-flex shrink-0 items-center gap-2 rounded-full border border-black/[0.06] bg-white/70 px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 backdrop-blur-md transition hover:text-slate-900 dark:border-white/[0.08] dark:bg-void-800/70 dark:text-slate-400 dark:hover:text-white"
        >
          <History className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="hidden sm:inline">All threads</span>
        </button>
      </div>

      {/* ── Center stage — the bot owns the middle of the screen ── */}
      <div className="pointer-events-none absolute inset-x-0 top-10 bottom-32 z-10 flex flex-col items-center justify-start md:justify-center">
        {/* Mobile uses a compact two-row scroller per category; desktop groups
            a lightly scattered action constellation left of the avatar. */}
        {!runtimeBusy && !sending && !error && quickActions.length > 0 && (
          <div
            aria-label="Project quick actions"
            role="group"
            className="pointer-events-auto absolute inset-x-4 top-14 z-20 flex max-h-24 gap-4 overflow-x-auto overscroll-x-contain py-1.5 md:bottom-24 md:left-0 md:right-auto md:top-20 md:max-h-none md:w-[min(21rem,calc(50%-1.5rem))] md:flex-col md:justify-center md:gap-3 md:overflow-visible md:px-1.5 md:py-4"
          >
            {quickActionGroups.map((group) => (
              <div
                key={group.zone}
                role="group"
                aria-label={`${group.label} quick actions`}
                className="shrink-0 md:w-full"
              >
                <div className="mb-1.5 hidden items-center gap-2 px-2 md:flex" aria-hidden="true">
                  <span className="h-px w-5 bg-gradient-to-r from-transparent to-black/15 dark:to-white/15" />
                  <span className="font-mono text-[8px] font-bold uppercase tracking-[0.18em] text-slate-400/80 dark:text-slate-500/90">
                    {group.label}
                  </span>
                </div>
                <div
                  data-quick-action-group={group.zone}
                  className="grid grid-flow-col grid-rows-2 auto-cols-max gap-x-3 gap-y-1.5 md:flex md:flex-wrap md:items-center md:gap-x-2 md:gap-y-2"
                >
                  {group.actions.map((action) => {
                    const Icon = action.actionType === "create_app"
                      ? CREATE_APP_ACTION_ICONS[action.appKind]
                      : PROMPT_ACTION_ICONS[action.id];
                    return (
                      <button
                        key={action.id}
                        type="button"
                        data-quick-action-zone={action.zone}
                        onClick={() => {
                          if (action.actionType === "create_app") {
                            void handleCreateAppQuickaction(action.appKind);
                            return;
                          }
                          void sendStageMessage(action.prompt);
                        }}
                        style={{ animationDelay: action.animationDelay }}
                        className={`${mood.ambientMotionEnabled ? "stage-quick-float" : ""} ${QUICK_ACTION_SCATTER_STYLES[action.id]} group inline-flex min-h-9 w-fit min-w-0 self-center items-center justify-start gap-2 rounded-xl border border-black/[0.06] bg-white/78 px-2 py-1.5 text-left text-[10px] font-semibold leading-3.5 text-slate-600 shadow-[0_3px_14px_rgba(15,23,42,0.07)] backdrop-blur-xl transition-[border-color,background-color,color,box-shadow] hover:border-black/[0.13] hover:bg-white/95 hover:text-slate-900 hover:shadow-[0_5px_18px_rgba(15,23,42,0.1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 focus-visible:ring-offset-2 dark:border-white/[0.08] dark:bg-void-800/72 dark:text-slate-300 dark:shadow-[0_4px_18px_rgba(0,0,0,0.28)] dark:hover:border-white/[0.16] dark:hover:bg-void-700/92 dark:hover:text-white dark:focus-visible:ring-offset-void-900`}
                      >
                        <span
                          aria-hidden="true"
                          data-quick-action-icon={action.id}
                          className={`grid h-6 w-6 shrink-0 place-items-center rounded-lg ring-1 ring-inset transition-transform group-hover:scale-105 ${QUICK_ACTION_ICON_STYLES[action.id]}`}
                        >
                          <Icon className="h-3.5 w-3.5" strokeWidth={2.15} />
                        </span>
                        <span className="min-w-0 whitespace-nowrap">{action.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
        <div className={`relative flex w-full flex-col items-center px-6 ${runtimeBusy ? "md:-translate-x-[10%] xl:-translate-x-[12%] 2xl:-translate-x-[10%]" : ""} ${!runtimeBusy && !sending && !error && quickActions.length > 0 ? "pt-28 md:pt-0" : ""}`}>
          <StageActivityStrip
            foregroundCue={activityState.foregroundCue}
            backgroundCue={activityState.backgroundCue}
            backgroundActivityCount={activityState.backgroundActivityCount}
          />
          <AgentAmbientEffects cue={mood.ambientCue} motionEnabled={mood.ambientMotionEnabled} />
          {/* Generous square canvas so antenna, ears, and aura never clip,
              even at the extremes of the float/lean drift. */}
          <div
            ref={floatRef}
            className="pointer-events-auto h-[28vh] w-[28vh] max-w-full will-change-transform md:h-[min(30vh,340px)] md:w-[min(30vh,340px)] lg:h-[min(30vh,360px)] lg:w-[min(30vh,360px)] xl:h-[min(30vh,380px)] xl:w-[min(30vh,380px)] 2xl:h-[min(36vh,440px)] 2xl:w-[min(36vh,440px)]"
            role="img"
            aria-label={`${agentName}, project manager. ${stageCaption}`}
          >
            <LazyAgentAvatarScene
              eager
              pointerTracking="window"
              tool={activeTool}
              config={avatarConfig}
              expression={stageExpression}
              animation={stageAnimation}
              className="h-full w-full"
            />
          </div>

          {/* Name plate + truthful mood caption — tucked up into the canvas's
              empty lower margin so it never collides with the composer. */}
          <div className="pointer-events-auto -mt-4 text-center md:-mt-10 lg:-mt-12 2xl:-mt-14">
            <div className="font-display text-lg font-black tracking-tight text-slate-900 dark:text-white">
              {agentName}
            </div>
            <div aria-live="polite" className="mt-0.5 text-[12px] font-medium text-slate-500 dark:text-slate-400">
              {stageCaption}
            </div>
            <div className="mt-1.5 flex items-center justify-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
              <span className={`h-1 w-1 rounded-full ${activeConnection ? "bg-signal-500" : "bg-slate-300 dark:bg-slate-600"}`} aria-hidden="true" />
              {activeConnection ? `${activeConnection.displayName} · ${activeConnection.status}` : "queued routing"}
            </div>
            <div
              role="group"
              aria-label="3D chat voice controls"
              className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-black/[0.07] bg-white/80 p-1.5 shadow-[0_8px_28px_rgba(0,0,0,0.09)] backdrop-blur-xl dark:border-white/[0.09] dark:bg-void-800/80 dark:shadow-[0_8px_30px_rgba(0,0,0,0.35)]"
            >
              <SpeechInputButton
                compact
                disabled={!selectedProject || sending}
                projectId={selectedProject?.id ?? null}
                onTranscript={onSpeechTranscript}
                className="border-transparent bg-transparent shadow-none hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
              />
              <span aria-hidden="true" className="h-6 w-px bg-black/[0.08] dark:bg-white/[0.1]" />
              <button
                type="button"
                onClick={toggleVoice}
                disabled={!voiceAvailable}
                aria-pressed={voiceEnabled}
                aria-label={!voiceAvailable ? "Voice unavailable; activate a TTS model in AI Models settings" : voiceEnabled ? "Mute project manager" : "Unmute project manager"}
                title={!voiceAvailable ? "Activate a TTS model in Settings → AI Models" : voiceEnabled ? "Mute agent" : "Unmute agent"}
                className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 ${voiceEnabled ? "bg-signal-500/[0.12] text-signal-600 dark:text-signal-300" : "bg-black/[0.03] text-slate-400 dark:bg-white/[0.04]"} disabled:cursor-not-allowed disabled:opacity-45`}
              >
                {voiceEnabled ? <Volume2 className={`h-5 w-5 ${speechPlayback.activeMessageId ? "animate-pulse motion-reduce:animate-none" : ""}`} aria-hidden="true" /> : <VolumeX className="h-5 w-5" aria-hidden="true" />}
              </button>
            </div>
            {speechPlayback.error ? (
              <div role="status" className="mx-auto mt-2 max-w-xs rounded-xl border border-rose-500/20 bg-rose-500/[0.08] px-3 py-2 text-[11px] font-medium text-rose-700 shadow-sm dark:text-rose-200">
                Voice error: {speechPlayback.error}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* ── Latest exchange — only the current beat of the conversation is
             staged: the newest agent reply plus any user messages sent after
             it. History lives one click away in Threads. ── */}
      <div
        data-testid="cinematic-exchange"
        className="absolute inset-x-0 bottom-32 top-[48%] z-20 flex min-h-0 flex-col justify-end px-4 pb-2 pt-3 md:inset-y-0 md:bottom-0 md:left-auto md:right-0 md:top-0 md:w-[46%] md:justify-end md:px-6 md:py-0 md:pb-36 md:pt-4 lg:w-[44%] lg:px-8 lg:pt-6 xl:w-[46%] xl:px-10 xl:pt-8 2xl:w-[48%] 2xl:justify-center 2xl:px-12 2xl:pb-32 2xl:pt-12"
      >
        <div
          ref={exchangeLogRef}
          role="log"
          aria-label="Latest exchange with the project manager"
          aria-live={matchingInvocationFeedback ? "off" : visibleMessages.length > 0 ? "polite" : "off"}
          aria-relevant="additions text"
          className="flex max-h-full min-h-0 flex-col gap-4 overflow-y-auto overscroll-contain pr-1"
        >
          {showGreeting ? (
            <GreetingBubble
              agentName={agentName}
              projectName={selectedProject?.name || null}
              onSuggestion={applySuggestion}
            />
          ) : (
            <>
              {latestAgentMessage && (
                <AgentSpeechBubble
                  key={latestAgentMessage.id}
                  message={latestAgentMessage}
                  agentName={agentName}
                  onAction={applySuggestion}
                  onReplay={(message) => void speechPlayback.play({
                    markdown: message.bodyMarkdown,
                    messageId: message.id,
                    projectId: selectedProject?.id ?? null,
                  })}
                  replaying={speechPlayback.activeMessageId === latestAgentMessage.id}
                />
              )}
              {pendingUserMessages.map((message) => (
                <UserBubble key={message.id} message={message} allMessages={visibleMessages} />
              ))}
              {matchingInvocationFeedback && (
                <CinematicInvocationProgressBubble
                  key={matchingInvocationFeedback.id}
                  invocationId={matchingInvocationFeedback.id}
                  message={invocationFeedback.message}
                  toolCount={invocationFeedback.toolCount}
                />
              )}
              {earlierMessageCount > 0 && (
                <button
                  type="button"
                  onClick={onOpenThreads}
                  className="inline-flex items-center gap-1.5 self-start rounded-full px-2 py-1 text-[11px] font-semibold text-slate-400 transition hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-200"
                >
                  <History className="h-3 w-3" aria-hidden="true" />
                  Full conversation · {visibleMessages.length} messages
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Floating composer pill — bottom center of the stage ── */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex p-4 md:p-6">
        <div className="flex flex-1 justify-center">
        <div className="pointer-events-auto w-full max-w-2xl">
          <div className={`rounded-[2rem] border bg-white/85 p-3.5 shadow-[0_12px_48px_rgba(0,0,0,0.10)] backdrop-blur-xl transition-colors focus-within:border-signal-500/40 dark:bg-void-800/85 dark:shadow-[0_12px_48px_rgba(0,0,0,0.45)] ${
            error ? "border-status-red/50" : "border-black/[0.08] dark:border-white/[0.1]"
          }`}>
            <div className="flex items-end gap-2">
              <label htmlFor="stage-composer" className="sr-only">Message the project manager</label>
              <textarea
                id="stage-composer"
                ref={composerRef}
                value={input}
                rows={1}
                placeholder={`Ask ${agentName} anything…`}
                className="max-h-[200px] min-h-[56px] w-full min-w-0 resize-none bg-transparent px-3.5 py-3.5 text-[15px] leading-relaxed text-slate-900 outline-none placeholder:text-slate-400 dark:text-white dark:placeholder:text-slate-500"
                onFocus={() => setComposerFocused(true)}
                onBlur={() => setComposerFocused(false)}
                onInput={(event) => {
                  const element = event.currentTarget;
                  element.style.height = "auto";
                  element.style.height = `${element.scrollHeight}px`;
                  setInput(element.value);
                }}
                onKeyDown={(event) => {
                  if (event.isComposing) return;
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void sendStageMessage();
                    return;
                  }
                  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                    const element = event.currentTarget;
                    const isSingleLine = !element.value.includes("\n");
                    const atStart = element.selectionStart === 0 && element.selectionEnd === 0;
                    const atEnd = element.selectionStart === element.value.length && element.selectionEnd === element.value.length;
                    const direction = event.key === "ArrowUp" ? "up" : "down";
                    const shouldRecall = direction === "up" ? (isSingleLine || atStart) : (isSingleLine || atEnd);
                    if (shouldRecall && navigateHistory(direction)) {
                      event.preventDefault();
                      requestAnimationFrame(() => {
                        if (!composerRef.current) return;
                        composerRef.current.style.height = "auto";
                        composerRef.current.style.height = `${composerRef.current.scrollHeight}px`;
                        const pos = direction === "up" ? 0 : composerRef.current.value.length;
                        composerRef.current.setSelectionRange(pos, pos);
                      });
                    }
                  }
                }}
              />
              <button
                aria-label={sending ? "Sending message" : "Send message"}
                aria-busy={sending}
                type="button"
                onClick={() => void sendStageMessage()}
                disabled={!selectedProject || !input.trim() || sending}
                className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-[1.25rem] transition-all ${
                  !selectedProject || (!input.trim() && !sending)
                    ? "cursor-not-allowed bg-black/[0.06] text-slate-400 dark:bg-white/[0.06]"
                    : sending
                      ? "scale-95 cursor-wait bg-signal-500/50 text-white dark:text-void-900"
                      : "bg-signal-500 text-white shadow-[0_0_24px_rgba(0,224,160,0.28)] hover:scale-105 hover:bg-signal-400 active:scale-95 dark:text-void-900"
                }`}
              >
                {sending ? <RefreshCw className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <ArrowUp className="h-5 w-5" strokeWidth={2.5} />}
              </button>
            </div>
            <div className="px-3 pb-1 text-[10px] font-mono text-slate-400 dark:text-slate-500">
              Enter sends · Shift+Enter newline
              <span className="sr-only" aria-live="polite">
                {sending ? "Sending message…" : ""}
                {error ? `Failed: ${error}` : ""}
              </span>
            </div>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
};
