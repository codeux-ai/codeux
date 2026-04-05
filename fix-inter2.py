import re

with open('src/repositories/execution/execution-human-intervention-query.ts', 'r') as f:
    content = f.read()

replacement = """function buildHumanInterventionSummaryFromEvents(
  sprintRunStatus: string,
  events: ExecutionRuntimeEventSummaryRow[],
): ExecutionHumanInterventionSummary | null {
  if (events.length === 0) {
    return null;
  }

  const latestRelevantEvent = events.find((event) => (
    event.event_type === "branch_preflight_blocked"
    || event.event_type === "planning_preflight_blocked"
    || event.event_type === "sprint_merge_required"
    || event.event_type === "sprint_no_more_actions"
    || event.event_type === "sprint_paused"
  ));
  if (latestRelevantEvent) {
    const payload = parsePayloadJson(latestRelevantEvent.payload_json);
    switch (latestRelevantEvent.event_type) {
      case "branch_preflight_blocked": {
        const featureBranch = asNonEmptyString(payload?.featureBranch) || "the sprint feature branch";
        return {
          title: "Branch preparation blocked",
          reason: `Sprint OS could not prepare ${featureBranch} automatically.`,
          instructions: "Check git authentication, remote push permissions, and local branch state, then resume the sprint.",
          attentionType: null,
          severity: "high",
          ownerType: "human",
        };
      }
      case "planning_preflight_blocked": {
        const planningTarget = asNonEmptyString(payload?.planningTarget) || "this sprint";
        return {
          title: "Sprint planning required",
          reason: `${planningTarget} must be planned into executable tasks before orchestration can continue.`,
          instructions: "Use Plan Sprint on the Sprints page, review the generated tasks, then start the sprint again.",
          attentionType: null,
          severity: "medium",
          ownerType: "human",
        };
      }
      case "sprint_merge_required": {
        const awaitingMergeCount = Number(payload?.awaitingMergeCount || 0);
        return {
          title: "Manual merge required",
          reason: `Sprint execution paused because ${awaitingMergeCount || "one or more"} completed task${awaitingMergeCount === 1 ? "" : "s"} still need manual merge work.`,
          instructions: "Merge the completed task branches or PRs into the sprint branch, then resume the sprint. You can enable feature PR automerge later to reduce manual merges.",
          attentionType: null,
          severity: "medium",
          ownerType: "human",
        };
      }
      case "sprint_no_more_actions":
        return {
          title: "Waiting for work",
          reason: "There are no pending, actionable tasks available in the active sprint.",
          instructions: "Add tasks to the sprint, or resolve blocking tasks to free up dependent work.",
          attentionType: null,
          severity: "low",
          ownerType: "human",
        };
      case "sprint_paused":
        return {
          title: "Sprint paused",
          reason: "The sprint was manually paused by a team member.",
          instructions: "Resume the sprint when ready to continue execution.",
          attentionType: null,
          severity: "low",
          ownerType: "human",
        };
    }
  }

  if (sprintRunStatus !== "error" && sprintRunStatus !== "paused") {
    return null;
  }

  const errorEvents = [...events].filter((e) => e.event_type === "dispatch_error" || e.event_type === "sprint_run_error");
  errorEvents.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  for (const errorEvent of errorEvents) {
    const payload = parsePayloadJson(errorEvent.payload_json);
    if (!payload?.error) {
      continue;
    }
    const reason = typeof payload.error === "string" ? payload.error : (payload.error as any).message || "An unknown execution error occurred";
    const shortReason = reason.length > 500 ? reason.substring(0, 500) + "..." : reason;

    if (errorEvent.event_type === "dispatch_error") {
      const title = errorEvent.task_title ? `Task Error: ${errorEvent.task_title}` : "Task Dispatch Error";
      return createHumanInterventionSummary(
        null,
        title,
        shortReason,
        "A task dispatch failed. Review the task logs, perform any necessary cleanup, and resume the sprint.",
      );
    }

    if (errorEvent.event_type === "sprint_run_error") {
      return createHumanInterventionSummary(
        null,
        "Sprint Execution Error",
        shortReason,
        "A critical execution error occurred during the sprint. Review the sprint logs, perform any necessary cleanup, and resume the sprint.",
      );
    }
  }

  return null;
}"""

content = re.sub(
    r'function buildHumanInterventionSummaryFromEvents\([\s\S]*?  return null;\n\}',
    replacement,
    content
)

with open('src/repositories/execution/execution-human-intervention-query.ts', 'w') as f:
    f.write(content)
