import { describe, expect, it } from "vitest";
import { AlertTriangle } from "lucide-preact";
import {
  buildInterventionNotifications,
  buildProjectLookup,
  getEventStyle,
  getInterventionContent,
} from "../../../dashboard/src/v2/lib/overview-telemetry-view-models.js";
import type { OverviewTelemetrySnapshot, ExecutionRuntimeEventSummary, OverviewTelemetryProjectSummary } from "../../../dashboard/src/types.js";

describe("overview-telemetry-view-models", () => {
  describe("buildProjectLookup", () => {
    it("combines active and attention projects into a fast lookup map", () => {
      const telemetry: OverviewTelemetrySnapshot = {
        activeProjects: [
          { projectId: "p1", projectName: "Project 1" } as OverviewTelemetryProjectSummary,
        ],
        attentionProjects: [
          { projectId: "p2", projectName: "Project 2" } as OverviewTelemetryProjectSummary,
        ],
        recentEvents: [],
        updatedAt: null,
      };

      const lookup = buildProjectLookup(telemetry);

      expect(lookup.get("p1")).toBe("Project 1");
      expect(lookup.get("p2")).toBe("Project 2");
      expect(lookup.get("p3")).toBeUndefined();
    });
  });

  describe("getEventStyle", () => {
    it("returns red for failures and errors", () => {
      expect(getEventStyle({ eventType: "run_failed", taskRunState: "failed" } as ExecutionRuntimeEventSummary).toneClass).toBe("text-status-red");
      expect(getEventStyle({ eventType: "dispatch_error" } as ExecutionRuntimeEventSummary).toneClass).toBe("text-status-red");
    });

    it("returns green for completions and successes", () => {
      expect(getEventStyle({ eventType: "run_completed" } as ExecutionRuntimeEventSummary).toneClass).toBe("text-status-green");
      expect(getEventStyle({ eventType: "cli_git_pushed" } as ExecutionRuntimeEventSummary).toneClass).toBe("text-status-green");
    });

    it("returns amber for blocked or paused events", () => {
      expect(getEventStyle({ eventType: "run_blocked" } as ExecutionRuntimeEventSummary).toneClass).toBe("text-status-amber");
      expect(getEventStyle({ eventType: "cli_git_no_changes" } as ExecutionRuntimeEventSummary).toneClass).toBe("text-status-amber");
    });

    it("returns blue for started or running events", () => {
      expect(getEventStyle({ eventType: "dispatch_started" } as ExecutionRuntimeEventSummary).toneClass).toBe("text-status-blue");
      expect(getEventStyle({ eventType: "run_running" } as ExecutionRuntimeEventSummary).toneClass).toBe("text-status-blue");
    });

    it("returns default slate for generic events", () => {
      expect(getEventStyle({ eventType: "session_created" } as ExecutionRuntimeEventSummary).toneClass).toBe("text-slate-500");
    });

    it("formats labels without underscores", () => {
      expect(getEventStyle({ eventType: "run_blocked" } as ExecutionRuntimeEventSummary).label).toBe("run blocked");
    });

    it("uses state/status to enrich labels", () => {
      expect(getEventStyle({ eventType: "run_running", taskRunState: "in_progress" } as ExecutionRuntimeEventSummary).label).toBe("task in_progress");
      expect(getEventStyle({ eventType: "sprint_paused", sprintRunStatus: "paused" } as ExecutionRuntimeEventSummary).label).toBe("sprint paused");
      expect(getEventStyle({ eventType: "sprint_completed", sprintRunStatus: "completed" } as ExecutionRuntimeEventSummary).label).toBe("sprint completed");
    });
  });

  describe("getInterventionContent", () => {
    it("returns null when there is no intervention", () => {
      const project = { humanIntervention: null } as OverviewTelemetryProjectSummary;
      expect(getInterventionContent(project)).toBeNull();
    });

    it("extracts only the title from a human intervention", () => {
      const project = {
        humanIntervention: {
          title: "Merge Required",
          reason: "Needs review.",
          instructions: "Approve PR.",
        },
      } as OverviewTelemetryProjectSummary;

      const content = getInterventionContent(project);
      expect(content).toEqual({ title: "Merge Required" });
      expect((content as any).reason).toBeUndefined();
    });
  });

  describe("buildInterventionNotifications", () => {
    it("maps human interventions into amber notification rows", () => {
      const telemetry: OverviewTelemetrySnapshot = {
        activeProjects: [],
        attentionProjects: [
          {
            projectId: "project-1",
            projectName: "Alpha Project",
            sprintId: "sprint-1",
            sprintName: "Sprint One",
            sprintNumber: 1,
            sprintRunId: "run-1",
            sprintRunStatus: "paused",
            activeDispatchCount: 0,
            runningDispatchCount: 0,
            updatedAt: null,
            humanIntervention: {
              title: "Merge Required",
              reason: "Approve the outstanding pull request before resuming.",
              instructions: "Review the diff and merge it.",
              attentionType: "merge",
              severity: "high",
              ownerType: "human",
            },
          },
        ],
        recentEvents: [],
        updatedAt: null,
      };

      expect(buildInterventionNotifications(telemetry)).toEqual([{
        id: "project-1",
        projectName: "Alpha Project",
        title: "Merge Required",
        subtitle: "Approve the outstanding pull request before resuming.",
        icon: AlertTriangle,
        toneClass: "text-status-amber",
        unread: true,
      }]);
    });

    it("falls back to a default title when the intervention title is empty", () => {
      const telemetry: OverviewTelemetrySnapshot = {
        activeProjects: [],
        attentionProjects: [
          {
            projectId: "project-2",
            projectName: "Beta Project",
            sprintId: "sprint-2",
            sprintName: "Sprint Two",
            sprintNumber: 2,
            sprintRunId: "run-2",
            sprintRunStatus: "paused",
            activeDispatchCount: 0,
            runningDispatchCount: 0,
            updatedAt: null,
            humanIntervention: {
              title: "",
              reason: "Waiting on operator input.",
              instructions: "Take action.",
              attentionType: "manual",
              severity: "medium",
              ownerType: "human",
            },
          },
        ],
        recentEvents: [],
        updatedAt: null,
      };

      expect(buildInterventionNotifications(telemetry)[0]?.title).toBe("Human intervention required");
    });
  });
});
