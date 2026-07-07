export interface AgentFlashlightPointer {
  x: number;
  y: number;
  active: boolean;
}

export interface AgentFlashlightFrameOptions {
  elapsedSeconds: number;
  pointer: AgentFlashlightPointer;
  reducedMotion?: boolean;
}

export interface AgentFlashlightFrame {
  originX: number;
  originY: number;
  targetX: number;
  targetY: number;
  angleRad: number;
  distance: number;
  intensity: number;
  beamOpacity: number;
  targetGlowScale: number;
}

export interface LowBatteryFlickerOptions {
  nowMs: number;
  eventStartMs: number | null;
  durationMs?: number;
}

export interface LowBatteryFlickerFrame {
  active: boolean;
  intensityMultiplier: number;
  beamOpacityMultiplier: number;
  overlayOpacity: number;
  jitterX: number;
  jitterY: number;
}

export interface NextLowBatteryFlickerOptions {
  afterMs: number;
  seed: string | number | null | undefined;
}

export const LOW_BATTERY_FLICKER_DURATION_MS = 2_400;
export const LOW_BATTERY_FLICKER_MIN_INTERVAL_MS = 45_000;
export const LOW_BATTERY_FLICKER_MAX_INTERVAL_MS = 95_000;

const FLASHLIGHT_ORIGIN_X = -0.72;
const FLASHLIGHT_ORIGIN_Y = 0.5;

const clamp = (value: number, min: number, max: number): number => (
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : 0))
);

const normalizeMs = (value: number): number => (
  Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
);

const hashString = (value: string): number => {
  let hash = 2_166_136_261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16_777_619) >>> 0;
  }
  return hash >>> 0;
};

const normalizeSeed = (seed: NextLowBatteryFlickerOptions["seed"]): string => (
  seed === null || seed === undefined ? "" : String(seed)
);

export const getAgentFlashlightFrame = ({
  elapsedSeconds,
  pointer,
  reducedMotion = false,
}: AgentFlashlightFrameOptions): AgentFlashlightFrame => {
  const t = Number.isFinite(elapsedSeconds) ? Math.max(0, elapsedSeconds) : 0;
  const pointerActive = pointer.active && !reducedMotion;
  const idleTargetX = reducedMotion
    ? 0.18
    : Math.sin(t * 0.42) * 1.05 + Math.sin(t * 0.17 + 0.8) * 0.18;
  const idleTargetY = reducedMotion
    ? 0.04
    : -0.1 + Math.sin(t * 0.3 + 1.1) * 0.5;
  const targetX = pointerActive ? clamp(pointer.x, -1, 1) * 1.18 : idleTargetX;
  const targetY = pointerActive ? clamp(-pointer.y, -1, 1) * 0.82 : idleTargetY;
  const dx = targetX - FLASHLIGHT_ORIGIN_X;
  const dy = targetY - FLASHLIGHT_ORIGIN_Y;
  const distance = Math.max(0.9, Math.hypot(dx, dy));
  const focus = pointerActive ? 1 : 0.62 + Math.sin(t * 0.55 + 0.4) * 0.14;

  return {
    originX: FLASHLIGHT_ORIGIN_X,
    originY: FLASHLIGHT_ORIGIN_Y,
    targetX,
    targetY,
    angleRad: Math.atan2(-dx, dy),
    distance,
    intensity: reducedMotion ? 0.42 : clamp(0.68 + focus * 0.32, 0.45, 1.08),
    beamOpacity: reducedMotion ? 0.12 : clamp(0.14 + focus * 0.08, 0.12, 0.25),
    targetGlowScale: reducedMotion ? 0.75 : clamp(0.8 + focus * 0.32, 0.75, 1.16),
  };
};

export const getLowBatteryFlickerFrame = ({
  nowMs,
  eventStartMs,
  durationMs = LOW_BATTERY_FLICKER_DURATION_MS,
}: LowBatteryFlickerOptions): LowBatteryFlickerFrame => {
  if (eventStartMs === null) {
    return {
      active: false,
      intensityMultiplier: 1,
      beamOpacityMultiplier: 1,
      overlayOpacity: 0,
      jitterX: 0,
      jitterY: 0,
    };
  }

  const normalizedDurationMs = Math.max(1, normalizeMs(durationMs));
  const elapsedMs = normalizeMs(nowMs) - normalizeMs(eventStartMs);
  if (elapsedMs < 0 || elapsedMs >= normalizedDurationMs) {
    return {
      active: false,
      intensityMultiplier: 1,
      beamOpacityMultiplier: 1,
      overlayOpacity: 0,
      jitterX: 0,
      jitterY: 0,
    };
  }

  const phase = elapsedMs / normalizedDurationMs;
  const sputter = Math.abs(Math.sin(phase * Math.PI * 17));
  const brownout = phase > 0.2 && phase < 0.7 ? 0.38 : 0.72;
  const fadeIn = clamp(phase / 0.12, 0, 1);
  const fadeOut = clamp((1 - phase) / 0.18, 0, 1);

  return {
    active: true,
    intensityMultiplier: clamp(brownout + sputter * 0.48, 0.28, 1.16),
    beamOpacityMultiplier: clamp(0.45 + sputter * 0.7, 0.35, 1.12),
    overlayOpacity: Math.min(fadeIn, fadeOut),
    jitterX: Math.sin(elapsedMs * 0.036) * 0.045,
    jitterY: Math.sin(elapsedMs * 0.049 + 1.2) * 0.028,
  };
};

export const getNextLowBatteryFlickerAtMs = ({
  afterMs,
  seed,
}: NextLowBatteryFlickerOptions): number => {
  const normalizedAfterMs = normalizeMs(afterMs);
  const intervalRange = LOW_BATTERY_FLICKER_MAX_INTERVAL_MS - LOW_BATTERY_FLICKER_MIN_INTERVAL_MS;
  const bucket = Math.floor(normalizedAfterMs / LOW_BATTERY_FLICKER_MIN_INTERVAL_MS);
  const offsetMs = hashString(`${normalizeSeed(seed)}|${bucket}`) % (intervalRange + 1);
  return normalizedAfterMs + LOW_BATTERY_FLICKER_MIN_INTERVAL_MS + offsetMs;
};
