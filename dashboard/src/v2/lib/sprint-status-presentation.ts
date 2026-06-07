import type {
  SprintStatusPresentation,
  SprintStatusPresentationInput,
  SprintPauseSource,
} from "../types/sprint.js";

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

export function getSprintStatusPresentation(input: SprintStatusPresentationInput): SprintStatusPresentation {
  const rawState = (input.state || "").toString().trim().toLowerCase();
  const state = rawState || "unknown";
  const pauseSource = resolvePauseSource(input);

  // 1. Merge Conflict Check (Base branch merge conflict)
  if (
    input.attentionType === "merge_conflict" ||
    input.pauseReason === "main_merge_blocked" ||
    (state === "paused" && input.attentionType === "merge_conflict")
  ) {
    return {
      statusLabel: "Merge Conflict",
      title: coalesceText(input.humanInterventionTitle, "Merge Conflict exists in base branch") || "Merge Conflict exists in base branch",
      reason: coalesceText(input.humanInterventionReason, "A merge conflict exists into the base branch.") || "A merge conflict exists into the base branch.",
      detail: coalesceText(input.humanInterventionInstructions, "Resolve the merge conflicts in the base branch to complete the sprint.") || "Resolve the merge conflicts in the base branch to complete the sprint.",
      showHumanInterventionBadge: true,
      pauseSource,
      isManualPause: false,
      isSystemStop: true,
    };
  }

  // 2. QA Gate Check
  if (input.latestReviewStatus === "running") {
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
  const isAttemptingMerge = (state === "running" && input.completion === 100) || input.attentionType === "merge_required";
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
