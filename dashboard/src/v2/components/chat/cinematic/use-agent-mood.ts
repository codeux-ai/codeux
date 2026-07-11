import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { AgentResponseAnimation } from "../../../../../../src/contracts/connection-chat-types.js";
import type { AgentAvatarExpression } from "../../../lib/agent-avatar.js";
import type { ChatMessageRecord } from "../../../types.js";

export type AgentMood =
  | "greeting"
  | "idle"
  | "listening"
  | "routing"
  | "thinking"
  | "celebrating"
  | "error"
  | "bored"
  | "sleepy";

export type AgentAmbientCueKind = "wink" | "dance" | "sing" | "curious" | "greeting" | "welcome_back";

export interface AgentAmbientCue {
  kind: AgentAmbientCueKind;
  expression: AgentAvatarExpression;
  animation?: AgentResponseAnimation;
  label: string;
  showNotes: boolean;
}

export interface AgentMoodState {
  mood: AgentMood;
  expression: AgentAvatarExpression;
  /** One-line status shown under the name plate — always truthful to runtime state. */
  caption: string;
  /** A bounded decorative beat. Its text is visible but intentionally not live-announced. */
  ambientCue: AgentAmbientCue | null;
  /** False whenever decorative motion or its timers must be suspended. */
  ambientMotionEnabled: boolean;
}

const BORED_AFTER_MS = 90_000;
const SLEEPY_AFTER_MS = 240_000;
const CELEBRATE_FOR_MS = 2_600;
const IDLE_TICK_MS = 5_000;
export const AGENT_IDLE_CUE_GAP_MS = 12_000;
export const AGENT_AMBIENT_CUE_FOR_MS = 2_800;
export const AGENT_RETURN_GREETING_AFTER_MS = 30_000;

const IDLE_CUES: readonly AgentAmbientCue[] = [
  { kind: "wink", expression: "wink", animation: "wink", label: "Still with you.", showNotes: false },
  { kind: "dance", expression: "dance", animation: "dance", label: "Tiny stretch break.", showNotes: false },
  { kind: "sing", expression: "happy", animation: "nod", label: "Humming while I wait.", showNotes: true },
  { kind: "curious", expression: "curious", animation: "nod", label: "What shall we explore next?", showNotes: false },
  { kind: "greeting", expression: "proud", animation: "hyped", label: "Ready when you are.", showNotes: false },
];

const WELCOME_BACK_CUE: AgentAmbientCue = {
  kind: "welcome_back",
  expression: "happy",
  animation: "hyped",
  label: "Welcome back — I’m ready when you are.",
  showNotes: false,
};

const MOOD_EXPRESSION: Record<AgentMood, AgentAvatarExpression> = {
  greeting: "happy",
  idle: "happy",
  listening: "curious",
  routing: "nod",
  thinking: "thinking",
  celebrating: "excited",
  error: "sad",
  bored: "bored",
  sleepy: "sleepy",
};

export interface UseAgentMoodOptions {
  error: string | null;
  sending: boolean;
  hasWorkingReply: boolean;
  workingPhase: "starting" | "working" | null;
  messages: ChatMessageRecord[];
  /** True while the composer has focus or draft text — keeps the bot attentive. */
  userEngaged: boolean;
  agentName: string;
  reducedMotion?: boolean;
  /** Pauses idle choreography while another bounded response effect owns the avatar. */
  ambientPaused?: boolean;
  /** Primarily configurable so hosts and fake-timer tests can share one threshold. */
  returnGreetingAfterMs?: number;
}

export const useAgentMood = ({
  error,
  sending,
  hasWorkingReply,
  workingPhase,
  messages,
  userEngaged,
  agentName,
  reducedMotion = false,
  ambientPaused = false,
  returnGreetingAfterMs = AGENT_RETURN_GREETING_AFTER_MS,
}: UseAgentMoodOptions): AgentMoodState => {
  const [celebrating, setCelebrating] = useState(false);
  const [idleMood, setIdleMood] = useState<"idle" | "bored" | "sleepy">("idle");
  const [pagePresent, setPagePresent] = useState(() => typeof document === "undefined" || !document.hidden);
  const [ambientCue, setAmbientCue] = useState<AgentAmbientCue | null>(null);
  const lastActivityRef = useRef<number>(Date.now());
  const awayAtRef = useRef<number | null>(null);
  const lastAgentMessageIdRef = useRef<string | null>(null);
  const nextCueIndexRef = useRef(0);
  const ambientSuppressed = Boolean(error || sending || hasWorkingReply || reducedMotion || ambientPaused);
  const ambientMotionEnabled = pagePresent && !ambientSuppressed;

  const latestAgentMessageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].direction !== "dashboard_to_connection") return messages[i].id;
    }
    return null;
  }, [messages]);

  useEffect(() => {
    if (!latestAgentMessageId) return;
    if (lastAgentMessageIdRef.current === null) {
      lastAgentMessageIdRef.current = latestAgentMessageId;
      return;
    }
    if (lastAgentMessageIdRef.current === latestAgentMessageId) return;
    lastAgentMessageIdRef.current = latestAgentMessageId;
    setCelebrating(true);
    const timer = window.setTimeout(() => setCelebrating(false), CELEBRATE_FOR_MS);
    return () => window.clearTimeout(timer);
  }, [latestAgentMessageId]);

  const activityKey = `${messages.length}|${sending}|${hasWorkingReply}|${userEngaged}`;
  useEffect(() => {
    lastActivityRef.current = Date.now();
    setIdleMood("idle");
    setAmbientCue(null);
  }, [activityKey]);

  useEffect(() => {
    const tick = window.setInterval(() => {
      const idleFor = Date.now() - lastActivityRef.current;
      setIdleMood(idleFor > SLEEPY_AFTER_MS ? "sleepy" : idleFor > BORED_AFTER_MS ? "bored" : "idle");
    }, IDLE_TICK_MS);
    return () => window.clearInterval(tick);
  }, []);

  /* Visibility and focus share an away timestamp. A brief tab switch does not
     produce a greeting; a genuinely hidden or already-idle stage does. */
  useEffect(() => {
    if (typeof document === "undefined" || typeof window === "undefined") return;
    const leave = (): void => {
      awayAtRef.current ??= Date.now();
      setPagePresent(false);
      setAmbientCue(null);
    };
    const enter = (): void => {
      if (document.hidden) return;
      const now = Date.now();
      const awayFor = awayAtRef.current === null ? 0 : now - awayAtRef.current;
      const idleFor = now - lastActivityRef.current;
      awayAtRef.current = null;
      setPagePresent(true);
      if (!ambientSuppressed && (awayFor >= returnGreetingAfterMs || idleFor >= returnGreetingAfterMs)) {
        setAmbientCue(WELCOME_BACK_CUE);
      }
    };
    const visibilityChanged = (): void => document.hidden ? leave() : enter();
    document.addEventListener("visibilitychange", visibilityChanged);
    window.addEventListener("blur", leave);
    window.addEventListener("focus", enter);
    window.addEventListener("pageshow", enter);
    return () => {
      document.removeEventListener("visibilitychange", visibilityChanged);
      window.removeEventListener("blur", leave);
      window.removeEventListener("focus", enter);
      window.removeEventListener("pageshow", enter);
    };
  }, [ambientSuppressed, returnGreetingAfterMs]);

  useEffect(() => {
    if (!ambientMotionEnabled || celebrating || userEngaged || idleMood === "sleepy" || ambientCue) return;
    const timer = window.setTimeout(() => {
      const cue = IDLE_CUES[nextCueIndexRef.current % IDLE_CUES.length];
      nextCueIndexRef.current += 1;
      setAmbientCue(cue);
    }, AGENT_IDLE_CUE_GAP_MS);
    return () => window.clearTimeout(timer);
  }, [ambientMotionEnabled, celebrating, userEngaged, idleMood, ambientCue]);

  useEffect(() => {
    if (!ambientCue || !ambientMotionEnabled) {
      if (ambientCue && !ambientMotionEnabled) setAmbientCue(null);
      return;
    }
    const timer = window.setTimeout(() => setAmbientCue(null), AGENT_AMBIENT_CUE_FOR_MS);
    return () => window.clearTimeout(timer);
  }, [ambientCue, ambientMotionEnabled]);

  return useMemo<AgentMoodState>(() => {
    let mood: AgentMood;
    let caption: string;

    if (error) {
      mood = "error";
      caption = "Hit a snag — the details are in the banner above.";
    } else if (sending) {
      mood = "routing";
      caption = "Got it — routing your message.";
    } else if (hasWorkingReply) {
      mood = "thinking";
      caption = workingPhase === "starting" ? "Spinning up a workspace for this…" : "Thinking it through…";
    } else if (celebrating) {
      mood = "celebrating";
      caption = "Fresh answer, just landed.";
    } else if (userEngaged) {
      mood = "listening";
      caption = "Listening…";
    } else if (messages.length === 0) {
      mood = "greeting";
      caption = "Ready when you are.";
    } else if (idleMood === "sleepy") {
      mood = "sleepy";
      caption = "Snoozing — say anything to wake me.";
    } else if (idleMood === "bored") {
      mood = "bored";
      caption = "Standing by.";
    } else {
      mood = "idle";
      caption = `${agentName} is up to date on this thread.`;
    }

    const expression = ambientCue && (mood === "idle" || mood === "greeting")
      ? ambientCue.expression
      : MOOD_EXPRESSION[mood];
    return { mood, expression, caption, ambientCue, ambientMotionEnabled };
  }, [error, sending, hasWorkingReply, workingPhase, celebrating, userEngaged, messages.length, idleMood, agentName, ambientCue, ambientMotionEnabled]);
};
