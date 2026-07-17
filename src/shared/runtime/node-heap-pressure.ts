import { getHeapStatistics } from "node:v8";

export const NODE_HEAP_TELEMETRY_PAUSE_RATIO = 0.5;
export const NODE_HEAP_MIN_TELEMETRY_HEADROOM_BYTES = 1024 * 1024 * 1024;

export interface NodeHeapPressureState {
  heapUsedBytes: number;
  heapLimitBytes: number;
  headroomBytes: number;
  usageRatio: number;
  underPressure: boolean;
}

export function evaluateNodeHeapPressure(
  heapUsedBytes: number,
  heapLimitBytes: number,
): NodeHeapPressureState {
  const safeUsed = Math.max(0, heapUsedBytes);
  const safeLimit = Math.max(1, heapLimitBytes);
  const headroomBytes = Math.max(0, safeLimit - safeUsed);
  const usageRatio = safeUsed / safeLimit;
  const requiredHeadroomBytes = Math.min(
    NODE_HEAP_MIN_TELEMETRY_HEADROOM_BYTES,
    safeLimit * 0.25,
  );
  return {
    heapUsedBytes: safeUsed,
    heapLimitBytes: safeLimit,
    headroomBytes,
    usageRatio,
    underPressure: usageRatio >= NODE_HEAP_TELEMETRY_PAUSE_RATIO
      || headroomBytes <= requiredHeadroomBytes,
  };
}

export function getNodeHeapPressure(): NodeHeapPressureState {
  return evaluateNodeHeapPressure(
    process.memoryUsage().heapUsed,
    getHeapStatistics().heap_size_limit,
  );
}
