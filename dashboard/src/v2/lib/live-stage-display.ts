import type { LiveTaskStageKey } from "./live-stats.js";
import { STATS_DECK_VISIBLE_STAGES } from "./live-stats.js";

export { STATS_DECK_VISIBLE_STAGES };

/**
 * Full human-readable labels for each live task stage key.
 * Used in the Stage Ledger and per-task stage pills.
 * Note: 'queued' is tracked internally but excluded from the Stats deck Stage Ledger.
 */
export const STAGE_LABELS: Record<LiveTaskStageKey, string> = {
  queued: "Queued",
  coding: "Coding",
  ci: "CI / Review",
  autofix: "Autofix",
  merge: "Merge",
};

/**
 * Compact labels for tight UI contexts such as task card pills.
 */
export const STAGE_SHORT_LABELS: Record<LiveTaskStageKey, string> = {
  queued: "Queue",
  coding: "Code",
  ci: "CI",
  autofix: "Fix",
  merge: "Merge",
};

export function getLiveStageLabel(stage: LiveTaskStageKey): string {
  return STAGE_LABELS[stage];
}

export function getLiveStageShortLabel(stage: LiveTaskStageKey): string {
  return STAGE_SHORT_LABELS[stage];
}
