/**
 * Backwards-compatible facade over the unified task pipeline stage machine.
 *
 * All merge/completion decisions now live in {@link ./task-pipeline-stage.ts}
 * (the single source of truth). This module keeps the historical helper names
 * and import path stable for existing call sites.
 */
export type { PreCiGateTransition } from "./task-pipeline-stage.js";
export {
  isTaskCodeComplete,
  taskHasMergeEvidence,
  normalizeTaskMergeIndicator,
  isCompletedTaskSettled,
  isCompletedTaskAwaitingMerge,
  evaluatePreCiGateTransition,
} from "./task-pipeline-stage.js";
