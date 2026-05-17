import type {
  ExecutionDashboardSnapshot,
  ExecutionHumanInterventionSummary,
  ExecutionSprintRunSummary,
  OverviewTelemetryProjectSummary,
} from "../types.js";

export function formatHumanInterventionTooltip(summary: ExecutionHumanInterventionSummary): string {
  return `${summary.title}\n${summary.reason}\nWhat to do: ${summary.instructions}`;
}

export function getSprintHumanInterventionBySprintId(
  snapshot: ExecutionDashboardSnapshot,
): Map<string, ExecutionHumanInterventionSummary> {
  const result = new Map<string, ExecutionHumanInterventionSummary>();

  for (const run of snapshot.sprintRuns) {
    if (!run.humanIntervention || result.has(run.sprintId)) {
      continue;
    }
    result.set(run.sprintId, run.humanIntervention);
  }

  return result;
}

export function getPrimaryPausedInterventionRun(
  snapshot: ExecutionDashboardSnapshot,
  selectedSprintId?: string | null,
): ExecutionSprintRunSummary | null {
  return snapshot.sprintRuns.find((run) => (
    run.status === "paused"
    && Boolean(run.humanIntervention)
    && run.humanIntervention?.ownerType !== "worker"
    && (!selectedSprintId || run.sprintId === selectedSprintId)
  )) || null;
}

export function getPrimaryOverviewIntervention(
  projects: OverviewTelemetryProjectSummary[],
): OverviewTelemetryProjectSummary | null {
  return projects.find((project) => Boolean(project.humanIntervention)) || null;
}
