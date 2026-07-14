import type { AgentAvatarConfig } from "../types.js";
import type { DashboardLocale } from "../i18n/index.js";

/* ════════════════════════════════════════════════════════════════════════
 *  Avatar expressions
 * ════════════════════════════════════════════════════════════════════════
 *  Each expression maps onto idle / blink / arc-shape / antenna behavior in
 *  both the SVG and the WebGL avatar so the look stays one-to-one across
 *  surfaces. Keep this list in sync with renderer switch statements.
 * ════════════════════════════════════════════════════════════════════════ */

export type AgentAvatarExpression =
  | "happy"
  | "sad"
  | "angry"
  | "sleepy"
  | "bored"
  | "hyped"
  | "shake_head"
  | "nod"
  | "curious"
  | "thinking"
  | "excited"
  | "laughing"
  | "surprised"
  | "wink"
  | "dance"
  | "proud";

export const AGENT_AVATAR_EXPRESSIONS: AgentAvatarExpression[] = [
  "happy",
  "sad",
  "angry",
  "sleepy",
  "bored",
  "hyped",
  "shake_head",
  "nod",
  "curious",
  "thinking",
  "excited",
  "laughing",
  "surprised",
  "wink",
  "dance",
  "proud",
];

export const SHOWCASE_EXPRESSIONS: AgentAvatarExpression[] = [
  "happy",
  "sad",
  "angry",
  "bored",
  "hyped",
];

/* ════════════════════════════════════════════════════════════════════════
 *  Brand DNA — the canonical Code UX logo palette.
 * ════════════════════════════════════════════════════════════════════════ */
export const BRAND_COLORS = {
  onyx: "#050507",
  shellLight: "#FCFBFC",
  shellWarm: "#F4F1EA",
  inkFace: "#010101",
  bezel: "#101010",
  jade: "#00EAAB",
  jadeBright: "#34FFC4",
  jadeShadow: "#04C58F",
} as const;

/* ── Legacy humanoid options (kept for backward compat with stored data) ── */
export const AGENT_AVATAR_BODIES = ["male", "female"];
export const AGENT_AVATAR_HAIRS = ["style1", "style2", "style3", "style4"];
export const AGENT_AVATAR_FACES = ["style1", "style2", "style3", "style4"];
export const AGENT_AVATAR_SHIRTS = ["style1", "style2", "style3", "style4"];
export const AGENT_AVATAR_BOTTOMS = ["style1", "style2", "style3", "style4"];

/* ════════════════════════════════════════════════════════════════════════
 *  Robot part catalogues
 *
 *  Five options per category, curated to stay inside logo DNA.
 *  All renderers (SVG + 3D) must understand each id.
 * ════════════════════════════════════════════════════════════════════════ */

export const ROBOT_CHASSIS_OPTIONS = [
  { id: "classic", label: "Classic" },
  { id: "square",  label: "Square" },
  { id: "tall",    label: "Tall" },
  { id: "pebble",  label: "Pebble" },
  { id: "soft",    label: "Soft" },        // NEW — extra-rounded squircle
] as const;

export const ROBOT_EYE_OPTIONS = [
  { id: "smile",  label: "Smile Arcs" },
  { id: "visor",  label: "Visor" },
  { id: "single", label: "Single Lens" },
  { id: "pixel",  label: "Pixel" },
  { id: "heart",  label: "Heart" },        // NEW
] as const;

export const ROBOT_ANTENNA_OPTIONS = [
  { id: "jewel", label: "Jewel" },
  { id: "bunny", label: "Bunny" },
  { id: "beam",  label: "Beacon" },
  { id: "wifi",  label: "Signal" },        // NEW — three arc waves
  { id: "none",  label: "None" },
] as const;

/** Aura — stored in the legacy `wings` config field for backward compat. */
export const ROBOT_WING_OPTIONS = [
  { id: "none",  label: "Clean" },
  { id: "pulse", label: "Pulse" },
  { id: "dust",  label: "Jade Dust" },
  { id: "halo",  label: "Halo" },
  { id: "orbit", label: "Orbit" },         // NEW — orbiting jade satellites
] as const;

/** Headphones — five different side-of-head styles. */
export const ROBOT_HEADPHONES_OPTIONS = [
  { id: "bumper",  label: "Bumper" },      // logo default — flat ear caps
  { id: "studio",  label: "Studio" },      // over-ear cups with jade pad
  { id: "earbuds", label: "Earbuds" },     // small clip-on spheres
  { id: "loop",    label: "Halo Loop" },   // jade ring frames
  { id: "fins",    label: "Wing Fins" },   // sleek angled fins
] as const;

/* ════════════════════════════════════════════════════════════════════════
 *  Color palettes — 12 accents and 12 base colors, curated for harmony
 *  with the jade brand mark. Visor color reuses the accent palette.
 * ════════════════════════════════════════════════════════════════════════ */
export const ROBOT_ACCENT_OPTIONS = [
  { id: "jade",     label: "Signal Jade",  hex: BRAND_COLORS.jade },
  { id: "amber",    label: "Ember Amber",  hex: "#FFB347" },
  { id: "violet",   label: "Cosmic Violet", hex: "#A78BFA" },
  { id: "coral",    label: "Warm Coral",   hex: "#FF8FA3" },
  { id: "sky",      label: "Sky Blue",     hex: "#7DD3FC" },
  { id: "fuchsia",  label: "Neon Fuchsia", hex: "#F472B6" },
  /* NEW (+6) */
  { id: "emerald",  label: "Forest Emerald", hex: "#10B981" },
  { id: "gold",     label: "Luxe Gold",      hex: "#FBBF24" },
  { id: "crimson",  label: "Crimson",        hex: "#EF4444" },
  { id: "lavender", label: "Lavender",       hex: "#C4B5FD" },
  { id: "cyan",     label: "Electric Cyan",  hex: "#06B6D4" },
  { id: "rose",     label: "Rose Quartz",    hex: "#FB7185" },
] as const;

/* ────────────────────────────────────────────────────────────────────────
 *  Visor palette (12) — DEDICATED list, curated for contrast across all
 *  chassis colors. Mixes pure darks (noir, void, forest), pure lights
 *  (pearl, ice, lilac), the brand jade, and saturated jewel tones that
 *  pop against any neutral chassis.
 * ──────────────────────────────────────────────────────────────────────── */
export const ROBOT_VISOR_COLOR_OPTIONS = [
  { id: "noir",     label: "Noir",       hex: "#0A0A0E" },
  { id: "pearl",    label: "Pearl",      hex: "#F5F1E8" },
  { id: "jade",     label: "Signal Jade", hex: BRAND_COLORS.jade },
  { id: "void",     label: "Void",       hex: "#1A1B2E" },
  { id: "ice",      label: "Ice",        hex: "#E0F2FE" },
  { id: "sapphire", label: "Sapphire",   hex: "#1E40AF" },
  { id: "ruby",     label: "Ruby",       hex: "#9F1239" },
  { id: "violet",   label: "Royal Violet", hex: "#6B21A8" },
  { id: "forest",   label: "Forest",     hex: "#064E3B" },
  { id: "bronze",   label: "Bronze",     hex: "#92400E" },
  { id: "amber",    label: "Vivid Amber", hex: "#D97706" },
  { id: "lilac",    label: "Lilac",      hex: "#C4B5FD" },
] as const;

/* ────────────────────────────────────────────────────────────────────────
 *  Base color palette (12) — IS the chassis color (no longer inverted).
 *  Six lights (default + variants) and six darks.
 *  Pearl is the brand default — it matches the logo's white body exactly.
 * ──────────────────────────────────────────────────────────────────────── */
export const ROBOT_BASE_COLOR_OPTIONS = [
  { id: "pearl",    label: "Pearl",       hex: BRAND_COLORS.shellLight }, // logo white — default
  { id: "ivory",    label: "Ivory",       hex: BRAND_COLORS.shellWarm },
  { id: "cream",    label: "Cream",       hex: "#F5EFE0" },
  { id: "arctic",   label: "Arctic",      hex: "#E5ECF3" },
  { id: "sage",     label: "Sage",        hex: "#D9E3D3" },
  { id: "rose",     label: "Rose Dust",   hex: "#F2D6D2" },
  { id: "onyx",     label: "Onyx",        hex: BRAND_COLORS.onyx },
  { id: "graphite", label: "Graphite",    hex: "#1B1B22" },
  { id: "charcoal", label: "Charcoal",    hex: "#2A2C33" },
  { id: "midnight", label: "Midnight",    hex: "#0B1023" },
  { id: "navy",     label: "Deep Navy",   hex: "#0F1E3D" },
  { id: "plum",     label: "Plum Noir",   hex: "#1F0F2A" },
] as const;

const GERMAN_AVATAR_OPTION_LABELS: Readonly<Record<string, string>> = {
  Classic: "Klassisch", Square: "Eckig", Tall: "Hoch", Pebble: "Kiesel", Soft: "Weich",
  "Smile Arcs": "Lächelbögen", Visor: "Visier", "Single Lens": "Einzellinse", Pixel: "Pixel", Heart: "Herz",
  Jewel: "Juwel", Bunny: "Hasenohren", Beacon: "Leuchtfeuer", Signal: "Signal", None: "Keine",
  Clean: "Schlicht", Pulse: "Puls", "Jade Dust": "Jadestaub", Halo: "Halo", Orbit: "Umlaufbahn",
  Bumper: "Stoßfänger", Studio: "Studio", Earbuds: "Ohrhörer", "Halo Loop": "Halo-Ring", "Wing Fins": "Flügelfinnen",
  "Signal Jade": "Signaljade", "Ember Amber": "Glutbernstein", "Cosmic Violet": "Kosmisches Violett",
  "Warm Coral": "Warmes Korall", "Sky Blue": "Himmelblau", "Neon Fuchsia": "Neonfuchsia",
  "Forest Emerald": "Waldsmaragd", "Luxe Gold": "Luxusgold", Crimson: "Karminrot", Lavender: "Lavendel",
  "Electric Cyan": "Elektrisches Cyan", "Rose Quartz": "Rosenquarz", Noir: "Noir", Pearl: "Perlmutt",
  Void: "Leere", Ice: "Eis", Sapphire: "Saphir", Ruby: "Rubin", "Royal Violet": "Königsviolett",
  Forest: "Wald", Bronze: "Bronze", "Vivid Amber": "Leuchtendes Bernstein", Lilac: "Flieder",
  Ivory: "Elfenbein", Cream: "Creme", Arctic: "Arktis", Sage: "Salbei", "Rose Dust": "Rosenstaub",
  Onyx: "Onyx", Graphite: "Graphit", Charcoal: "Anthrazit", Midnight: "Mitternacht", "Deep Navy": "Tiefes Marineblau",
  "Plum Noir": "Pflaumen-Noir",
};

export const getAgentAvatarOptionLabel = (label: string, locale: DashboardLocale): string => (
  locale === "de" ? GERMAN_AVATAR_OPTION_LABELS[label] ?? label : label
);

export type RobotChassis    = typeof ROBOT_CHASSIS_OPTIONS[number]["id"];
export type RobotEyes       = typeof ROBOT_EYE_OPTIONS[number]["id"];
export type RobotAntenna    = typeof ROBOT_ANTENNA_OPTIONS[number]["id"];
export type RobotWings      = typeof ROBOT_WING_OPTIONS[number]["id"];
export type RobotHeadphones = typeof ROBOT_HEADPHONES_OPTIONS[number]["id"];
export type RobotAccent     = typeof ROBOT_ACCENT_OPTIONS[number]["id"];
export type RobotBaseColor  = typeof ROBOT_BASE_COLOR_OPTIONS[number]["id"];

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
  // Pearl is the brand white — pairs with the logo silhouette out of the
  // box. Users pick a different base to recolor the chassis directly.
  baseColor: "pearl",
  // visorColor intentionally unset — falls back to a contrast-matched
  // dark/light inset derived from the (now direct) base color.
};

/* ── Color helpers ── */
export function getAccentHex(accentId?: string): string {
  const found = ROBOT_ACCENT_OPTIONS.find((o) => o.id === accentId);
  return found?.hex ?? BRAND_COLORS.jade;
}

export function getBaseColorHex(baseColorId?: string): string {
  const found = ROBOT_BASE_COLOR_OPTIONS.find((o) => o.id === baseColorId);
  return found?.hex ?? BRAND_COLORS.onyx;
}

/**
 * Returns true when the base color is in the "light" group (whites, creams,
 * pastels). Used to choose contrasting defaults for the inset face, bezel,
 * and lighting hints in the 3D scene.
 */
export function isLightBase(baseColorId?: string): boolean {
  return (
    baseColorId === "pearl"  ||
    baseColorId === "ivory"  ||
    baseColorId === "cream"  ||
    baseColorId === "arctic" ||
    baseColorId === "sage"   ||
    baseColorId === "rose"
  );
}

/**
 * The chassis color — the bot's main body.
 * As of the latest brand-direction change, base color drives this directly
 * (no longer inverted). A "pearl" base produces a white body; an "onyx"
 * base produces a black body.
 */
export function getShellHex(baseColorId?: string): string {
  return getBaseColorHex(baseColorId);
}

/**
 * Inset face / "visor" color — the screen plate around the eyes.
 *
 * If the user has explicitly picked a `visorColor`, that wins. Otherwise
 * we auto-pick a contrasting dark/light plate so the eyes still pop:
 *   • light chassis → near-black plate (logo default look)
 *   • dark chassis  → near-white plate
 */
export function getInsetHex(baseColorId?: string, visorColorId?: string): string {
  if (visorColorId) {
    const found = ROBOT_VISOR_COLOR_OPTIONS.find((o) => o.id === visorColorId);
    if (found) return found.hex;
  }
  return isLightBase(baseColorId) ? BRAND_COLORS.inkFace : BRAND_COLORS.shellLight;
}

/** Deterministic seeded RNG */
function deterministicRandomInt(seed: string, min: number, max: number): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return min + (Math.abs(hash) % (max - min + 1));
}

function pickRandom<T>(seed: string, options: readonly T[], salt: string): T {
  const index = deterministicRandomInt(`${seed}-${salt}`, 0, options.length - 1);
  return options[index];
}

function pickRandomId<T extends { id: string }>(seed: string, options: readonly T[], salt: string): string {
  return pickRandom(seed, options, salt).id;
}

export function generateRandomAgentAvatar(seed: string): AgentAvatarConfig {
  if (!seed) return { ...DEFAULT_AGENT_AVATAR_CONFIG };
  return {
    body: pickRandom(seed, AGENT_AVATAR_BODIES, "body"),
    hair: pickRandom(seed, AGENT_AVATAR_HAIRS, "hair"),
    face: pickRandom(seed, AGENT_AVATAR_FACES, "face"),
    shirt: pickRandom(seed, AGENT_AVATAR_SHIRTS, "shirt"),
    bottom: pickRandom(seed, AGENT_AVATAR_BOTTOMS, "bottom"),
    chassis:    pickRandomId(seed, ROBOT_CHASSIS_OPTIONS,    "chassis"),
    eyes:       pickRandomId(seed, ROBOT_EYE_OPTIONS,        "eyes"),
    antenna:    pickRandomId(seed, ROBOT_ANTENNA_OPTIONS,    "antenna"),
    wings:      pickRandomId(seed, ROBOT_WING_OPTIONS,       "wings"),
    headphones: pickRandomId(seed, ROBOT_HEADPHONES_OPTIONS, "headphones"),
    accent:     pickRandomId(seed, ROBOT_ACCENT_OPTIONS,     "accent"),
    baseColor:  pickRandomId(seed, ROBOT_BASE_COLOR_OPTIONS, "baseColor"),
    visorColor: pickRandomId(seed, ROBOT_VISOR_COLOR_OPTIONS, "visorColor"),
  };
}

export function normalizeAgentAvatarConfig(
  config?: Partial<AgentAvatarConfig> | null
): AgentAvatarConfig {
  if (!config) return { ...DEFAULT_AGENT_AVATAR_CONFIG };

  const normalized = { ...DEFAULT_AGENT_AVATAR_CONFIG };

  if (config.body && AGENT_AVATAR_BODIES.includes(config.body))     normalized.body = config.body;
  if (config.hair && AGENT_AVATAR_HAIRS.includes(config.hair))      normalized.hair = config.hair;
  if (config.face && AGENT_AVATAR_FACES.includes(config.face))      normalized.face = config.face;
  if (config.shirt && AGENT_AVATAR_SHIRTS.includes(config.shirt))   normalized.shirt = config.shirt;
  if (config.bottom && AGENT_AVATAR_BOTTOMS.includes(config.bottom)) normalized.bottom = config.bottom;

  const validate = <T extends { id: string }>(value: string | undefined, opts: readonly T[]): string | undefined =>
    value && opts.some((o) => o.id === value) ? value : undefined;

  const c = validate(config.chassis,    ROBOT_CHASSIS_OPTIONS);
  if (c) normalized.chassis = c;
  const e = validate(config.eyes,       ROBOT_EYE_OPTIONS);
  if (e) normalized.eyes = e;
  const a = validate(config.antenna,    ROBOT_ANTENNA_OPTIONS);
  if (a) normalized.antenna = a;
  const w = validate(config.wings,      ROBOT_WING_OPTIONS);
  if (w) normalized.wings = w;
  const hp = validate(config.headphones, ROBOT_HEADPHONES_OPTIONS);
  if (hp) normalized.headphones = hp;
  const ac = validate(config.accent,    ROBOT_ACCENT_OPTIONS);
  if (ac) normalized.accent = ac;
  const bc = validate(config.baseColor, ROBOT_BASE_COLOR_OPTIONS);
  if (bc) normalized.baseColor = bc;
  const vc = validate(config.visorColor, ROBOT_VISOR_COLOR_OPTIONS);
  if (vc) normalized.visorColor = vc;

  return normalized;
}

/* ════════════════════════════════════════════════════════════════════════
 *  Chassis proportion table — shared by SVG + 3D
 * ════════════════════════════════════════════════════════════════════════ */
export interface ChassisProportions {
  width: number;
  height: number;
  depth: number;
  cornerRadius: number;
  earOffset: number;
  earSize: number;
}

export const CHASSIS_PROPORTIONS: Record<string, ChassisProportions> = {
  classic: { width: 1.00, height: 1.00, depth: 0.55, cornerRadius: 0.26, earOffset: 0.50, earSize: 0.18 },
  square:  { width: 1.05, height: 1.00, depth: 0.55, cornerRadius: 0.14, earOffset: 0.52, earSize: 0.17 },
  tall:    { width: 0.92, height: 1.18, depth: 0.55, cornerRadius: 0.28, earOffset: 0.46, earSize: 0.16 },
  pebble:  { width: 1.18, height: 0.92, depth: 0.55, cornerRadius: 0.32, earOffset: 0.60, earSize: 0.18 },
  soft:    { width: 1.04, height: 1.04, depth: 0.55, cornerRadius: 0.48, earOffset: 0.52, earSize: 0.19 },
};

export function getChassisProportions(chassisId?: string): ChassisProportions {
  return CHASSIS_PROPORTIONS[chassisId ?? "classic"] ?? CHASSIS_PROPORTIONS.classic;
}
