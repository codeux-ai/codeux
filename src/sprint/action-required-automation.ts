import type {
  AutomationInterventionsSettings,
  AutomationLevel,
  Subtask,
} from "../contracts/app-types.js";

export const isJulesManagedTask = (task: Subtask): boolean => {
  if (task.provider && task.provider !== "jules") {
    return false;
  }
  if (typeof task.session_id === "string" && task.session_id.startsWith("cli-")) {
    return false;
  }
  if (typeof task.session_name === "string" && task.session_name.startsWith("sessions/cli-")) {
    return false;
  }
  return true;
};

export const resolveTaskSessionId = (task: Subtask): string | null => {
  if (typeof task.session_id === "string" && task.session_id.trim().length > 0) {
    return task.session_id.replace(/^sessions\//, "");
  }
  if (typeof task.session_name === "string" && task.session_name.trim().length > 0) {
    return task.session_name.replace(/^sessions\//, "");
  }
  return null;
};

const shouldAutoIntervene = (
  state: string | undefined,
  automationLevel: AutomationLevel,
  settings: AutomationInterventionsSettings,
  isActionRequiredState: (state?: string) => boolean
): boolean => {
  if (!isActionRequiredState(state)) {
    return false;
  }
  if (automationLevel === "FULL") {
    return true;
  }
  if (automationLevel === "ALWAYS_ASK") {
    return false;
  }
  if (state === "AWAITING_PLAN_APPROVAL") {
    return settings.autoApprovePlan;
  }
  if (state === "AWAITING_USER_FEEDBACK") {
    return settings.autoAnswerClarification;
  }
  if (state === "PAUSED") {
    return settings.autoResumePaused;
  }
  return false;
};

const getSemiAutoDisabledReason = (state: string | undefined, settings: AutomationInterventionsSettings): string => {
  if (state === "AWAITING_PLAN_APPROVAL" && !settings.autoApprovePlan) {
    return "SEMI_AUTO policy disabled auto-approval for session plans.";
  }
  if (state === "AWAITING_USER_FEEDBACK" && !settings.autoAnswerClarification) {
    return "SEMI_AUTO policy disabled auto-answer for clarification requests.";
  }
  if (state === "PAUSED" && !settings.autoResumePaused) {
    return "SEMI_AUTO policy disabled auto-resume for paused sessions.";
  }
  return "SEMI_AUTO policy did not allow auto-intervention for this state.";
};

const getLatestAgentPrompt = (task: Subtask): string => {
  const activities = Array.isArray(task.activities) ? task.activities : [];
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const entry = activities[index] as Record<string, unknown>;
    const agentMessaged = entry.agentMessaged as Record<string, unknown> | undefined;
    const agentMessage = typeof agentMessaged?.agentMessage === "string" ? agentMessaged.agentMessage.trim() : "";
    if (agentMessage.length > 0) {
      return agentMessage;
    }
    const description = typeof entry.description === "string" ? entry.description.trim() : "";
    if (description.length > 0) {
      return description;
    }
  }
  return "";
};

const normalizeAutomationMessage = (value: string): string => value.replace(/\s+/g, " ").trim();

const buildClarificationDedupKey = (task: Subtask): string => {
  const latestPrompt = normalizeAutomationMessage(getLatestAgentPrompt(task));
  const fallback = normalizeAutomationMessage(task.prompt || task.title || "clarification");
  return (latestPrompt || fallback).slice(0, 1000);
};

const buildPausedDedupKey = (task: Subtask): string => {
  const latestPrompt = normalizeAutomationMessage(getLatestAgentPrompt(task));
  const fallback = normalizeAutomationMessage(task.prompt || task.title || "resume");
  return (latestPrompt || fallback).slice(0, 1000);
};

const getInterventionStateKey = (sessionId: string, state: "clarification" | "paused"): string => `${state}:${sessionId}`;

const buildClarificationAutoReply = (task: Subtask, template: string): string => {
  const latestPrompt = getLatestAgentPrompt(task);
  const contextBlock = latestPrompt.length > 0
    ? `Context from latest agent request: "${latestPrompt.slice(0, 400)}"\n\n`
    : "";
  return `${contextBlock}${template}`;
};

export interface ApplyActionRequiredAutomationArgs {
  projectId: string;
  sprintGoal: string;
  automationLevel: AutomationLevel;
  settings: AutomationInterventionsSettings;
  isActionRequiredState: (state?: string) => boolean;
  isJulesApiConfigured: () => boolean;
  approveSessionPlan: (sessionId: string) => Promise<unknown>;
  sendSessionMessage: (sessionId: string, prompt: string) => Promise<unknown>;
  generateWorkerClarificationReply?: (args: {
    projectId: string;
    sprintGoal: string;
    subtasks: Subtask[];
    task: Subtask;
  }) => Promise<string>;
  onTaskEvent?: (args: {
    task: Subtask;
    eventType: string;
    sourceEventKey?: string;
    payload: Record<string, unknown>;
  }) => void;
  lastAutomatedInterventionKeys?: Map<string, string>;
}

export const applyActionRequiredAutomation = async (
  subtasks: Subtask[],
  args: ApplyActionRequiredAutomationArgs
): Promise<{ subtasks: Subtask[]; reportText: string }> => {
  let reportText = "";
  const emitTaskEvent = (task: Subtask, eventType: string, payload: Record<string, unknown>, sourceSuffix?: string): void => {
    args.onTaskEvent?.({
      task,
      eventType,
      sourceEventKey: `action-required:${task.id}:${sourceSuffix || eventType}`,
      payload,
    });
  };

  for (const task of subtasks) {
    task.intervention_owner = undefined;
    task.intervention_hint = undefined;

    if (task.status !== "BLOCKED" || !args.isActionRequiredState(task.session_state)) {
      continue;
    }

    if (!isJulesManagedTask(task)) {
      task.intervention_owner = "AGENT";
      task.intervention_hint = "Task is not Jules-managed; resolve manually in provider-specific workflow.";
      emitTaskEvent(task, "action_required_manual_intervention", {
        owner: task.intervention_owner,
        reason: task.intervention_hint,
        sessionState: task.session_state || null,
      }, `manual:${task.session_state || "unknown"}:${task.intervention_owner}`);
      continue;
    }

    if (!args.isJulesApiConfigured()) {
      task.intervention_owner = "HUMAN";
      task.intervention_hint = "Jules API key is not configured; automatic intervention is unavailable.";
      emitTaskEvent(task, "action_required_manual_intervention", {
        owner: task.intervention_owner,
        reason: task.intervention_hint,
        sessionState: task.session_state || null,
      }, `manual:${task.session_state || "unknown"}:${task.intervention_owner}`);
      continue;
    }

    const autoIntervene = shouldAutoIntervene(task.session_state, args.automationLevel, args.settings, args.isActionRequiredState);
    if (!autoIntervene) {
      task.intervention_owner = "HUMAN";
      task.intervention_hint = args.automationLevel === "ALWAYS_ASK"
        ? "Automation level is ALWAYS_ASK."
        : getSemiAutoDisabledReason(task.session_state, args.settings);
      emitTaskEvent(task, "action_required_manual_intervention", {
        owner: task.intervention_owner,
        reason: task.intervention_hint,
        sessionState: task.session_state || null,
      }, `manual:${task.session_state || "unknown"}:${task.intervention_owner}`);
      continue;
    }

    const sessionId = resolveTaskSessionId(task);
    if (!sessionId) {
      task.intervention_owner = "AGENT";
      task.intervention_hint = "No session id available for automatic intervention.";
      emitTaskEvent(task, "action_required_manual_intervention", {
        owner: task.intervention_owner,
        reason: task.intervention_hint,
        sessionState: task.session_state || null,
      }, `manual:${task.session_state || "unknown"}:${task.intervention_owner}`);
      continue;
    }

    try {
      if (task.session_state === "AWAITING_PLAN_APPROVAL") {
        await args.approveSessionPlan(sessionId);
        task.status = "RUNNING";
        emitTaskEvent(task, "action_required_auto_approved", {
          sessionId,
          sessionState: task.session_state,
        }, `auto-approved:${sessionId}`);
        reportText += `🤖 **Auto-Approved Plan:** Task \`${task.id}\` session \`${sessionId}\` moved back to in-progress.\n`;
        continue;
      }

      if (task.session_state === "AWAITING_USER_FEEDBACK") {
        const clarificationKey = buildClarificationDedupKey(task);
        const storedClarificationKey = args.lastAutomatedInterventionKeys?.get(getInterventionStateKey(sessionId, "clarification"));
        if (storedClarificationKey === clarificationKey) {
          task.status = "RUNNING";
          task.intervention_owner = "AGENT";
          task.intervention_hint = "Latest clarification request was already answered automatically; waiting for Jules to resume.";
          emitTaskEvent(task, "action_required_auto_reply_skipped_duplicate", {
            sessionId,
            sessionState: task.session_state || null,
            clarificationKeyPreview: clarificationKey.slice(0, 200),
          }, `duplicate-clarification:${sessionId}`);
          continue;
        }

        let reply: string;
        if (args.settings.autoAnswerClarificationMode === "WORKER" && args.generateWorkerClarificationReply) {
          reply = await args.generateWorkerClarificationReply({
            projectId: args.projectId,
            sprintGoal: args.sprintGoal,
            subtasks,
            task,
          });
        } else {
          reply = buildClarificationAutoReply(task, args.settings.clarificationAnswerTemplate);
        }

        await args.sendSessionMessage(sessionId, reply);
        args.lastAutomatedInterventionKeys?.set(getInterventionStateKey(sessionId, "clarification"), clarificationKey);
        task.status = "RUNNING";
        emitTaskEvent(task, "action_required_auto_replied", {
          sessionId,
          sessionState: task.session_state,
          replyPreview: reply.slice(0, 200),
        }, `auto-replied:${sessionId}`);
        reportText += `🤖 **Auto-Answered Clarification:** Task \`${task.id}\` session \`${sessionId}\` received an automated response and stays in progress.\n`;
        continue;
      }

      if (task.session_state === "PAUSED") {
        const pausedKey = buildPausedDedupKey(task);
        const storedPausedKey = args.lastAutomatedInterventionKeys?.get(getInterventionStateKey(sessionId, "paused"));
        if (storedPausedKey === pausedKey) {
          task.status = "RUNNING";
          task.intervention_owner = "AGENT";
          task.intervention_hint = "Resume instruction already sent for the current paused state; waiting for Jules to continue.";
          emitTaskEvent(task, "action_required_auto_resume_skipped_duplicate", {
            sessionId,
            sessionState: task.session_state || null,
            pausedKeyPreview: pausedKey.slice(0, 200),
          }, `duplicate-paused:${sessionId}`);
          continue;
        }

        await args.sendSessionMessage(
          sessionId,
          "Continue execution using the current plan and repository conventions. Resume work and report progress."
        );
        args.lastAutomatedInterventionKeys?.set(getInterventionStateKey(sessionId, "paused"), pausedKey);
        task.status = "RUNNING";
        emitTaskEvent(task, "action_required_auto_resumed", {
          sessionId,
          sessionState: task.session_state,
        }, `auto-resumed:${sessionId}`);
        reportText += `🤖 **Auto-Resumed Session:** Task \`${task.id}\` session \`${sessionId}\` was nudged to continue.\n`;
        continue;
      }
    } catch (error) {
      task.intervention_owner = "AGENT";
      task.intervention_hint = `Auto-intervention failed: ${error instanceof Error ? error.message : String(error)}`;
      emitTaskEvent(task, "action_required_auto_failed", {
        owner: task.intervention_owner,
        reason: task.intervention_hint,
        sessionId,
        sessionState: task.session_state || null,
      }, `auto-failed:${sessionId}:${task.session_state || "unknown"}`);
      reportText += `⚠️ **Auto-Intervention Failed:** Task \`${task.id}\` could not be unblocked automatically.\n`;
    }
  }

  return { subtasks, reportText };
};
