import type { LiveTaskTimingSummary } from "./live-stats.js";

export type LiveDurationMode = "hidden" | "frozen" | "live";

export interface LiveDurationDispatchTiming {
  startedAt: string | null;
  finishedAt: string | null;
  status: string | null;
}

export interface LiveDurationDisplay {
  visible: boolean;
  mode: LiveDurationMode;
  elapsedSeconds: number;
}

interface DeriveLiveDurationDisplayArgs {
  taskTiming?: Pick<LiveTaskTimingSummary, "activeStage" | "startedAt" | "totalSeconds"> | null;
  dispatchTiming?: LiveDurationDispatchTiming | null;
  now?: string | number | Date;
}

const HIDDEN_DURATION_DISPLAY: LiveDurationDisplay = {
  visible: false,
  mode: "hidden",
  elapsedSeconds: 0,
};

const LIVE_STATUSES = new Set(["running", "queued", "claimed", "in_progress", "pending"]);

function toMillis(value: string | number | Date | null | undefined): number | null {
  if (value == null) {
    return null;
  }
  if (value instanceof Date) {
    const millis = value.getTime();
    return Number.isFinite(millis) ? millis : null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? millis : null;
}

function secondsBetween(startedAt: string, endedAt: string | number | Date): number {
  const startMs = toMillis(startedAt);
  const endMs = toMillis(endedAt);
  if (startMs == null || endMs == null) {
    return 0;
  }
  return Math.max(0, Math.floor((endMs - startMs) / 1000));
}

function createDisplay(mode: LiveDurationMode, elapsedSeconds: number): LiveDurationDisplay {
  const normalizedElapsed = Math.max(0, Math.floor(elapsedSeconds));
  return {
    visible: normalizedElapsed > 0,
    mode: normalizedElapsed > 0 ? mode : (mode === "live" ? "live" : "hidden"),
    elapsedSeconds: normalizedElapsed,
  };
}

function deriveFromTaskTiming(
  taskTiming: DeriveLiveDurationDisplayArgs["taskTiming"],
  now: string | number | Date,
): LiveDurationDisplay {
  if (!taskTiming?.startedAt) {
    return HIDDEN_DURATION_DISPLAY;
  }

  if (taskTiming.activeStage) {
    return createDisplay("live", secondsBetween(taskTiming.startedAt, now));
  }

  return createDisplay("frozen", taskTiming.totalSeconds);
}

function deriveFromDispatchTiming(
  dispatchTiming: LiveDurationDispatchTiming | null | undefined,
  now: string | number | Date,
): LiveDurationDisplay {
  if (!dispatchTiming?.startedAt) {
    return HIDDEN_DURATION_DISPLAY;
  }

  if (dispatchTiming.finishedAt) {
    return createDisplay("frozen", secondsBetween(dispatchTiming.startedAt, dispatchTiming.finishedAt));
  }

  const normalizedStatus = String(dispatchTiming.status || "").trim().toLowerCase();
  if (!LIVE_STATUSES.has(normalizedStatus)) {
    return HIDDEN_DURATION_DISPLAY;
  }

  return createDisplay("live", secondsBetween(dispatchTiming.startedAt, now));
}

export function deriveLiveDurationDisplay(args: DeriveLiveDurationDisplayArgs): LiveDurationDisplay {
  const now = args.now ?? Date.now();
  const taskTimingDisplay = deriveFromTaskTiming(args.taskTiming, now);

  if (taskTimingDisplay.mode !== "hidden") {
    return taskTimingDisplay;
  }

  return deriveFromDispatchTiming(args.dispatchTiming, now);
}
