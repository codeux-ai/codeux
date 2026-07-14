import type { OverviewTelemetryProjectSummary, OverviewTelemetrySnapshot, ExecutionRuntimeEventSummary } from "../../types.js";

export interface EventStyle {
  label: string;
  toneClass: string;
}

export interface OverviewEventLabels {
  taskState: (state: string) => string;
  sprintState: (state: string) => string;
  sprintPaused: string;
  states: Readonly<Record<string, string>>;
}

const DEFAULT_EVENT_LABELS: OverviewEventLabels = {
  taskState: (state) => `task ${state}`,
  sprintState: (state) => `sprint ${state}`,
  sprintPaused: "sprint paused",
  states: {},
};

export function buildProjectLookup(telemetry: OverviewTelemetrySnapshot): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const project of telemetry?.activeProjects || []) {
    lookup.set(project.projectId, project.projectName);
  }
  for (const project of telemetry?.attentionProjects || []) {
    lookup.set(project.projectId, project.projectName);
  }
  return lookup;
}

export function getEventStyle(
  event: ExecutionRuntimeEventSummary,
  labels: OverviewEventLabels = DEFAULT_EVENT_LABELS,
): EventStyle {
  const type = event.eventType;
  const status = event.sprintRunStatus;
  const state = event.taskRunState;

  // Use state/status to enrich the label if applicable, else fallback to event type
  let baseLabel = type.replace(/_/g, " ");
  if (type === "run_running" && state) {
    baseLabel = labels.taskState(labels.states[state] ?? state);
  } else if (type === "sprint_paused") {
    baseLabel = labels.sprintPaused;
  } else if (type.includes("sprint_") && status) {
    baseLabel = labels.sprintState(labels.states[status] ?? status);
  } else {
    baseLabel = baseLabel
      .split(" ")
      .map((term) => labels.states[term] ?? term)
      .join(" ");
  }

  if (type.includes("failed") || type.includes("error")) {
    return { label: baseLabel, toneClass: "text-status-red" };
  }
  if (type.includes("completed") || type.includes("success") || type === "cli_git_pushed" || type === "cli_pr_finalized") {
    return { label: baseLabel, toneClass: "text-status-green" };
  }
  if (type.includes("blocked") || type.includes("paused") || type === "cli_git_no_changes") {
    return { label: baseLabel, toneClass: "text-status-amber" };
  }
  if (type.includes("started") || type.includes("running") || type === "worker_claimed") {
    return { label: baseLabel, toneClass: "text-status-blue" };
  }

  return { label: baseLabel, toneClass: "text-slate-500" };
}

export function getInterventionContent(
  project: OverviewTelemetryProjectSummary,
  fallbackTitle = "Human intervention required",
): { title: string } | null {
  if (!project.humanIntervention) {
    return null;
  }
  return {
    title: project.humanIntervention.title || fallbackTitle,
  };
}
