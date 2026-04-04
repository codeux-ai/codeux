const fs = require('fs');
const file = 'dashboard/src/v2/lib/live-task-runtime.ts';
let code = fs.readFileSync(file, 'utf8');

const newCode = `
export interface IndexedExecutionHistory {
  dispatchesByRecordId: Map<string, ExecutionTaskDispatchSummary[]>;
  dispatchesByTaskKey: Map<string, ExecutionTaskDispatchSummary[]>;
  eventsByTaskRunId: Map<string, ExecutionRuntimeEventSummary[]>;
  eventsByDispatchId: Map<string, ExecutionRuntimeEventSummary[]>;
  eventsByRecordId: Map<string, ExecutionRuntimeEventSummary[]>;
  eventsByTaskKey: Map<string, ExecutionRuntimeEventSummary[]>;
}

export function buildIndexedExecutionHistory(
  dispatches: ExecutionTaskDispatchSummary[],
  events: ExecutionRuntimeEventSummary[],
): IndexedExecutionHistory {
  const index: IndexedExecutionHistory = {
    dispatchesByRecordId: new Map(),
    dispatchesByTaskKey: new Map(),
    eventsByTaskRunId: new Map(),
    eventsByDispatchId: new Map(),
    eventsByRecordId: new Map(),
    eventsByTaskKey: new Map(),
  };

  for (const dispatch of dispatches) {
    if (dispatch.taskId) {
      const list = index.dispatchesByRecordId.get(dispatch.taskId) ?? [];
      list.push(dispatch);
      index.dispatchesByRecordId.set(dispatch.taskId, list);
    }
    if (dispatch.taskKey) {
      const list = index.dispatchesByTaskKey.get(dispatch.taskKey) ?? [];
      list.push(dispatch);
      index.dispatchesByTaskKey.set(dispatch.taskKey, list);
    }
  }

  for (const event of events) {
    if (event.taskRunId) {
      const list = index.eventsByTaskRunId.get(event.taskRunId) ?? [];
      list.push(event);
      index.eventsByTaskRunId.set(event.taskRunId, list);
    }
    if (event.dispatchId) {
      const list = index.eventsByDispatchId.get(event.dispatchId) ?? [];
      list.push(event);
      index.eventsByDispatchId.set(event.dispatchId, list);
    }
    if (event.taskId) {
      const list = index.eventsByRecordId.get(event.taskId) ?? [];
      list.push(event);
      index.eventsByRecordId.set(event.taskId, list);
    }
    if (event.taskKey) {
      const list = index.eventsByTaskKey.get(event.taskKey) ?? [];
      list.push(event);
      index.eventsByTaskKey.set(event.taskKey, list);
    }
  }

  return index;
}

export function pickLatestTaskDispatch(
  task: Subtask,
  dispatches: ExecutionTaskDispatchSummary[],
  index?: IndexedExecutionHistory,
): ExecutionTaskDispatchSummary | null {
  const recordId = normalizeString(task.record_id);
  const rawDispatches = recordId && index?.dispatchesByRecordId.has(recordId)
    ? index.dispatchesByRecordId.get(recordId)!
    : index?.dispatchesByTaskKey.has(task.id)
      ? index.dispatchesByTaskKey.get(task.id)!
      : dispatches;

  const scopedDispatches = rawDispatches.filter((dispatch) => taskScopeMatchesDispatch(task, dispatch));
  const latestByRecency = (items: ExecutionTaskDispatchSummary[]): ExecutionTaskDispatchSummary | null => (
    items.length === 0
      ? null
      : [...items].sort((left, right) => compareIsoAsc(getDispatchRecency(left), getDispatchRecency(right))).at(-1) ?? null
  );

  if (recordId) {
    const exactMatches = scopedDispatches.filter((dispatch) => dispatch.taskId === recordId);
    if (exactMatches.length > 0) {
      return latestByRecency(exactMatches);
    }
    return null;
  }

  return latestByRecency(scopedDispatches.filter((dispatch) => dispatch.taskKey === task.id));
}

export function getTaskEventsForLiveTask(
  task: Subtask,
  dispatch: ExecutionTaskDispatchSummary | null,
  events: ExecutionRuntimeEventSummary[],
  index?: IndexedExecutionHistory,
): ExecutionRuntimeEventSummary[] {
  const recordId = normalizeString(task.record_id);

  const rawEvents = dispatch?.taskRunId && index?.eventsByTaskRunId.has(dispatch.taskRunId)
    ? index.eventsByTaskRunId.get(dispatch.taskRunId)!
    : dispatch?.id && index?.eventsByDispatchId.has(dispatch.id)
      ? index.eventsByDispatchId.get(dispatch.id)!
      : recordId && index?.eventsByRecordId.has(recordId)
        ? index.eventsByRecordId.get(recordId)!
        : index?.eventsByTaskKey.has(task.id)
          ? index.eventsByTaskKey.get(task.id)!
          : events;

  const scopedEvents = rawEvents.filter((event) => taskScopeMatchesEvent(task, event));
  const sortEvents = (items: ExecutionRuntimeEventSummary[]): ExecutionRuntimeEventSummary[] => {
    const deduped = new Map<string, ExecutionRuntimeEventSummary>();
    for (const event of items) {
      deduped.set(event.id, event);
    }
    return [...deduped.values()].sort((left, right) => compareIsoAsc(left.createdAt, right.createdAt));
  };

  if (dispatch?.taskRunId) {
    const taskRunMatches = scopedEvents.filter((event) => event.taskRunId === dispatch.taskRunId);
    if (taskRunMatches.length > 0) {
      return sortEvents(taskRunMatches);
    }
  }

  if (dispatch?.id) {
    const dispatchMatches = scopedEvents.filter((event) => event.dispatchId === dispatch.id);
    if (dispatchMatches.length > 0) {
      return sortEvents(dispatchMatches);
    }
  }

  if (recordId) {
    return sortEvents(scopedEvents.filter((event) => event.taskId === recordId));
  }

  return sortEvents(scopedEvents.filter((event) => event.taskKey === task.id));
}
`;

let result = code.replace(/export function pickLatestTaskDispatch\([\s\S]*?return sortEvents\(scopedEvents\.filter\(\(event\) => event\.taskKey === task\.id\)\);\n}/, newCode.trim());

fs.writeFileSync(file, result);
console.log("Done");
