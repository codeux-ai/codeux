import type { Subtask } from "../../contracts/app-types.js";
import type { QaReviewRunRecord } from "../../repositories/qa-review-repository.js";

export function buildSprintQaSnapshot(subtasks: Subtask[]): string {
  return JSON.stringify(
    subtasks
      .map((task) => ({
        id: task.id,
        title: task.title || "",
        prompt: task.prompt || "",
        status: task.status || "",
        dependsOn: [...task.depends_on].sort(),
        isMerged: Boolean(task.is_merged),
        mergeIndicator: task.merge_indicator || "",
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  );
}

export function readSprintQaSnapshot(run: QaReviewRunRecord | null): string | null {
  const snapshot = run?.payload?.taskSnapshot;
  return typeof snapshot === "string" && snapshot.trim().length > 0 ? snapshot : null;
}

export interface EvaluateSprintQaReviewNeedArgs {
  latestRun: QaReviewRunRecord | null;
  latestTaskUpdatedAtMs: number;
  currentSubtasks: Subtask[];
  currentTaskSnapshot?: string;
  isRecoveredStaleRun: boolean;
}

export function shouldRunSprintQaReview(args: EvaluateSprintQaReviewNeedArgs): boolean {
  if (!args.latestRun) {
    return true;
  }

  const latestTaskSnapshot = readSprintQaSnapshot(args.latestRun);
  const currentTaskSnapshot = args.currentTaskSnapshot ?? buildSprintQaSnapshot(args.currentSubtasks);

  let hasMeaningfulChanges = false;
  if (latestTaskSnapshot) {
    hasMeaningfulChanges = latestTaskSnapshot !== currentTaskSnapshot;
  } else {
    const latestRunFinishedAtMs = args.latestRun.finishedAt ? Date.parse(args.latestRun.finishedAt) : Number.NaN;
    hasMeaningfulChanges = !Number.isFinite(latestRunFinishedAtMs) || args.latestTaskUpdatedAtMs > latestRunFinishedAtMs;
  }

  return hasMeaningfulChanges || args.isRecoveredStaleRun;
}
