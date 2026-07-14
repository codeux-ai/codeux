import {
  AGENT_RESPONSE_ANIMATIONS,
  AGENT_RESPONSE_EFFECT_MAX_CAPTION_LENGTH,
  AGENT_RESPONSE_EFFECT_MAX_DURATION_MS,
  AGENT_RESPONSE_EFFECT_MIN_DURATION_MS,
  AGENT_RESPONSE_EMOTIONS,
  type AgentResponseEffect,
} from "../../../../src/contracts/connection-chat-types.js";

const supportedEmotions = new Set<string>(AGENT_RESPONSE_EMOTIONS);
const supportedAnimations = new Set<string>(AGENT_RESPONSE_ANIMATIONS);
const AGENT_EFFECT_FENCE = /^```codeux:agent[^\n]*\n([\s\S]*?)^```[ \t]*$/gm;

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === "object" && !Array.isArray(value)
);

/** Validate untrusted response metadata against the shared backend bounds. */
export function normalizeAgentResponseEffect(value: unknown): AgentResponseEffect | undefined {
  if (!isRecord(value)) return undefined;

  const { emotion, animation, durationMs } = value;
  if (
    typeof emotion !== "string"
    || !supportedEmotions.has(emotion)
    || typeof animation !== "string"
    || !supportedAnimations.has(animation)
    || typeof durationMs !== "number"
    || !Number.isSafeInteger(durationMs)
    || durationMs < AGENT_RESPONSE_EFFECT_MIN_DURATION_MS
    || durationMs > AGENT_RESPONSE_EFFECT_MAX_DURATION_MS
  ) {
    return undefined;
  }

  const effect: AgentResponseEffect = {
    emotion: emotion as AgentResponseEffect["emotion"],
    animation: animation as AgentResponseEffect["animation"],
    durationMs,
  };
  if (value.caption !== undefined) {
    if (typeof value.caption !== "string") return undefined;
    const caption = value.caption.trim();
    if (!caption || caption.length > AGENT_RESPONSE_EFFECT_MAX_CAPTION_LENGTH) return undefined;
    effect.caption = caption;
  }
  return effect;
}

export function parseAgentResponseEffectJson(rawJson: string): AgentResponseEffect | undefined {
  try {
    return normalizeAgentResponseEffect(JSON.parse(rawJson) as unknown);
  } catch {
    return undefined;
  }
}

export interface ExtractedAgentResponseEffect {
  markdown: string;
  effect?: AgentResponseEffect;
}

/**
 * Remove valid native avatar cues from visible markdown and return the first.
 * Invalid cues are downgraded to ordinary JSON fences so provider output
 * remains inspectable without retaining a dashboard-only fence tag.
 */
export function extractAgentResponseEffect(markdown: string): ExtractedAgentResponseEffect {
  let effect: AgentResponseEffect | undefined;
  AGENT_EFFECT_FENCE.lastIndex = 0;
  const normalizedMarkdown = markdown.replace(AGENT_EFFECT_FENCE, (fence, rawJson: string) => {
    const candidate = parseAgentResponseEffectJson(rawJson);
    if (candidate) {
      effect ??= candidate;
      return "";
    }
    return fence.replace(/^```codeux:agent[^\n]*/, "```json");
  }).replace(/\n{3,}/g, "\n\n").trim();

  return { markdown: normalizedMarkdown, ...(effect ? { effect } : {}) };
}

/** Metadata wins when valid; native fences remain a backward-compatible cue. */
export function resolveAgentResponseEffect(metadata: unknown, markdown: string): AgentResponseEffect | undefined {
  const metadataEffect = isRecord(metadata)
    ? normalizeAgentResponseEffect(metadata.agentEffect)
    : undefined;
  return metadataEffect ?? extractAgentResponseEffect(markdown).effect;
}

export function getAgentResponseEffectCaption(effect: AgentResponseEffect): string {
  if (effect.caption) return effect.caption;
  return `Feeling ${effect.emotion}.`;
}
