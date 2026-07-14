import type { LiveTaskStageKey } from "./live-stats.js";
import { STATS_DECK_VISIBLE_STAGES } from "./live-stats.js";
import type { DashboardLocale } from "../i18n/locales.js";
import { translateChatMessage } from "../i18n/messages/chat.js";

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
  qa: "QA Gate",
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
  qa: "QA",
  autofix: "Fix",
  merge: "Merge",
};

const STAGE_MESSAGE_KEYS = {
  queued: "stageQueued",
  coding: "stageCoding",
  ci: "stageCi",
  qa: "stageQa",
  autofix: "stageAutofix",
  merge: "stageMerge",
} as const;

const STAGE_SHORT_MESSAGE_KEYS = {
  queued: "stageQueueShort",
  coding: "stageCodeShort",
  ci: "stageCiShort",
  qa: "stageQaShort",
  autofix: "stageFixShort",
  merge: "stageMergeShort",
} as const;

export function getLiveStageLabel(stage: LiveTaskStageKey, locale: DashboardLocale = "en"): string {
  return translateChatMessage(locale, STAGE_MESSAGE_KEYS[stage]);
}

export function getLiveStageShortLabel(stage: LiveTaskStageKey, locale: DashboardLocale = "en"): string {
  return translateChatMessage(locale, STAGE_SHORT_MESSAGE_KEYS[stage]);
}
