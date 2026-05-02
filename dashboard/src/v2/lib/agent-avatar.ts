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

/** Expressions shown as quick-preview buttons on the detail panel */
export const SHOWCASE_EXPRESSIONS: AgentAvatarExpression[] = [
  "happy",
  "sad",
  "angry",
  "bored",
  "hyped",
];

/* ── Legacy humanoid options (kept for backward compat) ── */
export const AGENT_AVATAR_BODIES = ["male", "female"];
export const AGENT_AVATAR_HAIRS = ["style1", "style2", "style3", "style4"];
export const AGENT_AVATAR_FACES = ["style1", "style2", "style3", "style4"];
export const AGENT_AVATAR_SHIRTS = ["style1", "style2", "style3", "style4"];
export const AGENT_AVATAR_BOTTOMS = ["style1", "style2", "style3", "style4"];

/* ── Robot part catalogues ── */
export const ROBOT_CHASSIS_OPTIONS = [
  { id: "round", label: "Pebble" },
  { id: "egg", label: "Companion" },
  { id: "capsule", label: "Pod" },
  { id: "square", label: "Bumper" },
] as const;

export const ROBOT_EYE_OPTIONS = [
  { id: "dual", label: "Dual" },
  { id: "visor", label: "Visor" },
  { id: "pixel", label: "Pixel" },
  { id: "cyclops", label: "Cyclops" },
] as const;

export const ROBOT_ANTENNA_OPTIONS = [
  { id: "single", label: "Beacon" },
  { id: "dual", label: "Twin" },
  { id: "dish", label: "Dish" },
  { id: "none", label: "None" },
] as const;

export const ROBOT_WING_OPTIONS = [
  { id: "propeller", label: "Halo" },
  { id: "tiny", label: "Side Pods" },
  { id: "hover", label: "Hover Rings" },
  { id: "jets", label: "Boosters" },
] as const;

export const ROBOT_ACCENT_OPTIONS = [
  { id: "jade", label: "Signal Jade", hex: "#00E0A0" },
  { id: "amber", label: "Ember Amber", hex: "#FFB800" },
  { id: "violet", label: "Cosmic Violet", hex: "#8B5CF6" },
  { id: "coral", label: "Warm Coral", hex: "#FF6B6B" },
  { id: "sky", label: "Sky Blue", hex: "#38BDF8" },
  { id: "pink", label: "Bubblegum", hex: "#F472B6" },
] as const;

export const ROBOT_BASE_COLOR_OPTIONS = [
  { id: "onyx", label: "Onyx", hex: "#1e1e2e" },
  { id: "graphite", label: "Graphite", hex: "#2d2d3d" },
  { id: "midnight", label: "Midnight", hex: "#141432" },
  { id: "steel", label: "Steel", hex: "#3a3a4a" },
  { id: "ivory", label: "Ivory", hex: "#e8e4dc" },
  { id: "arctic", label: "Arctic", hex: "#d0dce8" },
] as const;

export type RobotChassis = typeof ROBOT_CHASSIS_OPTIONS[number]["id"];
export type RobotEyes = typeof ROBOT_EYE_OPTIONS[number]["id"];
export type RobotAntenna = typeof ROBOT_ANTENNA_OPTIONS[number]["id"];
export type RobotWings = typeof ROBOT_WING_OPTIONS[number]["id"];
export type RobotAccent = typeof ROBOT_ACCENT_OPTIONS[number]["id"];
export type RobotBaseColor = typeof ROBOT_BASE_COLOR_OPTIONS[number]["id"];

export const DEFAULT_AGENT_AVATAR_CONFIG: AgentAvatarConfig = {
  body: "male",
  hair: "style1",
  face: "style1",
  shirt: "style1",
  bottom: "style1",
  chassis: "round",
  eyes: "dual",
  antenna: "single",
  wings: "propeller",
  accent: "jade",
  baseColor: "onyx",
};

/** Get accent hex color from accent id */
export function getAccentHex(accentId?: string): string {
  const found = ROBOT_ACCENT_OPTIONS.find((o) => o.id === accentId);
  return found?.hex ?? "#00E0A0";
}

/** Get base color hex from base color id */
export function getBaseColorHex(baseColorId?: string): string {
  const found = ROBOT_BASE_COLOR_OPTIONS.find((o) => o.id === baseColorId);
  return found?.hex ?? "#1e1e2e";
}

/**
 * Deterministically generates a random integer between min and max based on a seed string.
 */
function deterministicRandomInt(seed: string, min: number, max: number): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  const positiveHash = Math.abs(hash);
  return min + (positiveHash % (max - min + 1));
}

function pickRandom<T>(seed: string, options: readonly T[], salt: string): T {
  const index = deterministicRandomInt(`${seed}-${salt}`, 0, options.length - 1);
  return options[index];
}

function pickRandomId<T extends { id: string }>(seed: string, options: readonly T[], salt: string): string {
  return pickRandom(seed, options, salt).id;
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
    chassis: pickRandomId(seed, ROBOT_CHASSIS_OPTIONS, "chassis"),
    eyes: pickRandomId(seed, ROBOT_EYE_OPTIONS, "eyes"),
    antenna: pickRandomId(seed, ROBOT_ANTENNA_OPTIONS, "antenna"),
    wings: pickRandomId(seed, ROBOT_WING_OPTIONS, "wings"),
    accent: pickRandomId(seed, ROBOT_ACCENT_OPTIONS, "accent"),
    baseColor: pickRandomId(seed, ROBOT_BASE_COLOR_OPTIONS, "baseColor"),
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

  const chassisIds = ROBOT_CHASSIS_OPTIONS.map((o) => o.id as string);
  const eyeIds = ROBOT_EYE_OPTIONS.map((o) => o.id as string);
  const antennaIds = ROBOT_ANTENNA_OPTIONS.map((o) => o.id as string);
  const wingIds = ROBOT_WING_OPTIONS.map((o) => o.id as string);
  const accentIds = ROBOT_ACCENT_OPTIONS.map((o) => o.id as string);

  if (config.chassis && chassisIds.includes(config.chassis)) {
    normalized.chassis = config.chassis;
  }
  if (config.eyes && eyeIds.includes(config.eyes)) {
    normalized.eyes = config.eyes;
  }
  if (config.antenna && antennaIds.includes(config.antenna)) {
    normalized.antenna = config.antenna;
  }
  if (config.wings && wingIds.includes(config.wings)) {
    normalized.wings = config.wings;
  }
  if (config.accent && accentIds.includes(config.accent)) {
    normalized.accent = config.accent;
  }

  const baseColorIds = ROBOT_BASE_COLOR_OPTIONS.map((o) => o.id as string);
  if (config.baseColor && baseColorIds.includes(config.baseColor)) {
    normalized.baseColor = config.baseColor;
  }

  return normalized;
}
