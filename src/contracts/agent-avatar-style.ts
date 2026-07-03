import type { AgentAvatarConfig } from "./agent-preset-types.js";

export const AGENT_AVATAR_BODIES = ["male", "female"] as const;
export const AGENT_AVATAR_HAIRS = ["style1", "style2", "style3", "style4"] as const;
export const AGENT_AVATAR_FACES = ["style1", "style2", "style3", "style4"] as const;
export const AGENT_AVATAR_SHIRTS = ["style1", "style2", "style3", "style4"] as const;
export const AGENT_AVATAR_BOTTOMS = ["style1", "style2", "style3", "style4"] as const;

const ROBOT_CHASSIS_IDS = ["classic", "square", "tall", "pebble", "soft"] as const;
const ROBOT_EYE_IDS = ["smile", "visor", "single", "pixel", "heart"] as const;
const ROBOT_ANTENNA_IDS = ["jewel", "bunny", "beam", "wifi", "none"] as const;
const ROBOT_WING_IDS = ["none", "pulse", "dust", "halo", "orbit"] as const;
const ROBOT_HEADPHONE_IDS = ["bumper", "studio", "earbuds", "loop", "fins"] as const;
const ROBOT_ACCENT_IDS = ["jade", "amber", "violet", "coral", "sky", "fuchsia", "emerald", "gold", "crimson", "lavender", "cyan", "rose"] as const;
const ROBOT_BASE_COLOR_IDS = ["pearl", "ivory", "cream", "arctic", "sage", "rose", "onyx", "graphite", "charcoal", "midnight", "navy", "plum"] as const;
const ROBOT_VISOR_COLOR_IDS = ["noir", "pearl", "jade", "void", "ice", "sapphire", "ruby", "violet", "forest", "bronze", "amber", "lilac"] as const;

export const DEFAULT_AGENT_AVATAR_CONFIG: AgentAvatarConfig = {
  body: "male",
  hair: "style1",
  face: "style1",
  shirt: "style1",
  bottom: "style1",
  chassis: "classic",
  eyes: "smile",
  antenna: "jewel",
  wings: "none",
  headphones: "bumper",
  accent: "jade",
  baseColor: "pearl",
};

const BASE_AGENT_AVATAR_CONFIGS: Record<string, AgentAvatarConfig> = {
  worker: {
    body: "female",
    hair: "style4",
    face: "style1",
    shirt: "style2",
    bottom: "style3",
    chassis: "tall",
    eyes: "pixel",
    antenna: "beam",
    wings: "orbit",
    accent: "emerald",
    baseColor: "pearl",
    visorColor: "noir",
    headphones: "fins",
  },
  "project manager": {
    body: "female",
    hair: "style4",
    face: "style1",
    shirt: "style4",
    bottom: "style3",
    chassis: "classic",
    eyes: "smile",
    antenna: "jewel",
    wings: "dust",
    headphones: "bumper",
    accent: "jade",
    baseColor: "arctic",
    visorColor: "noir",
  },
  iris: {
    body: "female",
    hair: "style4",
    face: "style1",
    shirt: "style4",
    bottom: "style3",
    chassis: "classic",
    eyes: "smile",
    antenna: "jewel",
    wings: "dust",
    headphones: "bumper",
    accent: "jade",
    baseColor: "arctic",
    visorColor: "noir",
  },
  "planning agent": {
    body: "male",
    hair: "style3",
    face: "style4",
    shirt: "style3",
    bottom: "style4",
    chassis: "square",
    eyes: "pixel",
    antenna: "beam",
    wings: "halo",
    headphones: "studio",
    accent: "lavender",
    baseColor: "ivory",
    visorColor: "sapphire",
  },
  "quality assurance agent": {
    body: "male",
    hair: "style3",
    face: "style4",
    shirt: "style3",
    bottom: "style2",
    chassis: "tall",
    eyes: "single",
    antenna: "bunny",
    wings: "orbit",
    headphones: "studio",
    accent: "crimson",
    baseColor: "onyx",
    visorColor: "noir",
  },
  "project setup agent": {
    body: "male",
    hair: "style1",
    face: "style4",
    shirt: "style1",
    bottom: "style2",
    chassis: "tall",
    eyes: "smile",
    antenna: "jewel",
    wings: "orbit",
    headphones: "studio",
    accent: "amber",
    baseColor: "midnight",
    visorColor: "noir",
  },
};

function deterministicRandomInt(seed: string, min: number, max: number): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    const char = seed.charCodeAt(index);
    hash = (hash << 5) - hash + char;
    hash &= hash;
  }
  return min + (Math.abs(hash) % (max - min + 1));
}

function pickRandom<T>(seed: string, options: readonly T[], salt: string): T {
  return options[deterministicRandomInt(`${seed}-${salt}`, 0, options.length - 1)]!;
}

export function normalizeAgentAvatarName(value: string): string {
  return value.trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ").toLowerCase();
}

export function getBaseAgentAvatarConfig(name: string): AgentAvatarConfig | null {
  const config = BASE_AGENT_AVATAR_CONFIGS[normalizeAgentAvatarName(name)];
  return config ? { ...config } : null;
}

export function hasAgentAvatarConfig(config?: AgentAvatarConfig | null): config is AgentAvatarConfig {
  return Boolean(config && Object.keys(config).length > 0);
}

export function generateRandomAgentAvatar(seed: string): AgentAvatarConfig {
  if (!seed) return { ...DEFAULT_AGENT_AVATAR_CONFIG };
  return {
    body: pickRandom(seed, AGENT_AVATAR_BODIES, "body"),
    hair: pickRandom(seed, AGENT_AVATAR_HAIRS, "hair"),
    face: pickRandom(seed, AGENT_AVATAR_FACES, "face"),
    shirt: pickRandom(seed, AGENT_AVATAR_SHIRTS, "shirt"),
    bottom: pickRandom(seed, AGENT_AVATAR_BOTTOMS, "bottom"),
    chassis: pickRandom(seed, ROBOT_CHASSIS_IDS, "chassis"),
    eyes: pickRandom(seed, ROBOT_EYE_IDS, "eyes"),
    antenna: pickRandom(seed, ROBOT_ANTENNA_IDS, "antenna"),
    wings: pickRandom(seed, ROBOT_WING_IDS, "wings"),
    headphones: pickRandom(seed, ROBOT_HEADPHONE_IDS, "headphones"),
    accent: pickRandom(seed, ROBOT_ACCENT_IDS, "accent"),
    baseColor: pickRandom(seed, ROBOT_BASE_COLOR_IDS, "baseColor"),
    visorColor: pickRandom(seed, ROBOT_VISOR_COLOR_IDS, "visorColor"),
  };
}

export function resolveAgentAvatarConfig(input: {
  name: string;
  id?: string | null;
  projectId?: string | null;
  labels?: readonly string[];
  seed?: string | null;
}): AgentAvatarConfig {
  const baseConfig = getBaseAgentAvatarConfig(input.name);
  if (baseConfig) {
    return baseConfig;
  }

  const seed = input.seed?.trim()
    || [input.projectId, input.id, input.name, ...(input.labels ?? [])]
      .filter((part): part is string => Boolean(part && part.trim()))
      .join(":");
  return generateRandomAgentAvatar(seed);
}
