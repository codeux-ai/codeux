import type { GitTrackingStatus, Subtask } from "../../../../contracts/app-types.js";

export function matchPrForTask(
  task: Subtask,
  gitStatus: GitTrackingStatus
): (typeof gitStatus.openPullRequests)[number] | undefined {
  const prByHeadBranch = new Map<string, (typeof gitStatus.openPullRequests)[number]>();
  const prByUrl = new Map<string, (typeof gitStatus.openPullRequests)[number]>();

  for (const pr of gitStatus.openPullRequests) {
    if (pr.headRefName) {
      prByHeadBranch.set(pr.headRefName, pr);
    }
    if (typeof pr.url === "string" && pr.url.trim().length > 0) {
      prByUrl.set(pr.url.trim(), pr);
    }
  }

  const workerBranch = typeof task.worker_branch === "string" ? task.worker_branch : null;
  const taskPrUrl = typeof task.pr_url === "string" ? task.pr_url.trim() : "";

  return (
    (workerBranch ? prByHeadBranch.get(workerBranch) : undefined) ||
    (taskPrUrl ? prByUrl.get(taskPrUrl) : undefined)
  );
}
