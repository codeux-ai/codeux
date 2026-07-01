import type { ExecutionInvocationRecord } from "../../contracts/execution-types.js";
import type { ExecutionRepository } from "../../repositories/execution-repository.js";
import type { QaReviewRepository } from "../../repositories/qa-review-repository.js";
import { RECOVERED_STALE_QA_SUMMARY_PREFIX } from "../../domain/qa-review/qa-review-budget.js";
import { calculateInvocationDurationMs } from "./recovery-utils.js";

const QA_RUN_START_TIMEOUT_MS = 60_000;

interface QaReviewRecoveryServiceDeps {
  executionRepository: ExecutionRepository;
  qaReviewRepository?: QaReviewRepository;
}

export class QaReviewRecoveryService {
  constructor(private readonly deps: QaReviewRecoveryServiceDeps) {}

  async reconcileInterruptedQaReviewRuns(activeContainerSessionIds: ReadonlySet<string>): Promise<string[]> {
    if (!this.deps.qaReviewRepository) {
      return [];
    }

    const runningRuns = this.deps.qaReviewRepository.listRunningRuns();
    if (runningRuns.length === 0) {
      return [];
    }

    const reconciledAt = new Date().toISOString();
    const reconciledRunIds: string[] = [];

    for (const run of runningRuns) {
      const latestInvocation = this.findLatestQaExecutionInvocation(run);
      const failureReason = this.resolveInterruptedQaRunReason(run, latestInvocation, activeContainerSessionIds);
      if (!failureReason) {
        continue;
      }

      if (latestInvocation && (latestInvocation.status === "running" || latestInvocation.status === "paused")) {
        this.deps.executionRepository.updateExecutionInvocation(latestInvocation.id, {
          status: "failed",
          finishedAt: reconciledAt,
          errorMessage: failureReason,
        });
        this.deps.executionRepository.appendExecutionInvocationMessage(latestInvocation.id, {
          role: "system",
          contentMarkdown: failureReason,
          metadata: {
            recovery: "startup_qa_review_reconcile",
            qaRunId: run.id,
          },
          createdAt: reconciledAt,
        });
      }

      const providerInvocation = latestInvocation?.providerInvocationId
        ? this.deps.executionRepository.getProviderInvocationUsage(latestInvocation.providerInvocationId)
        : null;
      if (providerInvocation?.status === "running") {
        this.deps.executionRepository.updateProviderInvocationUsage(providerInvocation.id, {
          status: "failed",
          finishedAt: reconciledAt,
          durationMs: calculateInvocationDurationMs(providerInvocation, reconciledAt),
        });
      }

      this.deps.qaReviewRepository.updateRun(run.id, {
        status: "failed",
        summaryMarkdown: failureReason,
        finishedAt: reconciledAt,
      });
      reconciledRunIds.push(run.id);
    }

    return reconciledRunIds;
  }

  private findLatestQaExecutionInvocation(run: ReturnType<QaReviewRepository["listRunningRuns"]>[number]): ExecutionInvocationRecord | null {
    const invocations = run.taskRunId
      ? this.deps.executionRepository.listExecutionInvocations({
          projectId: run.projectId,
          taskRunId: run.taskRunId,
          limit: 20,
        })
      : run.sprintRunId
        ? this.deps.executionRepository.listExecutionInvocations({
            projectId: run.projectId,
            sprintRunId: run.sprintRunId,
            limit: 20,
          })
        : [];

    return invocations.find((invocation) => (
      invocation.type === "qa_review"
      && Date.parse(invocation.startedAt) >= Date.parse(run.startedAt)
    )) || null;
  }

  private resolveInterruptedQaRunReason(
    run: ReturnType<QaReviewRepository["listRunningRuns"]>[number],
    invocation: ExecutionInvocationRecord | null,
    activeContainerSessionIds: ReadonlySet<string>,
  ): string | null {
    const referenceAt = Date.parse(invocation?.lastMessageAt || invocation?.startedAt || run.startedAt);
    const ageMs = Number.isFinite(referenceAt) ? Date.now() - referenceAt : 0;

    if (!invocation) {
      if (ageMs < QA_RUN_START_TIMEOUT_MS) {
        return null;
      }
      return `${RECOVERED_STALE_QA_SUMMARY_PREFIX} that never started its backing invocation. Code UX will retry the review.`;
    }

    if (invocation.status !== "running" && invocation.status !== "paused") {
      return `${RECOVERED_STALE_QA_SUMMARY_PREFIX} after the backing invocation ${invocation.status}. Code UX will retry the review.`;
    }

    if (!invocation.providerInvocationId) {
      if (ageMs < QA_RUN_START_TIMEOUT_MS) {
        return null;
      }
      return `${RECOVERED_STALE_QA_SUMMARY_PREFIX} after the backing invocation stayed running without provider runtime linkage. Code UX will retry the review.`;
    }

    const providerInvocation = this.deps.executionRepository.getProviderInvocationUsage(invocation.providerInvocationId);
    if (!providerInvocation) {
      if (ageMs < QA_RUN_START_TIMEOUT_MS) {
        return null;
      }
      return `${RECOVERED_STALE_QA_SUMMARY_PREFIX} after the backing provider invocation disappeared. Code UX will retry the review.`;
    }

    if (providerInvocation.status !== "running") {
      return `${RECOVERED_STALE_QA_SUMMARY_PREFIX} after the backing provider invocation ${providerInvocation.status}. Code UX will retry the review.`;
    }

    if (
      providerInvocation.executionMode === "DOCKER"
      && !activeContainerSessionIds.has(providerInvocation.sessionId)
    ) {
      return `${RECOVERED_STALE_QA_SUMMARY_PREFIX} after its Docker container disappeared for session ${providerInvocation.sessionId}. Code UX will retry the review.`;
    }

    return null;
  }
}
