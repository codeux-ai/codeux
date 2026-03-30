import type { AgentAvatarConfig } from "../types.js";

export type AgentAvatarExpression =
  | "happy"
  | "sad"
  | "angry"
  | "sleepy"
  | "bored"
  | "hyped"
  | "shake_head"
  | "nod";

export const AGENT_AVATAR_EXPRESSIONS: AgentAvatarExpression[] = [
  "happy",
  "sad",
  "angry",
  "sleepy",
  "bored",
  "hyped",
  "shake_head",
  "nod",
];

export const AGENT_AVATAR_BODIES = ["male", "female"];
export const AGENT_AVATAR_HAIRS = ["style1", "style2", "style3", "style4"];
export const AGENT_AVATAR_FACES = ["style1", "style2", "style3", "style4"];
export const AGENT_AVATAR_SHIRTS = ["style1", "style2", "style3", "style4"];
export const AGENT_AVATAR_BOTTOMS = ["style1", "style2", "style3", "style4"];

export const DEFAULT_AGENT_AVATAR_CONFIG: AgentAvatarConfig = {
  body: "male",
  hair: "style1",
  face: "style1",
  shirt: "style1",
  bottom: "style1",
};

/**
 * Deterministically generates a random integer between min and max based on a seed string.
 * Uses a simple hash function.
 */
function deterministicRandomInt(seed: string, min: number, max: number): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }

  // Ensure positive number
  const positiveHash = Math.abs(hash);

  return min + (positiveHash % (max - min + 1));
}

function pickRandom<T>(seed: string, options: T[], salt: string): T {
  const index = deterministicRandomInt(`${seed}-${salt}`, 0, options.length - 1);
  return options[index];
}

export function generateRandomAgentAvatar(seed: string): AgentAvatarConfig {
  if (!seed) {
    return { ...DEFAULT_AGENT_AVATAR_CONFIG };
  }

  return {
    body: pickRandom(seed, AGENT_AVATAR_BODIES, "body"),
    hair: pickRandom(seed, AGENT_AVATAR_HAIRS, "hair"),
    face: pickRandom(seed, AGENT_AVATAR_FACES, "face"),
    shirt: pickRandom(seed, AGENT_AVATAR_SHIRTS, "shirt"),
    bottom: pickRandom(seed, AGENT_AVATAR_BOTTOMS, "bottom"),
  };
}

export function normalizeAgentAvatarConfig(
  config?: Partial<AgentAvatarConfig> | null
): AgentAvatarConfig {
  if (!config) {
    return { ...DEFAULT_AGENT_AVATAR_CONFIG };
  }

  const normalized = { ...DEFAULT_AGENT_AVATAR_CONFIG };

  if (config.body && AGENT_AVATAR_BODIES.includes(config.body)) {
    normalized.body = config.body;
  }
  if (config.hair && AGENT_AVATAR_HAIRS.includes(config.hair)) {
    normalized.hair = config.hair;
  }
  if (config.face && AGENT_AVATAR_FACES.includes(config.face)) {
    normalized.face = config.face;
  }
  if (config.shirt && AGENT_AVATAR_SHIRTS.includes(config.shirt)) {
    normalized.shirt = config.shirt;
  }
  if (config.bottom && AGENT_AVATAR_BOTTOMS.includes(config.bottom)) {
    normalized.bottom = config.bottom;
  }

  return normalized;
}
