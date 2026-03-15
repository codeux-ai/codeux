import type { GitCiRunStatus } from "../../../../contracts/app-types.js";
import { summarizeFailedRuns } from "../../../../sprint/ci-status-utils.js";

export function buildNoPrFoundText(taskId: string, featureBranch: string): string {
  let reportText = `⏳ **CI/Review Merge Gate:** Task \`${taskId}\` stays in progress because no open feature PR could be matched.\n`;
  reportText += `   - Expected: PR with base \`${featureBranch}\` and matching worker branch or task PR URL.\n`;
  return reportText;
}

export function buildAutoMergeSuccessText(taskId: string, prNumber: number, mode?: string): string {
  return `🤖 **Auto-Merged:** Task \`${taskId}\` was merged automatically (PR #${prNumber}${mode ? `, mode: ${mode}` : ""}).\n`;
}

export function buildAutoMergeScheduledText(taskId: string, prNumber: number, message: string, mode?: string): string {
  let text = `⏳ **Auto-Merge Armed:** Task \`${taskId}\` is still in progress because PR #${prNumber}${mode ? `, mode: ${mode}` : ""} has not merged into the feature branch yet.\n`;
  text += `   - ${message}\n`;
  text += `   - Check merge progress: \`gh pr view ${prNumber}\`\n`;
  return text;
}

export function buildAutoMergeFailedText(taskId: string, prNumber: number, message: string, mode?: string): string {
  let text = `⚠️ **Auto-Merge Failed:** Task \`${taskId}\` (PR #${prNumber}${mode ? `, mode: ${mode}` : ""}) - ${message}\n`;
  if (!mode) {
    text += `   - Manual check: \`gh pr merge ${prNumber} --merge --delete-branch\`\n`;
  }
  return text;
}

export function buildMergeConfirmedText(taskId: string, prNumber: number, featureBranch: string): string {
  return `✅ **Feature PR Merged:** Task \`${taskId}\` has been merged into \`${featureBranch}\` (PR #${prNumber}).\n`;
}

export function buildMergeReadyText(taskId: string, prNumber: number, featureBranch: string): string {
  return `✅ **Feature PR Ready:** Task \`${taskId}\` can be approved for merge into \`${featureBranch}\` (PR #${prNumber}).\n`;
}

export function buildInProgressText(
  taskId: string,
  prNumber: number,
  prUrl: string,
  branchName: string,
  ciStateLabel: string,
  header: string
): string {
  let reportText = `⏳ **${header}:** Task \`${taskId}\` stays in progress (PR #${prNumber}, branch \`${branchName}\`).\n`;
  reportText += `   - PR: ${prUrl}\n`;
  reportText += `   - CI Status: \`${ciStateLabel.toUpperCase()}\`\n`;
  reportText += `   - Check live: \`gh pr checks ${prNumber} --watch\`\n`;
  return reportText;
}

export function buildFailedChecksText(
  branchName: string,
  failedChecks: string[],
  failedRuns: GitCiRunStatus[],
  failedJobLabels: string[]
): string {
  let reportText = `   - Failed checks: ${failedChecks.join(", ")}\n`;
  if (failedRuns.length > 0) {
    reportText += `   - Failed runs: ${summarizeFailedRuns(failedRuns)}\n`;
    reportText += `   - Failed run URLs: ${failedRuns
      .map((run) => run.url)
      .filter((url) => url.length > 0)
      .join(", ")}\n`;
  }
  if (failedJobLabels.length > 0) {
    reportText += `   - Failed jobs: ${failedJobLabels.join(", ")}\n`;
  }
  reportText += `   - Logs: \`gh run list --branch ${branchName} --event pull_request --limit 5\` and then \`gh run view <run-id> --log-failed\`\n`;
  return reportText;
}

export function buildReviewBlockersText(prNumber: number, reviewDecision: string | null | undefined, comments: number): string {
  let reportText = `   - Review Blocker: \`reviewDecision=${reviewDecision || "NONE"}\`, comments=${comments}\n`;
  reportText += `   - Review comments: \`gh pr view ${prNumber} --comments\`\n`;
  reportText += `   - Inline reviews: \`gh api repos/{owner}/{repo}/pulls/${prNumber}/comments\`\n`;
  return reportText;
}
