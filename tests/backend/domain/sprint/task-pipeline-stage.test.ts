import { describe, expect, it } from "vitest";
import type { Subtask } from "../../../../src/contracts/app-types.js";
import {
  resolveTaskPipelineStage,
  taskHasMergeEvidence,
  isCompletedTaskSettled,
  isCompletedTaskAwaitingMerge,
  evaluatePreCiGateTransition,
  type TaskStageObservation,
  type TaskStageEnvironment,
} from "../../../../src/domain/sprint/task-pipeline-stage.js";

type TaskShape = Pick<Subtask, "status" | "is_merged" | "merge_indicator" | "worker_branch" | "pr_url">;

/** Builds a snake_case Subtask-shaped object for the wrapper helpers. */
const task = (over: Partial<TaskShape>): TaskShape => ({
  status: "CODING_COMPLETED",
  is_merged: false,
  merge_indicator: undefined,
  worker_branch: undefined,
  pr_url: undefined,
  ...over,
});

/** Converts the Subtask-shaped object into the resolver's observation shape. */
const obs = (over: Partial<TaskShape>): TaskStageObservation => {
  const t = task(over);
  return {
    status: t.status,
    isMerged: Boolean(t.is_merged),
    mergeIndicator: t.merge_indicator,
    workerBranch: t.worker_branch,
    prUrl: t.pr_url,
  };
};

describe("task pipeline stage resolver", () => {
  describe("evidence", () => {
    it("counts a worker branch or PR as evidence, and nothing else", () => {
      expect(taskHasMergeEvidence({ worker_branch: "b", pr_url: undefined })).toBe(true);
      expect(taskHasMergeEvidence({ worker_branch: undefined, pr_url: "u" })).toBe(true);
      expect(taskHasMergeEvidence({ worker_branch: "   ", pr_url: "  " })).toBe(false);
      expect(taskHasMergeEvidence({ worker_branch: undefined, pr_url: undefined })).toBe(false);
    });

    it("does not treat 'execution completed with no PR' as a reason to drop a real branch", () => {
      // Regression: the old REMOTE shortcut returned false here and force-settled
      // the task as complete, ignoring the pushed branch.
      const env: TaskStageEnvironment = { githubMode: "REMOTE", isExecutionCompleted: true, hasPr: false };
      expect(taskHasMergeEvidence({ worker_branch: "task/x", pr_url: undefined }, env)).toBe(true);
    });
  });

  describe("coding stage clears stale merge state", () => {
    for (const status of ["RUNNING", "PENDING"] as const) {
      it(`a ${status} task is CODING with no indicator / not merged even if stale state lingers`, () => {
        const result = resolveTaskPipelineStage(
          obs({ status, merge_indicator: "CI", is_merged: true, worker_branch: "task/x" }),
        );
        expect(result.stage).toBe("CODING");
        expect(result.mergeIndicator).toBeUndefined();
        expect(result.isMerged).toBe(false);
      });
    }
  });

  describe("nothing to merge settles honestly (no fabricated MERGED)", () => {
    it("a coding-complete task with no evidence becomes COMPLETED with no indicator", () => {
      const result = resolveTaskPipelineStage(obs({ status: "CODING_COMPLETED" }), { githubMode: "REMOTE" });
      expect(result.stage).toBe("COMPLETED");
      expect(result.status).toBe("COMPLETED");
      expect(result.mergeIndicator).toBeUndefined();
      expect(result.isMerged).toBe(false);
      expect(isCompletedTaskSettled(task({ status: "CODING_COMPLETED" }))).toBe(true);
    });
  });

  describe("post-coding pipeline with evidence", () => {
    it("a code-complete task with an unmerged branch awaits merge (MERGE stage)", () => {
      const t = task({ status: "CODING_COMPLETED", worker_branch: "task/x", pr_url: "u" });
      const result = resolveTaskPipelineStage(obs(t), { githubMode: "REMOTE" });
      expect(result.stage).toBe("MERGE");
      expect(result.status).toBe("CODING_COMPLETED");
      expect(isCompletedTaskAwaitingMerge(t)).toBe(true);
      expect(isCompletedTaskSettled(t)).toBe(false);
    });

    it("a falsely-COMPLETED task with unmerged evidence is demoted to CODING_COMPLETED", () => {
      const result = resolveTaskPipelineStage(
        obs({ status: "COMPLETED", merge_indicator: "CI", worker_branch: "task/x" }),
      );
      expect(result.status).toBe("CODING_COMPLETED");
      expect(result.stage).toBe("CI");
    });

    it("a merged task is COMPLETED and normalized to MERGED", () => {
      const result = resolveTaskPipelineStage(
        obs({ status: "CODING_COMPLETED", is_merged: true, merge_indicator: "CI", worker_branch: "task/x", pr_url: "u" }),
      );
      expect(result.stage).toBe("COMPLETED");
      expect(result.status).toBe("COMPLETED");
      expect(result.mergeIndicator).toBe("MERGED");
    });

    it("an AUTOMERGE task stays AUTOMERGE and is settled", () => {
      const t = task({ status: "COMPLETED", is_merged: true, merge_indicator: "AUTOMERGE", worker_branch: "task/x", pr_url: "u" });
      const result = resolveTaskPipelineStage(obs(t));
      expect(result.mergeIndicator).toBe("AUTOMERGE");
      expect(isCompletedTaskSettled(t)).toBe(true);
    });

    it("a PR_ONLY task is settled (terminal)", () => {
      const t = task({ status: "COMPLETED", merge_indicator: "PR_ONLY", worker_branch: "task/x", pr_url: "u" });
      expect(isCompletedTaskSettled(t)).toBe(true);
      expect(isCompletedTaskAwaitingMerge(t)).toBe(false);
    });

    it("a MERGE_CONFLICT task is in the conflict stage, awaiting resolution", () => {
      const t = task({ status: "CODING_COMPLETED", merge_indicator: "MERGE_CONFLICT", worker_branch: "task/x", pr_url: "u" });
      const result = resolveTaskPipelineStage(obs(t));
      expect(result.stage).toBe("MERGE_CONFLICT");
      expect(result.mergeIndicator).toBe("MERGE_CONFLICT");
      expect(isCompletedTaskAwaitingMerge(t)).toBe(true);
    });
  });

  describe("QA stage gating", () => {
    it("blocks merge in the QA stage when the gate denies it", () => {
      const result = resolveTaskPipelineStage(
        obs({ status: "CODING_COMPLETED", worker_branch: "task/x", pr_url: "u" }),
        { qaMergeAllowed: false },
      );
      expect(result.stage).toBe("QA");
      expect(result.mergeIndicator).toBe("QA_PENDING");
      expect(result.status).toBe("CODING_COMPLETED");
    });

    it("skips the QA stage entirely when QA is not blocking (disabled / passed)", () => {
      const result = resolveTaskPipelineStage(
        obs({ status: "CODING_COMPLETED", worker_branch: "task/x", pr_url: "u" }),
        { qaMergeAllowed: true },
      );
      expect(result.stage).toBe("MERGE");
      expect(result.mergeIndicator).not.toBe("QA_PENDING");
    });

    it("treats a resting QA_PENDING indicator as not settled without a fresh gate result", () => {
      const t = task({ status: "CODING_COMPLETED", merge_indicator: "QA_PENDING", worker_branch: "task/x", pr_url: "u" });
      expect(isCompletedTaskSettled(t)).toBe(false);
      expect(isCompletedTaskAwaitingMerge(t)).toBe(false); // QA wait excluded from merge-awaiting
      expect(resolveTaskPipelineStage(obs(t)).stage).toBe("QA");
    });
  });

  describe("off-ramps", () => {
    it("passes through FAILED / QUOTA / BLOCKED", () => {
      expect(resolveTaskPipelineStage(obs({ status: "FAILED" })).stage).toBe("FAILED");
      expect(resolveTaskPipelineStage(obs({ status: "QUOTA" })).stage).toBe("QUOTA");
      expect(resolveTaskPipelineStage(obs({ status: "BLOCKED" })).stage).toBe("BLOCKED");
    });
  });

  describe("evaluatePreCiGateTransition parity", () => {
    it("clears the indicator and intervention for a no-evidence completed task", () => {
      const transition = evaluatePreCiGateTransition({
        status: "COMPLETED",
        is_merged: false,
        merge_indicator: "CI",
        worker_branch: undefined,
        pr_url: undefined,
        intervention_owner: "AGENT",
        intervention_hint: "waiting",
      });
      expect(transition.status).toBe("COMPLETED");
      expect(transition.merge_indicator).toBeUndefined();
      expect(transition.intervention_owner).toBeUndefined();
      expect(transition.intervention_hint).toBeUndefined();
    });

    it("demotes a completed-with-evidence task back to CODING_COMPLETED", () => {
      const transition = evaluatePreCiGateTransition({
        status: "COMPLETED",
        is_merged: false,
        merge_indicator: "CI",
        worker_branch: "worker/task-3",
        pr_url: undefined,
        intervention_owner: "AGENT",
        intervention_hint: "fix",
      });
      expect(transition.status).toBe("CODING_COMPLETED");
      expect(transition.merge_indicator).toBe("CI");
      expect(transition.intervention_owner).toBeUndefined();
    });
  });
});
