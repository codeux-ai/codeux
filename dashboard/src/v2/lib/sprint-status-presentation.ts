import type {
  SprintStatusPresentation,
  SprintStatusPresentationInput,
  SprintPauseSource,
} from "../types/sprint.js";
import type { DashboardLocale } from "../i18n/locales.js";
import { translateDashboardMessage } from "../i18n/locales.js";
import { shellMessages } from "../i18n/messages/shell.js";

const SPRINT_MESSAGE_KEYS = {
  "Merge Conflict": "sprintMergeConflictLabel", "Merge Conflict exists in base branch": "sprintMergeConflictTitle",
  "A merge conflict exists into the base branch.": "sprintMergeConflictReason", "Resolve the merge conflicts in the base branch to complete the sprint.": "sprintMergeConflictDetail",
  QA: "sprintQaLabel", "Sprint in QA Gate": "sprintQaTitle", "The sprint is undergoing automated and/or manual QA checks.": "sprintQaReason", "Awaiting QA approval before merge into the base branch.": "sprintQaDetail",
  Merge: "sprintMergeLabel", "Attempting Base Branch Merge": "sprintMergeTitle", "Sprint has completed all execution tasks and is merging into the base branch.": "sprintMergeReason", "Final verification and integration into the base branch are in progress.": "sprintMergeDetail",
  Unknown: "sprintUnknownLabel", Draft: "sprintDraftLabel", Paused: "sprintPausedLabel", "Sprint Paused For Manual Attention": "sprintManualPauseTitle", "A team member paused this sprint.": "sprintManualPauseReason", "Review the blocker and resume the sprint when ready.": "sprintManualPauseDetail",
  Stopped: "sprintStoppedLabel", "Sprint Stopped By System": "sprintSystemStopTitle", "The orchestrator stopped this sprint.": "sprintSystemStopReason", "Resolve the stop condition and restart when ready.": "sprintSystemStopDetail",
  Running: "sprintRunningLabel", "Sprint Running": "sprintRunningTitle", "Sprint execution is active.": "sprintRunningReason", "Live telemetry is updating as tasks run.": "sprintRunningDetail", "Sprint Status Unknown": "sprintUnknownTitle", "Sprint status is available.": "sprintStatusAvailable", "No additional status details are available yet.": "sprintNoStatusDetails",
} as const;

function localizePresentation(input: SprintStatusPresentationInput, presentation: SprintStatusPresentation, locale: DashboardLocale): SprintStatusPresentation {
  const serverCopy = new Set([input.humanInterventionTitle, input.humanInterventionReason, input.humanInterventionInstructions, input.stopReasonTitle, input.stopReason, input.stopReasonDetail, input.pauseReason].filter((value): value is string => typeof value === "string" && value.trim().length > 0));
  const localize = (value: string): string => {
    if (serverCopy.has(value)) return value;
    const key = SPRINT_MESSAGE_KEYS[value as keyof typeof SPRINT_MESSAGE_KEYS];
    if (key) return translateDashboardMessage(shellMessages, locale, key);
    if (value.startsWith("Sprint ")) return translateDashboardMessage(shellMessages, locale, "sprintStatusTitle", { status: localize(value.slice(7)) });
    return value;
  };
  return { ...presentation, statusLabel: localize(presentation.statusLabel), title: localize(presentation.title), reason: localize(presentation.reason), detail: localize(presentation.detail) };
}

function toReadableStatus(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function coalesceText(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function resolvePauseSource(input: SprintStatusPresentationInput): SprintPauseSource {
  const source = (input.pauseSource || "").toLowerCase();
  if (source === "manual" || source === "human") {
    return "manual";
  }
  if (source === "system" || source === "orchestrator") {
    return "system";
  }
  if (source === "worker") {
    return "worker";
  }

  const ownerType = (input.humanInterventionOwnerType || "").toLowerCase();
  if (ownerType === "human" || ownerType === "user") {
    return "manual";
  }
  if (ownerType === "worker") {
    return "worker";
  }

  if (input.stopReason || input.stopReasonTitle || input.stopReasonDetail) {
    return "system";
  }
  return "unknown";
}

function buildSprintStatusPresentation(input: SprintStatusPresentationInput): SprintStatusPresentation {
  const rawState = (input.state || "").toString().trim().toLowerCase();
  const state = rawState || "unknown";
  const pauseSource = resolvePauseSource(input);
  const isActiveLifecycle = state === "running" || state === "queued" || state === "paused";
  const isExecuting = state === "running" || state === "queued";
  const reviewStatus = (input.latestReviewStatus || "").trim().toLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
  const isReviewActive = reviewStatus === "running" || reviewStatus === "pending" || reviewStatus === "in_progress";

  // 1. Merge Conflict Check (Base branch merge conflict)
  if (
    isActiveLifecycle
    && (input.attentionType === "merge_conflict" || input.pauseReason === "main_merge_blocked")
  ) {
    return {
      statusLabel: "Merge Conflict",
      title: coalesceText(input.humanInterventionTitle, "Merge Conflict exists in base branch") || "Merge Conflict exists in base branch",
      reason: coalesceText(input.humanInterventionReason, "A merge conflict exists into the base branch.") || "A merge conflict exists into the base branch.",
      detail: coalesceText(input.humanInterventionInstructions, "Resolve the merge conflicts in the base branch to complete the sprint.") || "Resolve the merge conflicts in the base branch to complete the sprint.",
      showHumanInterventionBadge: input.humanInterventionOwnerType?.toLowerCase() === "human",
      pauseSource,
      isManualPause: false,
      isSystemStop: true,
    };
  }

  // 2. QA Gate Check
  if (isExecuting && input.completion === 100 && isReviewActive) {
    return {
      statusLabel: "QA",
      title: "Sprint in QA Gate",
      reason: "The sprint is undergoing automated and/or manual QA checks.",
      detail: "Awaiting QA approval before merge into the base branch.",
      showHumanInterventionBadge: false,
      pauseSource,
      isManualPause: false,
      isSystemStop: false,
    };
  }

  // 3. Base Branch Merge (Attempting Merge) Check
  const isAttemptingMerge = isActiveLifecycle && input.attentionType === "merge_required";
  if (isAttemptingMerge) {
    return {
      statusLabel: "Merge",
      title: "Attempting Base Branch Merge",
      reason: "Sprint has completed all execution tasks and is merging into the base branch.",
      detail: "Final verification and integration into the base branch are in progress.",
      showHumanInterventionBadge: false,
      pauseSource,
      isManualPause: false,
      isSystemStop: false,
    };
  }

  const isManualPause = state === "paused" && pauseSource === "manual";
  const isSystemStop = state === "paused" && (pauseSource === "system" || pauseSource === "worker");

  const fallbackLabel = state === "unknown" ? "Unknown" : state === "idle" ? "Draft" : toReadableStatus(state);

  if (isManualPause) {
    return {
      statusLabel: "Paused",
      title: coalesceText(input.humanInterventionTitle, "Sprint Paused For Manual Attention") || "Sprint Paused For Manual Attention",
      reason: coalesceText(input.humanInterventionReason, input.pauseReason, "A team member paused this sprint.") || "A team member paused this sprint.",
      detail: coalesceText(input.humanInterventionInstructions, "Review the blocker and resume the sprint when ready.") || "Review the blocker and resume the sprint when ready.",
      showHumanInterventionBadge: true,
      pauseSource,
      isManualPause: true,
      isSystemStop: false,
    };
  }

  if (isSystemStop) {
    return {
      statusLabel: "Stopped",
      title: coalesceText(input.stopReasonTitle, "Sprint Stopped By System") || "Sprint Stopped By System",
      reason: coalesceText(input.stopReason, input.pauseReason, "The orchestrator stopped this sprint.") || "The orchestrator stopped this sprint.",
      detail: coalesceText(input.stopReasonDetail, "Resolve the stop condition and restart when ready.") || "Resolve the stop condition and restart when ready.",
      showHumanInterventionBadge: false,
      pauseSource,
      isManualPause: false,
      isSystemStop: true,
    };
  }

  if (state === "running" || state === "queued") {
    return {
      statusLabel: "Running",
      title: "Sprint Running",
      reason: "Sprint execution is active.",
      detail: "Live telemetry is updating as tasks run.",
      showHumanInterventionBadge: false,
      pauseSource,
      isManualPause: false,
      isSystemStop: false,
    };
  }

  return {
    statusLabel: fallbackLabel,
    title: fallbackLabel === "Unknown" ? "Sprint Status Unknown" : `Sprint ${fallbackLabel}`,
    reason: "Sprint status is available.",
    detail: "No additional status details are available yet.",
    showHumanInterventionBadge: false,
    pauseSource,
    isManualPause: false,
    isSystemStop: false,
  };
}

export function getSprintStatusPresentation(input: SprintStatusPresentationInput, locale: DashboardLocale = "en"): SprintStatusPresentation {
  return localizePresentation(input, buildSprintStatusPresentation(input), locale);
}
