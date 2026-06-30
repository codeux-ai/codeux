import { findRecoverableWorkerBranch } from "../../infrastructure/git/local-merge.js";
import { buildWorkerBranchPrefix } from "../../services/cli-workflow-utils.js";
import type { Subtask } from "../../contracts/app-types.js";
import type { TaskRunRecord } from "../../contracts/execution-types.js";
import type { ProviderId } from "../../contracts/app-types.js";

export interface ResolveReviewBranchArgs {
  task: Subtask;
  taskRun: TaskRunRecord | null;
  repoPath: string;
  featureBranch: string;
  githubMode: "REMOTE" | "LOCAL";
}

export interface ResolveReviewBranchResult {
  reviewBranch: string;
  recoveredWorkerBranch: string | null;
}

export async function resolveReviewBranch(
  args: ResolveReviewBranchArgs,
  deps: {
    findRecoverableWorkerBranch: typeof findRecoverableWorkerBranch;
    logger?: { info?: (msg: string) => void; warn?: (msg: string) => void };
  }
): Promise<ResolveReviewBranchResult> {
  const direct = args.task.worker_branch?.trim() || args.taskRun?.workerBranch?.trim();
  if (direct) {
    return { reviewBranch: direct, recoveredWorkerBranch: null };
  }

  if (args.githubMode === "LOCAL") {
    const provider = (args.task.provider || args.taskRun?.provider || undefined) as ProviderId | undefined;
    if (args.featureBranch && args.task.id && provider) {
      try {
        const recovered = await deps.findRecoverableWorkerBranch({
          repoPath: args.repoPath,
          featureBranch: args.featureBranch,
          branchPrefix: buildWorkerBranchPrefix(args.featureBranch, args.task.id, provider),
        });
        if (recovered) {
          deps.logger?.info?.(
            `LOCAL Mode: Recovered worker branch ${recovered} for QA review of task ${args.task.id} from local refs.`
          );
          return { reviewBranch: recovered, recoveredWorkerBranch: recovered };
        }
      } catch (err) {
        deps.logger?.warn?.(`Failed to recover worker branch for QA review of task ${args.task.id}: ${err}`);
      }
    }
  }

  return { reviewBranch: args.featureBranch, recoveredWorkerBranch: null };
}
