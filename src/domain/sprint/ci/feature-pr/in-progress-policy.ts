import type { GitTrackingStatus, Subtask, CiIntelligenceSettings, AutomationLevel, GitPullRequestStatus, GitStatusCheck } from "../../../../contracts/app-types.js";
import { isCiFailure, selectFailedCiRuns, getFailedJobLabels } from "../../../../sprint/ci-status-utils.js";
import { handleCiAutofixEscalation } from "./ci-autofix-policy.js";
import type { GuardrailService } from "../../../../services/guardrail-service.js";
import type { CiFixGuardrailHandoff, WorkerCiFixPayload } from "./ci-autofix-policy.js";
import { buildInProgressText, buildFailedChecksText, buildReviewBlockersText } from "./ci-notification-builder.js";

export interface InProgressResult {
  reportText: string;
  workerCiFixRequired: boolean;
  workerCiFixPayload: WorkerCiFixPayload | null;
}

export async function evaluateInProgressState(args: {
  task: Subtask;
  pr: GitPullRequestStatus;
  checks: GitStatusCheck[];
  hasFailedChecks: boolean;
  hasPendingChecks: boolean;
  hasReviewBlockers: boolean;
  workerBranch: string | null;
  featureBranch: string;
  gitStatus: GitTrackingStatus;
  ciIntelligence: CiIntelligenceSettings;
  automationLevel: AutomationLevel;
  guardrailService: GuardrailService;
  isJulesApiConfigured: () => boolean;
  sendSessionMessage: (sessionId: string, message: string) => Promise<void>;
  repoPath: string;
  defaultBranch: string;
  hasActiveWorkerCiFixAttempt?: (task: Subtask, prNumber: number) => boolean;
  onCiFixGuardrailExhausted?: (handoff: CiFixGuardrailHandoff) => void;
}): Promise<InProgressResult> {
  const shouldKeepPolling =
    args.hasPendingChecks ||
    args.hasFailedChecks;
  args.task.status = shouldKeepPolling ? "RUNNING" : "CODING_COMPLETED";
  args.task.merge_indicator = args.hasReviewBlockers && !args.hasFailedChecks && !args.hasPendingChecks ? "MERGE_BLOCKED" : "CI";
  const ciStateLabel = args.hasFailedChecks ? "failed" : args.hasPendingChecks ? "pending" : "green";
  const header = args.hasFailedChecks ? "CI/Review Autofix Wait" : "CI/Review Merge Gate";
  const branchName = args.workerBranch || args.featureBranch;

  let reportText = buildInProgressText(args.task.id, args.pr.number, args.pr.url, branchName, ciStateLabel, header);
  let workerCiFixRequired = false;
  let workerCiFixPayload: WorkerCiFixPayload | null = null;

  if (args.hasFailedChecks) {
    const failedChecks = args.checks
      .filter((check: GitStatusCheck) => isCiFailure(check.status ?? "", check.conclusion ?? ""))
      .map((check: GitStatusCheck) => check.name);
    const failedRuns = selectFailedCiRuns(args.gitStatus, branchName);
    const failedJobLabels = getFailedJobLabels(failedRuns);

    reportText += buildFailedChecksText(branchName, failedChecks, failedRuns, failedJobLabels);

    const escalation = await handleCiAutofixEscalation({
      task: args.task,
      prNumber: args.pr.number,
      prUrl: args.pr.url,
      branchName,
      failedChecks,
      failedRuns,
      failedJobLabels,
      automationLevel: args.automationLevel,
      guardrailService: args.guardrailService,
      isJulesApiConfigured: args.isJulesApiConfigured,
      sendSessionMessage: args.sendSessionMessage,
      repoPath: args.repoPath,
      featureBranch: args.featureBranch,
      defaultBranch: args.defaultBranch,
      allowJulesSessionNotification: args.ciIntelligence.waitForJulesCiAutofix,
      hasActiveWorkerCiFixAttempt: args.hasActiveWorkerCiFixAttempt,
      onGuardrailExhausted: args.onCiFixGuardrailExhausted,
    });
    reportText += escalation.reportTextAddition;
    workerCiFixRequired = escalation.workerCiFixRequired;
    workerCiFixPayload = escalation.workerCiFixPayload;
  }

  if (args.hasReviewBlockers) {
    reportText += buildReviewBlockersText(args.pr.number, args.pr.reviewDecision, args.pr.comments);
  }

  return { reportText, workerCiFixRequired, workerCiFixPayload };
}
