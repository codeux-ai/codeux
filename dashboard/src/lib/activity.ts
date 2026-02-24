import type { JulesActivity } from "../types.js";

export const getActivityText = (activity?: JulesActivity): string => {
  if (!activity) return "System activity...";
  if (activity.agentMessaged?.agentMessage) return activity.agentMessaged.agentMessage;
  if (activity.userMessaged?.userMessage) return activity.userMessaged.userMessage;
  if (activity.progressUpdated?.title || activity.progressUpdated?.description) {
    return activity.progressUpdated.title || activity.progressUpdated.description || "System activity...";
  }
  if (activity.planGenerated?.plan?.steps?.length) {
    const firstStep = activity.planGenerated.plan.steps[0];
    return firstStep?.title ? `Plan generated: ${firstStep.title}` : "Plan generated";
  }
  if (activity.planApproved?.planId) return `Plan approved (${activity.planApproved.planId})`;
  if (activity.sessionFailed?.reason) return `Session failed: ${activity.sessionFailed.reason}`;
  if (activity.sessionCompleted) return "Session completed";
  if (activity.description) return activity.description;
  return "System activity...";
};
