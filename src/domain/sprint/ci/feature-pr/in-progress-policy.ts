import type { GitTrackingStatus, Subtask, CiIntelligenceSettings, AutomationLevel } from "../../../../contracts/app-types.js";
import { isCiFailure, selectFailedCiRuns, getFailedJobLabels } from "../../../../sprint/ci-status-utils.js";
import { handleCiAutofixEscalation } from "./ci-autofix-policy.js";
import type { WorkerCiFixPayload } from "./ci-autofix-policy.js";
import { buildInProgressText, buildFailedChecksText, buildReviewBlockersText } from "./ci-notification-builder.js";

export interface InProgressResult {
  reportText: string;
  workerCiFixRequired: boolean;
  workerCiFixPayload: WorkerCiFixPayload | null;
}

export async function evaluateInProgressState(args: {
  task: Subtask;
  pr: any;
  checks: any[];
  hasFailedChecks: boolean;
  hasPendingChecks: boolean;
  hasReviewBlockers: boolean;
  workerBranch: string | null;
  featureBranch: string;
  gitStatus: GitTrackingStatus;
  ciIntelligence: CiIntelligenceSettings;
  automationLevel: AutomationLevel;
  ciAutofixRetryCounts: Map<string, number>;
  isJulesApiConfigured: () => boolean;
  sendSessionMessage: (sessionId: string, message: string) => Promise<void>;
  repoPath: string;
  defaultBranch: string;
}): Promise<InProgressResult> {
  args.task.status = "RUNNING";
  args.task.merge_indicator = args.hasReviewBlockers && !args.hasFailedChecks && !args.hasPendingChecks ? "MERGE_BLOCKED" : "CI";
  const ciStateLabel = args.hasFailedChecks ? "failed" : args.hasPendingChecks ? "pending" : "green";
  const header = args.ciIntelligence.waitForJulesCiAutofix ? "CI/Review Autofix Wait" : "CI/Review Merge Gate";
  const branchName = args.workerBranch || args.featureBranch;

  let reportText = buildInProgressText(args.task.id, args.pr.number, args.pr.url, branchName, ciStateLabel, header);
  let workerCiFixRequired = false;
  let workerCiFixPayload: WorkerCiFixPayload | null = null;

  if (args.hasFailedChecks) {
    const failedChecks = args.checks
      .filter((check: any) => isCiFailure(check.status ?? "", check.conclusion ?? ""))
      .map((check: any) => check.name);
    const failedRuns = selectFailedCiRuns(args.gitStatus, branchName);
    const failedJobLabels = getFailedJobLabels(failedRuns);

    reportText += buildFailedChecksText(branchName, failedChecks, failedRuns, failedJobLabels);

    if (args.ciIntelligence.waitForJulesCiAutofix) {
      const escalation = await handleCiAutofixEscalation({
        task: args.task,
        prNumber: args.pr.number,
        prUrl: args.pr.url,
        branchName,
        failedChecks,
        failedRuns,
        failedJobLabels,
        automationLevel: args.automationLevel,
        maxRetries: args.ciIntelligence.julesCiAutofixMaxRetries,
        ciAutofixRetryCounts: args.ciAutofixRetryCounts,
        isJulesApiConfigured: args.isJulesApiConfigured,
        sendSessionMessage: args.sendSessionMessage,
        repoPath: args.repoPath,
        featureBranch: args.featureBranch,
        defaultBranch: args.defaultBranch,
      });
      reportText += escalation.reportTextAddition;
      workerCiFixRequired = escalation.workerCiFixRequired;
      workerCiFixPayload = escalation.workerCiFixPayload;
    }
  }

  if (args.hasReviewBlockers) {
    reportText += buildReviewBlockersText(args.pr.number, args.pr.reviewDecision, args.pr.comments);
  }

  return { reportText, workerCiFixRequired, workerCiFixPayload };
}
