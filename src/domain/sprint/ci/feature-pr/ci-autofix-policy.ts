import { getFailedJobLabels, getFailedLogSnippets, summarizeFailedRuns } from "../../../../sprint/ci-status-utils.js";
import { isJulesManagedTask, resolveTaskSessionId } from "../../../../sprint/action-required-automation.js";
import type { AutomationLevel, GitCiRunStatus, Subtask } from "../../../../contracts/app-types.js";
import type { GuardrailScope, GuardrailService } from "../../../../services/guardrail-service.js";
import {
  appendJulesCiFixDispatchEvent,
  buildJulesCiFixAttemptIdentity,
  claimJulesCiFixAttempt,
  hasActiveJulesCiFixAttempt,
  type JulesCiFixExecutionRepository,
} from "./jules-ci-fix-single-flight.js";

export function getCiAutofixRetryKey(task: Subtask, prNumber: number): string {
  const sessionId = resolveTaskSessionId(task) || task.id;
  return `${sessionId}:${prNumber}`;
}

/** Resolves the (scope, taskId) needed to track guardrails for a task, or null when unavailable. */
export function resolveGuardrailTaskRef(task: Subtask): { scope: GuardrailScope; taskId: string } | null {
  const taskId = task.record_id;
  const projectId = task.project_id;
  if (!taskId || !projectId) {
    return null;
  }
  return { scope: { projectId, sprintId: task.sprint_id ?? null }, taskId };
}

export function resolveCiEscalationOwner(automationLevel: AutomationLevel): "AGENT" | "HUMAN" {
  return automationLevel === "FULL" ? "AGENT" : "HUMAN";
}

export async function notifyJulesAboutFailedCi(args: {
  task: Subtask;
  prNumber: number;
  prUrl: string;
  branchName: string;
  failedChecks: string[];
  failedRuns: GitCiRunStatus[];
  attempt: number;
  maxRetries: number;
  isJulesApiConfigured: () => boolean;
  sendSessionMessage: (sessionId: string, message: string) => Promise<void>;
}): Promise<{ sent: boolean; reason?: string }> {
  if (!isJulesManagedTask(args.task)) {
    return { sent: false, reason: "Task is not Jules-managed." };
  }
  if (!args.isJulesApiConfigured()) {
    return { sent: false, reason: "Jules API key is not configured." };
  }
  const sessionId = resolveTaskSessionId(args.task);
  if (!sessionId) {
    return { sent: false, reason: "No session id available." };
  }

  const failedChecksLine = args.failedChecks.length > 0 ? args.failedChecks.join(", ") : "unknown checks";
  const failedRunsLine = summarizeFailedRuns(args.failedRuns);
  const failedJobsLine = getFailedJobLabels(args.failedRuns);
  const failedLogSnippets = getFailedLogSnippets(args.failedRuns);
  const prompt = [
    `CI failed for your task PR #${args.prNumber} on branch ${args.branchName}.`,
    `PR URL: ${args.prUrl}.`,
    `Failed checks: ${failedChecksLine}.`,
    `Failed runs: ${failedRunsLine}.`,
    `Failed jobs: ${failedJobsLine.length > 0 ? failedJobsLine.join(", ") : "unknown jobs"}.`,
    `Autofix attempt ${args.attempt} of ${args.maxRetries}.`,
    "Please fix the CI issues, commit the necessary changes, and push updates to the same branch.",
    "Continue until checks are green.",
    failedLogSnippets.length > 0
      ? `Failed job logs (excerpt):\n${failedLogSnippets.join("\n\n")}`
      : "Failed job logs were not available from CI metadata. Use `gh run view <run-id> --log-failed`.",
  ].join("\n");

  await args.sendSessionMessage(sessionId, prompt);
  return { sent: true };
}

export interface WorkerCiFixPayload {
  repoPath: string;
  featureBranch: string;
  defaultBranch: string;
  taskKey: string;
  taskTitle: string;
  taskPrompt: string;
  workerBranch: string | null;
  prUrl: string;
  prNumber: number;
  branchName: string;
  failedChecks: string[];
  failedRuns: GitCiRunStatus[];
  failedJobLabels: string[];
  failedLogSnippets: string[];
}

export function buildWorkerCiFixPayload(args: {
  task: Subtask;
  prNumber: number;
  prUrl: string;
  branchName: string;
  failedChecks: string[];
  failedRuns: GitCiRunStatus[];
  repoPath: string;
  featureBranch: string;
  defaultBranch: string;
}): WorkerCiFixPayload {
  return {
    repoPath: args.repoPath,
    featureBranch: args.featureBranch,
    defaultBranch: args.defaultBranch,
    taskKey: args.task.id,
    taskTitle: args.task.title,
    taskPrompt: args.task.prompt,
    workerBranch: args.task.worker_branch || null,
    prUrl: args.prUrl,
    prNumber: args.prNumber,
    branchName: args.branchName,
    failedChecks: args.failedChecks,
    failedRuns: args.failedRuns,
    failedJobLabels: getFailedJobLabels(args.failedRuns),
    failedLogSnippets: getFailedLogSnippets(args.failedRuns),
  };
}

export interface CiAutofixEscalationArgs {
  task: Subtask;
  prNumber: number;
  prUrl: string;
  branchName: string;
  failedChecks: string[];
  failedRuns: GitCiRunStatus[];
  failedJobLabels: string[];
  automationLevel: AutomationLevel;
  guardrailService: GuardrailService;
  isJulesApiConfigured: () => boolean;
  sendSessionMessage: (sessionId: string, message: string) => Promise<void>;
  repoPath: string;
  featureBranch: string;
  defaultBranch: string;
  executionRepository?: JulesCiFixExecutionRepository;
  taskRunId?: string | null;
  prHeadSha?: string | null;
  allowJulesSessionNotification?: boolean;
  hasActiveWorkerCiFixAttempt?: (task: Subtask, prNumber: number) => boolean;
  onGuardrailExhausted?: (handoff: CiFixGuardrailHandoff) => void;
}

export interface CiFixGuardrailHandoff {
  task: Subtask;
  payload: WorkerCiFixPayload;
  attempts: number;
  cap: number;
}

export interface CiAutofixEscalationResult {
  reportTextAddition: string;
  workerCiFixRequired: boolean;
  workerCiFixPayload: WorkerCiFixPayload | null;
}

export async function handleCiAutofixEscalation(args: CiAutofixEscalationArgs): Promise<CiAutofixEscalationResult> {
  let reportTextAddition = "";
  const taskRef = resolveGuardrailTaskRef(args.task);
  const evaluation = taskRef
    ? args.guardrailService.evaluate(taskRef.scope, taskRef.taskId, "ci_fix")
    : { allowed: true, count: 0, cap: 0, action: "BLOCK_AND_ESCALATE" as const };
  const currentRetries = evaluation.count;
  const cap = evaluation.cap;
  const capLabel = cap > 0 ? String(cap) : "∞";
  const recordCiFix = (sourceKey: string) => {
    if (taskRef) {
      if (typeof args.guardrailService.recordOnce === "function") {
        args.guardrailService.recordOnce(
          taskRef.scope,
          taskRef.taskId,
          "ci_fix",
          sourceKey,
          "Jules CI repair message delivered",
        );
      } else {
        args.guardrailService.record(taskRef.scope, taskRef.taskId, "ci_fix");
      }
    }
  };
  const activeWorkerCiFixAttempt = args.hasActiveWorkerCiFixAttempt?.(args.task, args.prNumber) || false;
  const activeJulesCiFixAttempt = isJulesManagedTask(args.task)
    && hasActiveJulesCiFixAttempt({
      executionRepository: args.executionRepository,
      taskRunId: args.taskRunId,
      prNumber: args.prNumber,
      prHeadSha: args.prHeadSha,
      failedChecks: args.failedChecks,
      failedRuns: args.failedRuns,
      sessionState: args.task.session_state,
    });

  if (activeWorkerCiFixAttempt || activeJulesCiFixAttempt) {
    const actor = activeJulesCiFixAttempt ? "Jules CI fix" : "Worker CI fix";
    const waitCondition = activeJulesCiFixAttempt
      ? "session completion and a pushed commit"
      : "completion";
    reportTextAddition += `   - ${actor} already running (attempt ${Math.max(1, currentRetries)}/${capLabel}). Waiting for ${waitCondition} before retrying.\n`;
    return { reportTextAddition, workerCiFixRequired: false, workerCiFixPayload: null };
  }

  if (!evaluation.allowed) {
    // A hard CI-repair cap is a terminal automation boundary. Even in FULL
    // automation mode it must become an explicit human handoff; leaving the
    // intervention assigned to an agent lets the protocol reopen ordinary
    // coding work and defeats the guardrail.
    const owner = "HUMAN";
    args.task.status = "BLOCKED";
    args.task.intervention_owner = owner;
    args.task.intervention_hint = `CI autofix guardrail reached (${currentRetries}/${capLabel}) for task ${
      args.task.id
    } - PR: ${args.prUrl} - Failed checks: ${args.failedChecks.join(", ")} - Failed jobs: ${
      args.failedJobLabels.length > 0 ? args.failedJobLabels.join(", ") : "unknown jobs"
    } - Failed runs: ${summarizeFailedRuns(args.failedRuns)}`;
    reportTextAddition += `   - 🚨 CI autofix guardrail reached (${currentRetries}/${capLabel}).\n`;
    reportTextAddition += `   - Escalation (${owner}): Task \`${args.task.id}\` has failing CI and cannot be merged yet.\n`;
    reportTextAddition += `   - PR Link: ${args.prUrl}\n`;
    reportTextAddition += `   - Required next action: fix failing checks, then continue merge flow.\n`;
    args.onGuardrailExhausted?.({
      task: args.task,
      payload: buildWorkerCiFixPayload({
        task: args.task,
        prNumber: args.prNumber,
        prUrl: args.prUrl,
        branchName: args.branchName,
        failedChecks: args.failedChecks,
        failedRuns: args.failedRuns,
        repoPath: args.repoPath,
        featureBranch: args.featureBranch,
        defaultBranch: args.defaultBranch,
      }),
      attempts: currentRetries,
      cap,
    });
    return { reportTextAddition, workerCiFixRequired: false, workerCiFixPayload: null };
  }

  if (args.allowJulesSessionNotification !== false) {
    const identity = buildJulesCiFixAttemptIdentity(args);
    let attemptId = `${identity.baseAttemptKey}:legacy`;
    if (
      isJulesManagedTask(args.task)
      && args.isJulesApiConfigured()
      && resolveTaskSessionId(args.task)
      && args.executionRepository
      && args.taskRunId
      && typeof args.executionRepository.listTaskRunEvents === "function"
      && typeof args.executionRepository.appendTaskRunEvent === "function"
    ) {
      const claim = claimJulesCiFixAttempt({
        executionRepository: args.executionRepository,
        taskRunId: args.taskRunId,
        task: args.task,
        prNumber: args.prNumber,
        prHeadSha: args.prHeadSha,
        failedChecks: args.failedChecks,
        failedRuns: args.failedRuns,
        attempt: currentRetries + 1,
      });
      attemptId = claim.attemptId;
      if (!claim.claimed) {
        reportTextAddition += `   - Jules CI fix dispatch is already claimed. Waiting for session completion and a pushed commit before retrying.\n`;
        return { reportTextAddition, workerCiFixRequired: false, workerCiFixPayload: null };
      }
    }

    let notifyResult: Awaited<ReturnType<typeof notifyJulesAboutFailedCi>>;
    try {
      notifyResult = await notifyJulesAboutFailedCi({
        task: args.task,
        prNumber: args.prNumber,
        prUrl: args.prUrl,
        branchName: args.branchName,
        failedChecks: args.failedChecks,
        failedRuns: args.failedRuns,
        attempt: currentRetries + 1,
        maxRetries: cap,
        isJulesApiConfigured: args.isJulesApiConfigured,
        sendSessionMessage: args.sendSessionMessage,
      });
    } catch (error) {
      appendJulesCiFixDispatchEvent({
        executionRepository: args.executionRepository,
        taskRunId: args.taskRunId,
        eventType: "jules_ci_fix_dispatch_failed",
        attemptId,
        identity,
        prNumber: args.prNumber,
        error,
      });
      throw error;
    }

    if (notifyResult.sent) {
      appendJulesCiFixDispatchEvent({
        executionRepository: args.executionRepository,
        taskRunId: args.taskRunId,
        eventType: "jules_ci_fix_message_sent",
        attemptId,
        identity,
        prNumber: args.prNumber,
      });
      // A successful message resumes a completed Jules session. Mark the local
      // projection non-terminal immediately so a fast intermediate push cannot
      // release the single-flight lease before session sync observes the resume.
      args.task.session_state = "RUNNING";
      recordCiFix(attemptId);
      reportTextAddition += `   - Jules session notified to fix CI and continue work (attempt ${
        currentRetries + 1
      }/${capLabel}).\n`;
      return { reportTextAddition, workerCiFixRequired: false, workerCiFixPayload: null };
    }
  }

  // Task is not using the Jules notification path, or notification failed — dispatch to a worker.
  const payload = buildWorkerCiFixPayload({
    task: args.task,
    prNumber: args.prNumber,
    prUrl: args.prUrl,
    branchName: args.branchName,
    failedChecks: args.failedChecks,
    failedRuns: args.failedRuns,
    repoPath: args.repoPath,
    featureBranch: args.featureBranch,
    defaultBranch: args.defaultBranch,
  });
  // NOTE: do NOT record here — the virtual worker records the ci_fix invocation when it
  // actually resolves the dispatched attention item (see resolveCiFixAttention), so recording
  // here as well would double-count. The hasActiveWorkerCiFixAttempt guard prevents re-dispatch
  // while that worker run is in flight.
  reportTextAddition += `   - Worker CI fix dispatched (attempt ${currentRetries + 1}/${capLabel}).\n`;

  return { reportTextAddition, workerCiFixRequired: true, workerCiFixPayload: payload };
}
