import { describe, expect, it } from "vitest";
import {
  getAgentFlashlightFrame,
  getLowBatteryFlickerFrame,
  getNextLowBatteryFlickerAtMs,
  LOW_BATTERY_FLICKER_DURATION_MS,
  LOW_BATTERY_FLICKER_MAX_INTERVAL_MS,
  LOW_BATTERY_FLICKER_MIN_INTERVAL_MS,
} from "../../../dashboard/src/v2/lib/agent-flashlight.js";

describe("agent flashlight", () => {
  it("aims toward pointer parallax when the pointer is active", () => {
    const frame = getAgentFlashlightFrame({
      elapsedSeconds: 12,
      pointer: { x: 0.5, y: -0.25, active: true },
    });

    expect(frame.originX).toBeCloseTo(-0.72);
    expect(frame.originY).toBeCloseTo(0.5);
    expect(frame.targetX).toBeCloseTo(0.59);
    expect(frame.targetY).toBeCloseTo(0.205);
    expect(frame.distance).toBeGreaterThan(1.2);
    expect(frame.intensity).toBeGreaterThan(0.95);
    expect(frame.beamOpacity).toBeGreaterThan(0.2);
  });

  it("keeps reduced-motion frames stable and low intensity", () => {
    const early = getAgentFlashlightFrame({
      elapsedSeconds: 4,
      pointer: { x: 1, y: 1, active: true },
      reducedMotion: true,
    });
    const late = getAgentFlashlightFrame({
      elapsedSeconds: 400,
      pointer: { x: -1, y: -1, active: true },
      reducedMotion: true,
    });

    expect(late.targetX).toBe(early.targetX);
    expect(late.targetY).toBe(early.targetY);
    expect(late.intensity).toBeLessThan(0.5);
    expect(late.beamOpacity).toBeLessThan(0.15);
  });

  it("bounds low-battery flicker frames to the configured event duration", () => {
    const startMs = 10_000;
    const active = getLowBatteryFlickerFrame({
      nowMs: startMs + LOW_BATTERY_FLICKER_DURATION_MS / 2,
      eventStartMs: startMs,
    });
    const expired = getLowBatteryFlickerFrame({
      nowMs: startMs + LOW_BATTERY_FLICKER_DURATION_MS,
      eventStartMs: startMs,
    });

    expect(active.active).toBe(true);
    expect(active.intensityMultiplier).toBeGreaterThanOrEqual(0.28);
    expect(active.intensityMultiplier).toBeLessThanOrEqual(1.16);
    expect(active.beamOpacityMultiplier).toBeGreaterThanOrEqual(0.35);
    expect(active.beamOpacityMultiplier).toBeLessThanOrEqual(1.12);
    expect(active.overlayOpacity).toBeGreaterThan(0);
    expect(expired).toMatchObject({
      active: false,
      intensityMultiplier: 1,
      beamOpacityMultiplier: 1,
      overlayOpacity: 0,
    });
  });

  it("schedules rare low-battery flickers inside deterministic interval bounds", () => {
    const afterMs = 123_456;
    const first = getNextLowBatteryFlickerAtMs({ afterMs, seed: "agent-a" });
    const second = getNextLowBatteryFlickerAtMs({ afterMs, seed: "agent-a" });
    const delta = first - afterMs;

    expect(second).toBe(first);
    expect(delta).toBeGreaterThanOrEqual(LOW_BATTERY_FLICKER_MIN_INTERVAL_MS);
    expect(delta).toBeLessThanOrEqual(LOW_BATTERY_FLICKER_MAX_INTERVAL_MS);
  });
});
