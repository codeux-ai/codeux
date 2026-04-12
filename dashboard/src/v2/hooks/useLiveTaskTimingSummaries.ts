import { useSignal, useComputed, batch } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import type { Subtask, ExecutionTaskDispatchSummary, ExecutionRuntimeEventSummary, ExecutionSprintRunSummary } from "../../types.js";
import { buildLiveSprintTimingSummary, buildLiveTaskTimingSummaries, type LiveSprintTimingSummary, type LiveTaskTimingSummary } from "../lib/live-stats.js";

function buildTaskTimingMap(timings: LiveTaskTimingSummary[]): Map<string, LiveTaskTimingSummary> {
  const map = new Map<string, LiveTaskTimingSummary>();
  for (const timing of timings) {
    map.set(timing.taskId, timing);
    map.set(timing.taskKey, timing);
  }
  return map;
}

export function useLiveTaskTimingSummaries(args: {
  tasks: Subtask[];
  dispatches: ExecutionTaskDispatchSummary[];
  events: ExecutionRuntimeEventSummary[];
  sprintRuns: ExecutionSprintRunSummary[];
  nowIso: string;
}) {
  const taskTimingsSignal = useSignal<LiveTaskTimingSummary[]>([]);
  const sprintTimingSignal = useSignal<LiveSprintTimingSummary | null>(null);
  const taskTimingMapSignal = useSignal<Map<string, LiveTaskTimingSummary>>(new Map());

  const argsRef = useRef(args);
  argsRef.current = args;

  useEffect(() => {
    const { tasks, dispatches, events, sprintRuns, nowIso } = argsRef.current;
    const taskTimings = buildLiveTaskTimingSummaries({
      tasks,
      dispatches,
      events,
      sprintRuns,
      nowIso,
    });
    const sprintTiming = buildLiveSprintTimingSummary({
      tasks,
      dispatches,
      events,
      sprintRuns,
      nowIso,
    });
    const taskTimingMap = buildTaskTimingMap(taskTimings);

    batch(() => {
      taskTimingsSignal.value = taskTimings;
      sprintTimingSignal.value = sprintTiming;
      taskTimingMapSignal.value = taskTimingMap;
    });
  }, [args.tasks, args.dispatches, args.events, args.sprintRuns, args.nowIso]);

  return {
    get sprintTiming() { return sprintTimingSignal.value; },
    get taskTimings() { return taskTimingsSignal.value; },
    get taskTimingMap() { return taskTimingMapSignal.value; },
  };
}
