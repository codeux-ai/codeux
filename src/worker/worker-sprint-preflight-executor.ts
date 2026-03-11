import { ensureSprintBranchReady } from "../sprint/steps/branch-preflight-step.js";
import type { WorkerSprintPreflightClaim } from "../contracts/execution-types.js";

export interface WorkerSprintPreflightExecutionResult {
  summaryMarkdown: string;
}

export async function executeWorkerSprintPreflight(
  claim: WorkerSprintPreflightClaim,
): Promise<WorkerSprintPreflightExecutionResult> {
  const result = await ensureSprintBranchReady(
    claim.executionContext.repoPath,
    claim.executionContext.featureBranch,
    claim.executionContext.defaultBranch,
  );

  return {
    summaryMarkdown: [
      `Project: ${claim.project.name}`,
      `Sprint: ${claim.sprint.name}`,
      `Repo: ${claim.executionContext.repoPath}`,
      `Feature branch: ${claim.executionContext.featureBranch}`,
      `Default branch: ${claim.executionContext.defaultBranch}`,
      `Action: ${result.action}`,
      result.summary,
    ].join("\n"),
  };
}
