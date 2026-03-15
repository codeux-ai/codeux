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

export interface MergeFeedbackResult {
  text: string;
  state:
    | "disabled"
    | "unavailable"
    | "missing_pr"
    | "merge_conflict"
    | "failed_checks"
    | "pending_checks"
    | "review_blocked"
    | "ready_for_merge";
  prNumber: number | null;
  prUrl: string | null;
  hasMergeConflict: boolean;
  mergeStateStatus: string | null;
  hasFailedChecks: boolean;
  hasPendingChecks: boolean;
  hasReviewBlockers: boolean;
  failedChecks: string[];
}

/**
 * Service for rendering feedback about the main merge CI gate.
 */
export class MainMergeGateService {
  public static evaluateMergeFeedback(context: MergeFeedbackContext): MergeFeedbackResult {
    const {
      featureBranch,
      defaultBranch,
      ciIntelligence,
      githubMode,
      gitStatus,
    } = context;

    if (
      !ciIntelligence.enabled
      || !ciIntelligence.enableLivePrMonitoring
      || !ciIntelligence.waitForCiBeforeMainMerge
      || githubMode !== "REMOTE"
    ) {
      return {
        text: "",
        state: "disabled",
        prNumber: null,
        prUrl: null,
        hasMergeConflict: false,
        mergeStateStatus: null,
        hasFailedChecks: false,
        hasPendingChecks: false,
        hasReviewBlockers: false,
        failedChecks: [],
      };
    }

    if (!gitStatus || !gitStatus.available) {
      return {
        text: "",
        state: "unavailable",
        prNumber: null,
        prUrl: null,
        hasMergeConflict: false,
        mergeStateStatus: null,
        hasFailedChecks: false,
        hasPendingChecks: false,
        hasReviewBlockers: false,
        failedChecks: [],
      };
    }

    const mainMergePr = gitStatus.openPullRequests.find(
      (pr) => pr.baseRefName === defaultBranch && pr.headRefName === featureBranch
    );

    if (!mainMergePr) {
      return {
        text: `\nℹ️ **Main CI Gate:** No open PR \`${featureBranch} -> ${defaultBranch}\` found. Create the PR and wait for CI.\n`,
        state: "missing_pr",
        prNumber: null,
        prUrl: null,
        hasMergeConflict: false,
        mergeStateStatus: null,
        hasFailedChecks: false,
        hasPendingChecks: false,
        hasReviewBlockers: false,
        failedChecks: [],
      };
    }

    const checks = Array.isArray(mainMergePr.checks) ? mainMergePr.checks : [];
    const failedChecks = checks
      .filter((check) => isCiFailure(check.status, check.conclusion))
      .map((check) => check.name);
    const hasMergeConflict = mainMergePr.mergeStateStatus === "DIRTY";
    const hasFailedChecks = failedChecks.length > 0;
    const hasPendingChecks = checks.length === 0 || checks.some((check) => isCiPending(check.status, check.conclusion));
    const hasReviewBlockers = mainMergePr.reviewDecision === "CHANGES_REQUESTED" || mainMergePr.comments > 0;

    let text = `\n### Main Merge CI Gate\n`;
    text += `- PR: ${mainMergePr.url}\n`;
    text += `- Check Status: \`${hasMergeConflict ? "DIRTY" : hasFailedChecks ? "FAILED" : hasPendingChecks ? "PENDING" : "SUCCESS"}\`\n`;
    text += `- Review Status: \`reviewDecision=${mainMergePr.reviewDecision || "NONE"}\`, comments=${mainMergePr.comments}\n`;
    text += `- Check live: \`gh pr checks ${mainMergePr.number} --watch\`\n`;
    if (mainMergePr.mergeStateStatus) {
      text += `- Merge State: \`${mainMergePr.mergeStateStatus}\`\n`;
    }

    let state: MergeFeedbackResult["state"] = "ready_for_merge";
    if (hasMergeConflict) {
      text += `- Merge into \`${defaultBranch}\` is blocked until the conflict is resolved.\n`;
      state = "merge_conflict";
    } else if (hasFailedChecks) {
      text += `- Failed checks: ${failedChecks.join(", ")}\n`;
      text += `- Logs: \`gh run list --branch ${featureBranch} --event pull_request --limit 5\` and \`gh run view <run-id> --log-failed\`\n`;
      text += `- Only approve merge into \`${defaultBranch}\` after checks are green.\n`;
      state = "failed_checks";
    } else if (hasPendingChecks) {
      text += `- Only approve merge into \`${defaultBranch}\` once all required checks are green.\n`;
      state = "pending_checks";
    } else if (hasReviewBlockers) {
      text += `- Merge into \`${defaultBranch}\` is blocked until open reviews/comments are resolved.\n`;
      state = "review_blocked";
    } else {
      text += `- ✅ Required checks are green. Main merge can be approved (verify reviews/comments).\n`;
    }

    if (hasReviewBlockers) {
      text += `- Review comments: \`gh pr view ${mainMergePr.number} --comments\`\n`;
      text += `- Inline reviews: \`gh api repos/{owner}/{repo}/pulls/${mainMergePr.number}/comments\`\n`;
    }

    return {
      text: `${text}\n`,
      state,
      prNumber: mainMergePr.number,
      prUrl: mainMergePr.url,
      hasMergeConflict,
      mergeStateStatus: mainMergePr.mergeStateStatus || null,
      hasFailedChecks,
      hasPendingChecks,
      hasReviewBlockers,
      failedChecks,
    };
  }

  /**
   * Renders a feedback report for the main merge PR status.
   */
  public static async renderMergeFeedback(context: MergeFeedbackContext): Promise<string> {
    return this.evaluateMergeFeedback(context).text;
  }
}
