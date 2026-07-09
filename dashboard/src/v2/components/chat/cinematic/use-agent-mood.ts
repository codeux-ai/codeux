import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { AgentAvatarExpression } from "../../../lib/agent-avatar.js";
import type { ChatMessageRecord } from "../../../types.js";

/* ════════════════════════════════════════════════════════════════════════
 *  Agent mood engine — maps real runtime state onto avatar choreography.
 *
 *  The stage never fakes emotion: every expression is derived from what the
 *  runtime is actually doing (routing, container spin-up, reply landing,
 *  errors) plus a slow idle decay that wakes the bot when the user types.
 *
 *      error        → sad       "Hit a snag"
 *      sending      → nod       "On it — routing your message"
 *      working      → happy     (thought bubble carries the thinking cue)
 *      reply lands  → hyped     celebratory burst, then settles to happy
 *      idle > 90s   → bored
 *      idle > 240s  → sleepy    (typing instantly wakes it)
 * ════════════════════════════════════════════════════════════════════════ */

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

export interface AgentMoodState {
  mood: AgentMood;
  expression: AgentAvatarExpression;
  /** One-line status shown under the name plate — always truthful to runtime state. */
  caption: string;
}

const BORED_AFTER_MS = 90_000;
const SLEEPY_AFTER_MS = 240_000;
const CELEBRATE_FOR_MS = 2_600;
const IDLE_TICK_MS = 5_000;
/** Calm moods get spontaneous 2s micro-expressions so the bot never freezes. */
const MICRO_EXPRESSIONS: AgentAvatarExpression[] = ["nod", "curious", "wink", "excited", "dance", "proud", "laughing"];
const MICRO_MIN_GAP_MS = 9_000;
const MICRO_MAX_GAP_MS = 20_000;
const MICRO_FOR_MS = 2_200;

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
}

export const useAgentMood = ({
  error,
  sending,
  hasWorkingReply,
  workingPhase,
  messages,
  userEngaged,
  agentName,
}: UseAgentMoodOptions): AgentMoodState => {
  const [celebrating, setCelebrating] = useState(false);
  const [idleMood, setIdleMood] = useState<"idle" | "bored" | "sleepy">("idle");
  const lastActivityRef = useRef<number>(Date.now());
  const lastAgentMessageIdRef = useRef<string | null>(null);

  const latestAgentMessageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      // Agent replies are stored with authorType "system" in this runtime, so
      // only the direction distinguishes them from the user's own messages.
      if (messages[i].direction !== "dashboard_to_connection") {
        return messages[i].id;
      }
    }
    return null;
  }, [messages]);

  /* A new agent reply triggers the celebration burst. */
  useEffect(() => {
    if (!latestAgentMessageId) return;
    if (lastAgentMessageIdRef.current === null) {
      // First observation (initial load) — don't celebrate history.
      lastAgentMessageIdRef.current = latestAgentMessageId;
      return;
    }
    if (lastAgentMessageIdRef.current === latestAgentMessageId) return;
    lastAgentMessageIdRef.current = latestAgentMessageId;
    setCelebrating(true);
    const timer = window.setTimeout(() => setCelebrating(false), CELEBRATE_FOR_MS);
    return () => window.clearTimeout(timer);
  }, [latestAgentMessageId]);

  /* Idle decay — any activity resets the clock; a slow tick escalates it. */
  const activityKey = `${messages.length}|${sending}|${hasWorkingReply}|${userEngaged}`;
  useEffect(() => {
    lastActivityRef.current = Date.now();
    setIdleMood("idle");
  }, [activityKey]);

  useEffect(() => {
    const tick = window.setInterval(() => {
      const idleFor = Date.now() - lastActivityRef.current;
      setIdleMood(idleFor > SLEEPY_AFTER_MS ? "sleepy" : idleFor > BORED_AFTER_MS ? "bored" : "idle");
    }, IDLE_TICK_MS);
    return () => window.clearInterval(tick);
  }, []);

  /* Micro-expressions — spontaneous nods/bounces while nothing is happening,
     so the bot reads as alive rather than parked on a single loop. */
  const [microExpression, setMicroExpression] = useState<AgentAvatarExpression | null>(null);
  const calm = !error && !sending && !hasWorkingReply && !celebrating && idleMood !== "sleepy";
  useEffect(() => {
    if (!calm) {
      setMicroExpression(null);
      return;
    }
    let clearTimer: number | undefined;
    let scheduleTimer: number | undefined;
    const schedule = () => {
      const gap = MICRO_MIN_GAP_MS + Math.random() * (MICRO_MAX_GAP_MS - MICRO_MIN_GAP_MS);
      scheduleTimer = window.setTimeout(() => {
        setMicroExpression(MICRO_EXPRESSIONS[Math.floor(Math.random() * MICRO_EXPRESSIONS.length)]);
        clearTimer = window.setTimeout(() => {
          setMicroExpression(null);
          schedule();
        }, MICRO_FOR_MS);
      }, gap);
    };
    schedule();
    return () => {
      window.clearTimeout(scheduleTimer);
      window.clearTimeout(clearTimer);
      setMicroExpression(null);
    };
  }, [calm]);

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
      caption = workingPhase === "starting"
        ? "Spinning up a workspace for this…"
        : "Thinking it through…";
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

    const expression = (microExpression && (mood === "idle" || mood === "greeting" || mood === "listening"))
      ? microExpression
      : MOOD_EXPRESSION[mood];
    return { mood, expression, caption };
  }, [error, sending, hasWorkingReply, workingPhase, celebrating, userEngaged, messages.length, idleMood, agentName, microExpression]);
};
