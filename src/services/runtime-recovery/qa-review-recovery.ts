import type { ExecutionInvocationRecord } from "../../contracts/execution-types.js";
import type { ExecutionRepository } from "../../repositories/execution-repository.js";
import type { QaReviewRepository } from "../../repositories/qa-review-repository.js";
import { RECOVERED_STALE_QA_SUMMARY_PREFIX } from "../../domain/qa-review/qa-review-budget.js";
import { calculateInvocationDurationMs } from "./recovery-utils.js";
import type { DockerContainer } from "../../contracts/app-types.js";

const QA_RUN_START_TIMEOUT_MS = 60_000;

interface QaReviewRecoveryServiceDeps {
  executionRepository: ExecutionRepository;
  qaReviewRepository?: QaReviewRepository;
  dockerService?: {
    listContainers: () => Promise<DockerContainer[]>;
    removeContainers?: (containerIds: string[], options?: { removeVolumes?: boolean }) => Promise<void>;
  };
}

export class QaReviewRecoveryService {
  private providerContainerInventory: Promise<DockerContainer[]> | null = null;
  private readonly removedProviderContainerIds = new Set<string>();

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
          status: "cancelled",
          finishedAt: reconciledAt,
          errorMessage: null,
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
        if (providerInvocation.executionMode === "DOCKER") {
          await this.removeProviderContainer(providerInvocation.sessionId);
        }
        this.deps.executionRepository.updateProviderInvocationUsage(providerInvocation.id, {
          status: "cancelled",
          finishedAt: reconciledAt,
          durationMs: calculateInvocationDurationMs(providerInvocation, reconciledAt),
        });
      }

      this.deps.qaReviewRepository.updateRun(run.id, {
        status: "cancelled",
        summaryMarkdown: failureReason,
        payload: {
          ...run.payload,
          reviewNativeSessionId: providerInvocation?.nativeSessionId || run.payload?.reviewNativeSessionId,
          reviewOpenCodeBaselineRawUsageJson: providerInvocation?.rawUsageJson
            || run.payload?.reviewOpenCodeBaselineRawUsageJson,
        },
        finishedAt: reconciledAt,
      });
      reconciledRunIds.push(run.id);
    }

    return reconciledRunIds;
  }

  private async removeProviderContainer(sessionId: string): Promise<void> {
    if (!this.deps.dockerService?.removeContainers) {
      return;
    }
    this.providerContainerInventory ??= this.deps.dockerService.listContainers().catch(() => []);
    const containers = await this.providerContainerInventory;
    const containerIds = containers
      .filter((container) => container.labels?.["code-ux.session-id"]?.trim() === sessionId)
      .map((container) => container.id || container.names)
      .filter((containerId): containerId is string => (
        Boolean(containerId) && !this.removedProviderContainerIds.has(containerId as string)
      ));
    if (containerIds.length > 0) {
      await this.deps.dockerService.removeContainers(containerIds, { removeVolumes: false })
        .then(() => {
          for (const containerId of containerIds) {
            this.removedProviderContainerIds.add(containerId);
          }
        })
        .catch(() => undefined);
    }
  }

  private findLatestQaExecutionInvocation(run: ReturnType<QaReviewRepository["listRunningRuns"]>[number]): ExecutionInvocationRecord | null {
    const correlatedInvocationId = typeof run.payload?.reviewExecutionInvocationId === "string"
      ? run.payload.reviewExecutionInvocationId
      : null;
    if (correlatedInvocationId) {
      const correlatedInvocation = this.deps.executionRepository.getExecutionInvocation(correlatedInvocationId);
      if (correlatedInvocation?.type === "qa_review") {
        return correlatedInvocation;
      }
    }
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
      // Startup is a process boundary: a running review left without a backing
      // invocation cannot still be making progress in this runtime. Recover it
      // immediately instead of waiting the normal in-process start grace period.
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

    return `${RECOVERED_STALE_QA_SUMMARY_PREFIX} after the runtime process restarted. Code UX will continue the preserved review session.`;
  }
}
