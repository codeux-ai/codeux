import type { Subtask } from "../../../../contracts/app-types.js";
import { buildAutoMergeSuccessText, buildAutoMergeFailedText } from "./ci-notification-builder.js";
import type { SubtaskFileRepository } from "../../../../infrastructure/repositories/subtask-file-repository.js";

export async function attemptAutoMerge(args: {
  task: Subtask;
  prNumber: number;
  repoPath: string;
  subtasksDir: string;
  mode: "always" | "when_green";
  autoMergeFeaturePr: (args: { repoPath: string; prNumber: number }) => Promise<{ ok: boolean; message?: string }>;
  subtaskFileRepository: SubtaskFileRepository;
}): Promise<string> {
  const mergeResult = await args.autoMergeFeaturePr({
    repoPath: args.repoPath,
    prNumber: args.prNumber,
  });

  if (mergeResult.ok) {
    args.task.is_merged = true;
    args.task.merge_indicator = "AUTOMERGE";
    try {
      await args.subtaskFileRepository.setMerged(args.subtasksDir, args.task.id, true);
    } catch {
      // Keep runtime status update even if file persistence fails.
    }
    return buildAutoMergeSuccessText(args.task.id, args.prNumber, args.mode === "always" ? "always" : undefined);
  }

  return buildAutoMergeFailedText(args.task.id, args.prNumber, mergeResult.message || "unknown error", args.mode === "always" ? "always" : undefined);
}
