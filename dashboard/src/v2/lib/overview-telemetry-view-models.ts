import { AlertTriangle, type LucideIcon } from "lucide-preact";
import type { OverviewTelemetryProjectSummary, OverviewTelemetrySnapshot, ExecutionRuntimeEventSummary } from "../../types.js";

export interface EventStyle {
  label: string;
  toneClass: string;
}

export interface InterventionNotificationViewModel {
  id: string;
  projectName: string;
  title: string;
  subtitle: string;
  icon: LucideIcon;
  toneClass: string;
  unread: boolean;
}

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

export function getEventStyle(event: ExecutionRuntimeEventSummary): EventStyle {
  const type = event.eventType;
  const status = event.sprintRunStatus;
  const state = event.taskRunState;

  // Use state/status to enrich the label if applicable, else fallback to event type
  let baseLabel = type.replace(/_/g, " ");
  if (type === "run_running" && state) {
    baseLabel = `task ${state}`;
  } else if (type === "sprint_paused") {
    baseLabel = "sprint paused";
  } else if (type.includes("sprint_") && status) {
    baseLabel = `sprint ${status}`;
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

export function getInterventionContent(project: OverviewTelemetryProjectSummary): { title: string } | null {
  if (!project.humanIntervention) {
    return null;
  }
  return {
    title: project.humanIntervention.title || "Human intervention required",
  };
}

export function buildInterventionNotifications(telemetry: OverviewTelemetrySnapshot): InterventionNotificationViewModel[] {
  return (telemetry?.attentionProjects || [])
    .filter((project) => project.humanIntervention !== null)
    .map((project) => {
      const intervention = project.humanIntervention;
      return {
        id: project.projectId,
        projectName: project.projectName,
        title: getInterventionContent(project)?.title || "Human intervention required",
        subtitle: intervention?.reason || "",
        icon: AlertTriangle,
        toneClass: "text-status-amber",
        unread: true,
      };
    });
}
