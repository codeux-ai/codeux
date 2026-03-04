import {
  isCiFailure,
  isCiPending,
} from "../../../sprint/ci-status-utils.js";
import type {
  CiIntelligenceSettings,
  GitTrackingStatus,
} from "../../../contracts/app-types.js";

export interface MergeFeedbackContext {
  repoPath: string;
  featureBranch: string;
  defaultBranch: string;
  featureBranchPrefix: string;
  ciIntelligence: CiIntelligenceSettings;
  githubMode: "REMOTE" | "LOCAL";
  gitStatus: GitTrackingStatus | null;
}

/**
 * Service for rendering feedback about the main merge CI gate.
 */
export class MainMergeGateService {
  /**
   * Renders a feedback report for the main merge PR status.
   */
  public static async renderMergeFeedback(context: MergeFeedbackContext): Promise<string> {
    const {
      featureBranch,
      defaultBranch,
      ciIntelligence,
      githubMode,
      gitStatus,
    } = context;

    if (
      !ciIntelligence.enabled ||
      !ciIntelligence.enableLivePrMonitoring ||
      !ciIntelligence.waitForCiBeforeMainMerge ||
      githubMode !== "REMOTE" ||
      !gitStatus
    ) {
      return "";
    }

    if (!gitStatus.available) {
      return "";
    }

    const mainMergePr = gitStatus.openPullRequests.find(
      (pr) => pr.baseRefName === defaultBranch && pr.headRefName === featureBranch
    );

    if (!mainMergePr) {
      return `\nℹ️ **Main CI Gate:** No open PR \`${featureBranch} -> ${defaultBranch}\` found. Create the PR and wait for CI.\n`;
    }

    const checks = Array.isArray(mainMergePr.checks) ? mainMergePr.checks : [];
    const hasFailedChecks = checks.some((check) => isCiFailure(check.status, check.conclusion));
    const hasPendingChecks = checks.length === 0 || checks.some((check) => isCiPending(check.status, check.conclusion));
    const hasReviewBlockers = mainMergePr.reviewDecision === "CHANGES_REQUESTED" || mainMergePr.comments > 0;

    let text = `\n### Main Merge CI Gate\n`;
    text += `- PR: ${mainMergePr.url}\n`;
    text += `- Check Status: \`${hasFailedChecks ? "FAILED" : hasPendingChecks ? "PENDING" : "SUCCESS"}\`\n`;
    text += `- Review Status: \`reviewDecision=${mainMergePr.reviewDecision || "NONE"}\`, comments=${mainMergePr.comments}\n`;
    text += `- Check live: \`gh pr checks ${mainMergePr.number} --watch\`\n`;

    if (hasFailedChecks) {
      const failedChecks = checks
        .filter((check) => isCiFailure(check.status, check.conclusion))
        .map((check) => check.name);
      text += `- Failed checks: ${failedChecks.join(", ")}\n`;
      text += `- Logs: \`gh run list --branch ${featureBranch} --event pull_request --limit 5\` and \`gh run view <run-id> --log-failed\`\n`;
      text += `- Only approve merge into \`${defaultBranch}\` after checks are green.\n`;
    } else if (hasPendingChecks) {
      text += `- Only approve merge into \`${defaultBranch}\` once all required checks are green.\n`;
    } else if (hasReviewBlockers) {
      text += `- Merge into \`${defaultBranch}\` is blocked until open reviews/comments are resolved.\n`;
    } else {
      text += `- ✅ Required checks are green. Main merge can be approved (verify reviews/comments).\n`;
    }

    if (hasReviewBlockers) {
      text += `- Review comments: \`gh pr view ${mainMergePr.number} --comments\`\n`;
      text += `- Inline reviews: \`gh api repos/{owner}/{repo}/pulls/${mainMergePr.number}/comments\`\n`;
    }

    return `${text}\n`;
  }
}
