import { describe, expect, it } from "vitest";
import {
  evaluateNodeHeapPressure,
  NODE_HEAP_MIN_TELEMETRY_HEADROOM_BYTES,
  NODE_HEAP_TELEMETRY_PAUSE_RATIO,
} from "../../../src/shared/runtime/node-heap-pressure.js";

describe("node heap pressure", () => {
  it("allows telemetry while usage and headroom are healthy", () => {
    const limit = 4 * 1024 * 1024 * 1024;
    const result = evaluateNodeHeapPressure(512 * 1024 * 1024, limit);

    expect(result.underPressure).toBe(false);
    expect(result.usageRatio).toBeLessThan(NODE_HEAP_TELEMETRY_PAUSE_RATIO);
  });

  it("stops telemetry at the usage ratio or minimum headroom boundary", () => {
    const limit = 4 * 1024 * 1024 * 1024;

    expect(evaluateNodeHeapPressure(
      limit * NODE_HEAP_TELEMETRY_PAUSE_RATIO,
      limit,
    ).underPressure).toBe(true);
    expect(evaluateNodeHeapPressure(
      limit - NODE_HEAP_MIN_TELEMETRY_HEADROOM_BYTES,
      limit,
    ).underPressure).toBe(true);
  });
});
