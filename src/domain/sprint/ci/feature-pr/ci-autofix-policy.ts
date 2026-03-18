import { getFailedJobLabels, getFailedLogSnippets, summarizeFailedRuns } from "../../../../sprint/ci-status-utils.js";
import { isJulesManagedTask, resolveTaskSessionId } from "../../../../sprint/action-required-automation.js";
import type { AutomationLevel, GitCiRunStatus, Subtask } from "../../../../contracts/app-types.js";

export function getCiAutofixRetryKey(task: Subtask, prNumber: number): string {
  const sessionId = resolveTaskSessionId(task) || task.id;
  return `${sessionId}:${prNumber}`;
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
  maxRetries: number;
  ciAutofixRetryCounts: Map<string, number>;
  isJulesApiConfigured: () => boolean;
  sendSessionMessage: (sessionId: string, message: string) => Promise<void>;
  repoPath: string;
  featureBranch: string;
  defaultBranch: string;
}

export interface CiAutofixEscalationResult {
  reportTextAddition: string;
  workerCiFixRequired: boolean;
  workerCiFixPayload: WorkerCiFixPayload | null;
}

export async function handleCiAutofixEscalation(args: CiAutofixEscalationArgs): Promise<CiAutofixEscalationResult> {
  let reportTextAddition = "";
  const retryKey = getCiAutofixRetryKey(args.task, args.prNumber);
  const maxRetries = Math.max(0, args.maxRetries);
  const currentRetries = args.ciAutofixRetryCounts.get(retryKey) || 0;

  if (currentRetries >= maxRetries) {
    const owner = resolveCiEscalationOwner(args.automationLevel);
    args.task.status = "BLOCKED";
    args.task.intervention_owner = owner;
    args.task.intervention_hint = `CI autofix retry limit reached (${currentRetries}/${maxRetries}) for task ${
      args.task.id
    } - PR: ${args.prUrl} - Failed checks: ${args.failedChecks.join(", ")} - Failed jobs: ${
      args.failedJobLabels.length > 0 ? args.failedJobLabels.join(", ") : "unknown jobs"
    } - Failed runs: ${summarizeFailedRuns(args.failedRuns)}`;
    reportTextAddition += `   - 🚨 CI autofix retries exhausted (${currentRetries}/${maxRetries}).\n`;
    reportTextAddition += `   - Escalation (${owner}): Task \`${args.task.id}\` has failing CI and cannot be merged yet.\n`;
    reportTextAddition += `   - PR Link: ${args.prUrl}\n`;
    reportTextAddition += `   - Required next action: fix failing checks, then continue merge flow.\n`;
    return { reportTextAddition, workerCiFixRequired: false, workerCiFixPayload: null };
  }

  // For Jules-managed tasks, try the Jules session notification path first.
  const notifyResult = await notifyJulesAboutFailedCi({
    task: args.task,
    prNumber: args.prNumber,
    prUrl: args.prUrl,
    branchName: args.branchName,
    failedChecks: args.failedChecks,
    failedRuns: args.failedRuns,
    attempt: currentRetries + 1,
    maxRetries,
    isJulesApiConfigured: args.isJulesApiConfigured,
    sendSessionMessage: args.sendSessionMessage,
  });
  args.ciAutofixRetryCounts.set(retryKey, currentRetries + 1);

  if (notifyResult.sent) {
    reportTextAddition += `   - Jules session notified to fix CI and continue work (attempt ${
      currentRetries + 1
    }/${maxRetries}).\n`;
    return { reportTextAddition, workerCiFixRequired: false, workerCiFixPayload: null };
  }

  // Task is not Jules-managed or notification failed — dispatch to a worker.
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
  reportTextAddition += `   - Worker CI fix dispatched (attempt ${currentRetries + 1}/${maxRetries}).\n`;

  return { reportTextAddition, workerCiFixRequired: true, workerCiFixPayload: payload };
}
