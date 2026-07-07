import type { FunctionComponent, RefObject } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import { AlertTriangle, ArrowUp, Globe, History, ListTodo, Monitor, Radar, RefreshCw, Rocket, Sparkles, Wrench } from "lucide-preact";
import type { AgentPresetRecord, ChatMessageRecord, ChatThread, Source } from "../../../types.js";
import { renderMarkdown } from "../../../../lib/markdown.js";
import { formatChatTime } from "../../../lib/chat-time.js";
import { getChatWidgetData } from "../../../lib/chat-widget-view-models.js";
import { PlanningRequestWidget } from "../widgets/PlanningRequestWidget.js";
import { LazyAgentAvatarScene } from "../../agents/LazyAgentAvatarScene.js";
import type { AgentSceneTool } from "../../agents/AgentAvatarScene.js";
import { DEFAULT_AGENT_AVATAR_CONFIG } from "../../../lib/agent-avatar.js";
import { useReducedMotion } from "../../../hooks/use-reduced-motion.js";
import { resolveDisplayDeliveryStatus } from "../../../hooks/use-chat-thread-data.js";
import { useAgentMood, type AgentMoodState } from "./use-agent-mood.js";
import { parseBubbleSegments, StageWidgetRenderer } from "./StageWidgets.js";

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
  hasWorkingReply: boolean;
  /** Running (or optimistic) execution invocations for this project — the
   *  truthful "the agent is actually working / calling tools" signal on the
   *  virtual-worker path, where thread messages stay `pending` during work. */
  runningInvocationCount: number;
  sending: boolean;
  error: string | null;
  input: string;
  setInput: (value: string) => void;
  handleSend: (overrideText?: string) => Promise<void>;
  navigateHistory: (direction: "up" | "down") => boolean;
  composerRef: RefObject<HTMLTextAreaElement>;
  activeConnection: { displayName: string; status: string } | null;
  agentPreset?: AgentPresetRecord;
  onOpenThreads: () => void;
}

/** The bot cycles through its toolbox while the runtime is executing. */
const WORK_TOOLS: AgentSceneTool[] = ["screwdriver", "jackhammer", "wrench", "torch"];
const TOOL_SWAP_MS = 7_000;

/** Idle quick actions floating in an arc on the bot's LEFT — the right side
 *  belongs to the speech bubble, so the two can never collide. Clicking
 *  sends immediately; prompts are phrased to elicit the rich stage widgets.
 *  left uses max() so chips never escape the viewport on narrow stages. */
const QUICK_ACTIONS = [
  {
    icon: Globe,
    label: "Web App",
    prompt: "Set up this existing project as a web app using the project's current techstack setting. Inspect the repository first, then propose and run the needed project-scoped commands or sprint work. Do not create or import a new Code UX project.",
    position: "top-[6%] left-[max(1rem,calc(50%-350px))]",
    delay: "0s",
  },
  {
    icon: Monitor,
    label: "Desktop App",
    prompt: "Set up this existing project as a desktop app using the project's current techstack setting. Inspect the repository first, then propose and run the needed project-scoped commands or sprint work. Do not create or import a new Code UX project.",
    position: "top-[19%] left-[max(0.75rem,calc(50%-420px))]",
    delay: "0.8s",
  },
  {
    icon: Radar,
    label: "Status report",
    prompt: "Give me a concise status report for this project — CI health, running work, and anything blocked.",
    position: "top-[32%] left-[max(0.5rem,calc(50%-440px))]",
    delay: "1.6s",
  },
  {
    icon: Rocket,
    label: "Sprint progress",
    prompt: "How is the current sprint progressing? Summarize task completion and what is next.",
    position: "top-[45%] left-[max(0.5rem,calc(50%-440px))]",
    delay: "2.4s",
  },
  {
    icon: AlertTriangle,
    label: "What's failing?",
    prompt: "What is currently failing or blocked in this project, and what do you recommend we do about it?",
    position: "top-[58%] left-[max(0.75rem,calc(50%-420px))]",
    delay: "3.2s",
  },
  {
    icon: ListTodo,
    label: "Plan next steps",
    prompt: "Propose the next steps for this project as a short prioritized task list.",
    position: "top-[71%] left-[max(1rem,calc(50%-350px))]",
    delay: "4s",
  },
] as const;

/** Debug override: /chat?stageTool=wrench pins a specific tool on the stage. */
const readForcedTool = (): AgentSceneTool | null => {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get("stageTool");
  return (WORK_TOOLS as string[]).includes(value ?? "") ? (value as AgentSceneTool) : null;
};

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

/* ── Thought bubble — internal state, cloud-shaped, above the antenna ── */
const ThoughtBubble: FunctionComponent<{ text: string }> = ({ text }) => {
  const ref = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  useBubbleEnter(ref, reducedMotion);
  return (
    <div ref={ref} className="pointer-events-none absolute left-1/2 top-0 z-20 w-max max-w-[240px] -translate-x-[12%]">
      <div role="status" aria-live="polite" className="rounded-[1.75rem] border border-black/[0.06] bg-white/90 px-4 py-2.5 shadow-[0_8px_32px_rgba(0,0,0,0.10)] backdrop-blur-md dark:border-white/10 dark:bg-void-800/90">
        <span className="flex items-center gap-2 text-[12px] font-medium text-slate-600 dark:text-slate-300">
          {text}
          <span aria-hidden="true" className="flex items-end gap-0.5 pb-0.5">
            <span className="stage-thinking-dot h-1 w-1 rounded-full bg-signal-500" />
            <span className="stage-thinking-dot h-1 w-1 rounded-full bg-signal-500 [animation-delay:150ms]" />
            <span className="stage-thinking-dot h-1 w-1 rounded-full bg-signal-500 [animation-delay:300ms]" />
          </span>
        </span>
      </div>
      {/* Trailing cloud puffs pointing down toward the bot's head */}
      <div aria-hidden="true" className="ml-6 mt-1 h-2.5 w-2.5 rounded-full border border-black/[0.05] bg-white/90 dark:border-white/10 dark:bg-void-800/90" />
      <div aria-hidden="true" className="ml-4 mt-0.5 h-1.5 w-1.5 rounded-full border border-black/[0.05] bg-white/85 dark:border-white/10 dark:bg-void-800/85" />
    </div>
  );
};

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
}> = ({ message, agentName, onAction }) => {
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
      <div className="flex min-h-0 w-full max-w-[720px] flex-col rounded-3xl rounded-tl-lg border border-signal-500/25 bg-white/95 p-5 shadow-[0_12px_48px_rgba(0,224,160,0.10),0_4px_24px_rgba(0,0,0,0.06)] backdrop-blur-md dark:bg-void-800/95 dark:shadow-[0_12px_48px_rgba(0,224,160,0.08),0_8px_32px_rgba(0,0,0,0.35)]">
        <div className="mb-2 flex shrink-0 items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
          <span className="text-signal-600 dark:text-signal-400">{agentName}</span>
          {createdAtLabel && <span className="font-mono font-normal tracking-normal">{createdAtLabel}</span>}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
          {segments.map((segment, index) =>
            segment.kind === "widget" ? (
              <StageWidgetRenderer key={index} widget={segment.widget} onAction={onAction} />
            ) : (
              <div
                key={index}
                className={`${BUBBLE_MARKDOWN_CLASSES} prose-base text-[15px] leading-8`}
                dangerouslySetInnerHTML={{ __html: renderMarkdown(segment.markdown) }}
              />
            ),
          )}
          {widgetData.type === "planning" && (
            <div className="mt-4 border-t border-black/[0.05] pt-4 dark:border-white/[0.06]">
              <PlanningRequestWidget status={widgetData.status} planName={widgetData.planName} />
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

  return (
    <div ref={ref} className={`flex justify-end ${status === "pending" || status === "failed" ? "opacity-60" : ""}`}>
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
  hasWorkingReply,
  runningInvocationCount,
  sending,
  error,
  input,
  setInput,
  handleSend,
  navigateHistory,
  composerRef,
  activeConnection,
  agentPreset,
  onOpenThreads,
}) => {
  const floatRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const [composerFocused, setComposerFocused] = useState(false);
  const [workingPhase, setWorkingPhase] = useState<"starting" | "working" | null>(null);

  const agentName = agentPreset?.name || activeConnection?.displayName || "Project Manager";
  const avatarConfig = agentPreset?.avatarConfig || DEFAULT_AGENT_AVATAR_CONFIG;
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
  const pendingUserMessages = visibleMessages
    .slice(latestAgentIndex + 1)
    .filter((message) => message.direction === "dashboard_to_connection")
    .slice(-2); // at most two queued sends staged at once
  const earlierMessageCount = Math.max(0, visibleMessages.length - (latestAgentMessage ? 1 : 0) - pendingUserMessages.length);

  /* "Busy" is either an awaited listener reply (delivered, unanswered) or a
     running invocation — the latter is what actually fires on the
     virtual-worker path, where thread messages stay `pending` during work. */
  const runtimeBusy = hasWorkingReply || runningInvocationCount > 0;

  useEffect(() => {
    if (!runtimeBusy) {
      setWorkingPhase(null);
      return;
    }
    setWorkingPhase("starting");
    const timer = window.setTimeout(() => setWorkingPhase("working"), 4000);
    return () => window.clearTimeout(timer);
  }, [runtimeBusy]);

  /* Work tools — while the runtime is executing, the bot pulls a tool from
     its toolbox and swaps to a fresh one every few seconds. */
  const [activeTool, setActiveTool] = useState<AgentSceneTool | null>(readForcedTool);
  useEffect(() => {
    if (readForcedTool()) return; // pinned via ?stageTool= for design review
    if (workingPhase !== "working") {
      setActiveTool(null);
      return;
    }
    let index = Math.floor(Math.random() * WORK_TOOLS.length);
    setActiveTool(WORK_TOOLS[index]);
    const timer = window.setInterval(() => {
      index = (index + 1) % WORK_TOOLS.length;
      setActiveTool(WORK_TOOLS[index]);
    }, TOOL_SWAP_MS);
    return () => window.clearInterval(timer);
  }, [workingPhase]);

  const mood: AgentMoodState = useAgentMood({
    error,
    sending,
    hasWorkingReply: runtimeBusy,
    workingPhase,
    messages: visibleMessages,
    userEngaged: composerFocused || input.trim().length > 0,
    agentName,
  });

  /* Cinematic drift — the whole bot slowly floats, leans, and wanders a few
     pixels on top of the scene's own idle bob, so it never reads as parked. */
  useLayoutEffect(() => {
    const el = floatRef.current;
    if (!el || reducedMotion) return;
    const tl = gsap.timeline({ repeat: -1, yoyo: true, defaults: { ease: "sine.inOut" } });
    tl.to(el, { y: -16, x: 6, rotation: 1.4, duration: 3.4 })
      .to(el, { y: 4, x: -8, rotation: -1.1, duration: 3.0 })
      .to(el, { y: -10, x: 2, rotation: 0.6, duration: 3.6 });
    return () => {
      tl.kill();
      gsap.set(el, { x: 0, y: 0, rotation: 0 });
    };
  }, [reducedMotion]);

  const applySuggestion = (prompt: string): void => {
    setInput(prompt);
    composerRef.current?.focus();
  };

  const showGreeting = !threadMessagesLoading && visibleMessages.length === 0;

  return (
    <div className="relative flex-1 min-h-0 overflow-hidden" data-testid="cinematic-stage">
      {/* ── Ambient backdrop — aurora glow, pure CSS, zero extra GPU cost ── */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="stage-aurora absolute left-1/2 top-[16%] h-[52vh] w-[52vh] -translate-x-1/2 rounded-full bg-signal-500/[0.06] blur-3xl dark:bg-signal-500/[0.05]" />
        <div className="stage-aurora-slow absolute -right-[12%] bottom-[4%] h-[50%] w-[40%] rounded-full bg-purple-500/[0.04] blur-3xl dark:bg-purple-500/[0.04]" />
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
        {/* Idle quick actions — float around the bot, fire a message instantly */}
        {!runtimeBusy && !sending && !error && (
          <div aria-label="Quick actions" role="group" className="hidden md:block">
            {QUICK_ACTIONS.map(({ icon: Icon, label, prompt, position, delay }) => (
              <div key={label} className={`absolute z-20 ${position}`}>
                <button
                  type="button"
                  onClick={() => void handleSend(prompt)}
                  style={{ animationDelay: delay }}
                  className="stage-quick-float pointer-events-auto inline-flex items-center gap-2 rounded-full border border-black/[0.07] bg-white/80 px-4 py-2.5 text-[12px] font-semibold text-slate-600 shadow-[0_4px_20px_rgba(0,0,0,0.08)] backdrop-blur-md transition-colors hover:border-signal-500/40 hover:text-signal-700 dark:border-white/[0.09] dark:bg-void-800/80 dark:text-slate-300 dark:shadow-[0_4px_24px_rgba(0,0,0,0.35)] dark:hover:text-signal-400"
                >
                  <Icon className="h-3.5 w-3.5 text-signal-500" aria-hidden="true" />
                  {label}
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="relative flex w-full flex-col items-center px-6">
          {runtimeBusy && (
            <ThoughtBubble text={workingPhase === "starting" ? "Spinning up a workspace" : "Working on it"} />
          )}
          {/* Generous square canvas so antenna, ears, and aura never clip,
              even at the extremes of the float/lean drift. */}
          <div
            ref={floatRef}
            className="pointer-events-auto h-[28vh] w-[28vh] max-w-full will-change-transform md:h-[min(48vh,520px)] md:w-[min(48vh,520px)]"
            role="img"
            aria-label={`${agentName}, animated project manager. ${mood.caption}`}
          >
            <LazyAgentAvatarScene eager pointerTracking="window" tool={activeTool} config={avatarConfig} expression={mood.expression} className="h-full w-full" />
          </div>

          {/* Name plate + truthful mood caption — tucked up into the canvas's
              empty lower margin so it never collides with the composer. */}
          <div className="pointer-events-auto -mt-4 text-center md:-mt-12">
            <div className="font-display text-lg font-black tracking-tight text-slate-900 dark:text-white">
              {agentName}
            </div>
            <div aria-live="polite" className="mt-0.5 text-[12px] font-medium text-slate-500 dark:text-slate-400">
              {mood.caption}
            </div>
            <div className="mt-1.5 flex items-center justify-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
              <span className={`h-1 w-1 rounded-full ${activeConnection ? "bg-signal-500" : "bg-slate-300 dark:bg-slate-600"}`} aria-hidden="true" />
              {activeConnection ? `${activeConnection.displayName} · ${activeConnection.status}` : "queued routing"}
            </div>
          </div>
        </div>
      </div>

      {/* ── Latest exchange — only the current beat of the conversation is
             staged: the newest agent reply plus any user messages sent after
             it. History lives one click away in Threads. ── */}
      <div className="absolute inset-x-0 bottom-36 top-[40vh] z-20 flex flex-col justify-end px-4 md:inset-y-0 md:bottom-0 md:left-auto md:right-0 md:w-[46%] md:justify-center md:px-8 md:pb-32 md:pt-16 lg:w-[42%]">
        <div
          role="log"
          aria-label="Latest exchange with the project manager"
          aria-live={visibleMessages.length > 0 ? "polite" : "off"}
          aria-relevant="additions text"
          className="flex min-h-0 flex-col gap-4"
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
                />
              )}
              {pendingUserMessages.map((message) => (
                <UserBubble key={message.id} message={message} allMessages={visibleMessages} />
              ))}
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
                    void handleSend();
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
                onClick={() => void handleSend()}
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
