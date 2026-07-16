import type {
  ExecutionAttentionItemSummary,
  ExecutionRuntimeEventSummary,
  ExecutionTaskDispatchSummary,
  Subtask,
} from "../../types.js";
import {
  deriveTaskCiStatusPresentation,
  type CiStatusPresentation,
} from "./ci-status-presentation.js";
import type { DashboardLocale } from "../i18n/index.js";
import { findActiveTaskHumanIntervention } from "./workflow-status-presentation.js";

export interface SprintDagTaskWorkflowEvidence {
  ciPresentation: CiStatusPresentation | null;
  humanIntervention: ExecutionAttentionItemSummary | null;
}

interface IndexedTaskEvidence {
  events: ExecutionRuntimeEventSummary[];
  attentionItems: ExecutionAttentionItemSummary[];
}

function stringValues(values: readonly unknown[]): string[] {
  const normalized = new Set<string>();
  for (const value of values) {
    if (typeof value === "string" && value.trim()) normalized.add(value.trim());
  }
  return [...normalized];
}

function addEvidence<T>(
  target: Map<string, T[]>,
  canonicalTaskIds: ReadonlySet<string>,
  evidence: T,
): void {
  for (const taskId of canonicalTaskIds) {
    const bucket = target.get(taskId);
    if (bucket) {
      bucket.push(evidence);
    } else {
      target.set(taskId, [evidence]);
    }
  }
}

/**
 * Builds all task workflow evidence in linear passes over the DAG inputs.
 * Each runtime record is indexed to its task once instead of scanning the
 * complete event and attention feeds separately for every node.
 */
export function buildSprintDagWorkflowEvidenceByTaskId(args: {
  tasks: readonly Subtask[];
  dispatches: readonly ExecutionTaskDispatchSummary[];
  events: readonly ExecutionRuntimeEventSummary[];
  attentionItems: readonly ExecutionAttentionItemSummary[];
  locale: DashboardLocale;
}): Map<string, SprintDagTaskWorkflowEvidence> {
  const canonicalTaskByAlias = new Map<string, string>();
  const taskByCanonicalId = new Map<string, Subtask>();
  for (const task of args.tasks) {
    const canonicalId = task.record_id || task.id;
    taskByCanonicalId.set(canonicalId, task);
    canonicalTaskByAlias.set(task.id, canonicalId);
    if (task.record_id) canonicalTaskByAlias.set(task.record_id, canonicalId);
  }

  const dispatchByCanonicalTaskId = new Map<string, ExecutionTaskDispatchSummary>();
  const canonicalTaskByDispatchId = new Map<string, string>();
  for (const dispatch of args.dispatches) {
    const canonicalId = canonicalTaskByAlias.get(dispatch.taskId)
      ?? canonicalTaskByAlias.get(dispatch.taskKey);
    if (!canonicalId) continue;
    if (!dispatchByCanonicalTaskId.has(canonicalId)) {
      dispatchByCanonicalTaskId.set(canonicalId, dispatch);
    }
    canonicalTaskByDispatchId.set(dispatch.id, canonicalId);
  }

  const eventsByCanonicalTaskId = new Map<string, ExecutionRuntimeEventSummary[]>();
  for (const event of args.events) {
    const canonicalTaskIds = new Set<string>();
    for (const alias of stringValues([
      event.taskId,
      event.taskKey,
      event.payload?.taskId,
    ])) {
      const canonicalId = canonicalTaskByAlias.get(alias);
      if (canonicalId) canonicalTaskIds.add(canonicalId);
    }
    const dispatchTaskId = event.dispatchId
      ? canonicalTaskByDispatchId.get(event.dispatchId)
      : null;
    if (dispatchTaskId) canonicalTaskIds.add(dispatchTaskId);
    addEvidence(eventsByCanonicalTaskId, canonicalTaskIds, event);
  }

  const attentionByCanonicalTaskId = new Map<string, ExecutionAttentionItemSummary[]>();
  for (const item of args.attentionItems) {
    const canonicalTaskIds = new Set<string>();
    for (const alias of stringValues([
      item.taskId,
      item.payload?.taskId,
      item.payload?.taskKey,
    ])) {
      const canonicalId = canonicalTaskByAlias.get(alias);
      if (canonicalId) canonicalTaskIds.add(canonicalId);
    }
    const dispatchTaskId = item.dispatchId
      ? canonicalTaskByDispatchId.get(item.dispatchId)
      : null;
    if (dispatchTaskId) canonicalTaskIds.add(dispatchTaskId);
    addEvidence(attentionByCanonicalTaskId, canonicalTaskIds, item);
  }

  const result = new Map<string, SprintDagTaskWorkflowEvidence>();
  for (const [canonicalId, task] of taskByCanonicalId) {
    const dispatch = dispatchByCanonicalTaskId.get(canonicalId);
    const indexed: IndexedTaskEvidence = {
      events: eventsByCanonicalTaskId.get(canonicalId) ?? [],
      attentionItems: attentionByCanonicalTaskId.get(canonicalId) ?? [],
    };
    const evidence = {
      ciPresentation: deriveTaskCiStatusPresentation({
        task,
        events: indexed.events,
        attentionItems: indexed.attentionItems,
        sprintRunId: dispatch?.sprintRunId ?? null,
      }, args.locale),
      humanIntervention: findActiveTaskHumanIntervention(indexed.attentionItems, {
        recordId: task.record_id,
        taskKey: task.id,
        sprintId: task.sprint_id,
        dispatchId: dispatch?.id,
      }),
    };
    result.set(task.id, evidence);
    if (task.record_id) result.set(task.record_id, evidence);
  }
  return result;
}
