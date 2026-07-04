import type { ExecutionRepository } from "../repositories/execution-repository.js";
import type { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import type { ActiveDispatchRegistry } from "./active-dispatch-registry.js";
import { runCommandStrict } from "./cli-process-runner.js";
import type { Logger } from "../shared/logging/logger.js";
import type { ExecutionInvocationRecord, ProviderInvocationUsageRecord } from "../contracts/execution-types.js";

export interface CancelExecutionInvocationResult {
  cancelled: boolean;
  invocationId: string;
  stoppedContainerIds: string[];
  message?: string;
}

interface ExecutionInvocationControlServiceDeps {
  executionRepository: ExecutionRepository;
  projectManagementRepository: ProjectManagementRepository;
  activeDispatchRegistry: ActiveDispatchRegistry;
  logger?: Logger;
}

const ACTIVE_INVOCATION_STATUSES = new Set(["running", "paused"]);
const CANCEL_MESSAGE = "Invocation cancelled from Chat -> Invocations.";

function calculateDurationMs(startedAt: string | null | undefined, finishedAt: string): number | null {
  if (!startedAt) {
    return null;
  }
  const startedAtMs = Date.parse(startedAt);
  const finishedAtMs = Date.parse(finishedAt);
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(finishedAtMs)) {
    return null;
  }
  return Math.max(0, finishedAtMs - startedAtMs);
}

export class ExecutionInvocationControlService {
  constructor(private readonly deps: ExecutionInvocationControlServiceDeps) {}

  async cancelInvocation(invocationId: string): Promise<CancelExecutionInvocationResult> {
    const invocation = this.deps.executionRepository.getExecutionInvocation(invocationId);
    if (!invocation) {
      throw new Error(`Execution invocation not found: ${invocationId}`);
    }

    if (!ACTIVE_INVOCATION_STATUSES.has(invocation.status)) {
      return {
        cancelled: false,
        invocationId,
        stoppedContainerIds: [],
        message: `Invocation is already ${invocation.status}.`,
      };
    }

    const providerInvocation = invocation.providerInvocationId
      ? this.deps.executionRepository.getProviderInvocationUsage(invocation.providerInvocationId)
      : null;

    await this.requestActiveDispatchStop(invocation);
    const stoppedContainerIds = await this.stopDockerContainers(invocation, providerInvocation);
    const finishedAt = new Date().toISOString();

    if (providerInvocation?.status === "running") {
      this.deps.executionRepository.updateProviderInvocationUsage(providerInvocation.id, {
        status: "cancelled",
        finishedAt,
        durationMs: calculateDurationMs(providerInvocation.startedAt, finishedAt) ?? undefined,
      });
    }

    this.closeTaskRuntimeForRetry(invocation, finishedAt);

    this.deps.executionRepository.updateExecutionInvocation(invocation.id, {
      status: "cancelled",
      finishedAt,
      errorMessage: CANCEL_MESSAGE,
    });
    this.deps.executionRepository.appendExecutionInvocationMessage(invocation.id, {
      role: "system",
      contentMarkdown: stoppedContainerIds.length > 0
        ? `${CANCEL_MESSAGE} Stopped Docker container${stoppedContainerIds.length === 1 ? "" : "s"} ${stoppedContainerIds.join(", ")}.`
        : CANCEL_MESSAGE,
      metadata: {
        cancellation: "dashboard_invocation_cancel",
        providerInvocationId: providerInvocation?.id ?? null,
        stoppedContainerIds,
      },
      createdAt: finishedAt,
    });

    return {
      cancelled: true,
      invocationId,
      stoppedContainerIds,
    };
  }

  private closeTaskRuntimeForRetry(invocation: ExecutionInvocationRecord, finishedAt: string): void {
    const taskRun = invocation.taskRunId
      ? this.deps.executionRepository.getTaskRun(invocation.taskRunId)
      : null;
    const dispatch = invocation.dispatchId
      ? this.deps.executionRepository.getTaskDispatch(invocation.dispatchId)
      : null;

    if (!taskRun && !dispatch) {
      return;
    }

    if (dispatch) {
      this.deps.executionRepository.releaseLease("task_dispatch", dispatch.id);
      this.deps.executionRepository.updateTaskDispatch(dispatch.id, {
        connectionId: null,
        status: "cancelled",
        finishedAt,
        lastHeartbeatAt: finishedAt,
        errorMessage: CANCEL_MESSAGE,
      });
    }

    if (taskRun) {
      this.deps.executionRepository.updateTaskRun(taskRun.id, {
        connectionId: null,
        state: "BLOCKED",
        finishedAt,
        durationMs: calculateDurationMs(taskRun.startedAt, finishedAt),
      });
      this.deps.executionRepository.appendTaskRunEvent(taskRun.id, "dispatch_cancelled", "user", {
        dispatchId: dispatch?.id ?? invocation.dispatchId ?? null,
        requestedBy: "dashboard",
        reason: CANCEL_MESSAGE,
        source: "invocation_cancel",
      }, {
        sourceEventKey: `dashboard-invocation-cancel:${invocation.id}`,
      });
    }

    const taskId = dispatch?.taskId || taskRun?.taskId || invocation.taskId;
    if (taskId) {
      this.deps.projectManagementRepository.updateTask(taskId, {
        status: "pending",
      });
    }
  }

  private async requestActiveDispatchStop(invocation: ExecutionInvocationRecord): Promise<void> {
    if (!invocation.dispatchId) {
      return;
    }
    const result = await this.deps.activeDispatchRegistry.requestStop(invocation.dispatchId, CANCEL_MESSAGE).catch((error: unknown) => {
      this.deps.logger?.warn("Failed to request active dispatch stop for invocation cancellation", {
        invocationId: invocation.id,
        dispatchId: invocation.dispatchId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    });
    if (result && !result.accepted) {
      this.deps.logger?.warn("Active dispatch stop was not accepted for invocation cancellation", {
        invocationId: invocation.id,
        dispatchId: invocation.dispatchId,
        message: result.message,
      });
    }
  }

  private async stopDockerContainers(
    invocation: ExecutionInvocationRecord,
    providerInvocation: ProviderInvocationUsageRecord | null,
  ): Promise<string[]> {
    const sessionIds = this.collectSessionIds(invocation, providerInvocation);
    const stoppedContainerIds: string[] = [];

    for (const sessionId of sessionIds) {
      const ps = await runCommandStrict("docker", [
        "ps",
        "--filter",
        `label=code-ux.session-id=${sessionId}`,
        "-q",
      ], process.cwd()).catch((error: unknown) => {
        this.deps.logger?.warn("Failed to inspect Docker containers for invocation cancellation", {
          invocationId: invocation.id,
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      });
      const containerIds = ps?.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean) ?? [];

      for (const containerId of containerIds) {
        await runCommandStrict("docker", ["kill", containerId], process.cwd());
        stoppedContainerIds.push(containerId);
      }
    }

    return stoppedContainerIds;
  }

  private collectSessionIds(
    invocation: ExecutionInvocationRecord,
    providerInvocation: ProviderInvocationUsageRecord | null,
  ): string[] {
    const sessionIds = new Set<string>();
    const providerSessionId = providerInvocation?.sessionId?.trim();
    if (providerSessionId) {
      sessionIds.add(providerSessionId);
    }

    if (invocation.taskRunId) {
      const taskRun = this.deps.executionRepository.getTaskRun(invocation.taskRunId);
      const taskRunSessionId = taskRun?.sessionId?.trim();
      if (taskRunSessionId) {
        sessionIds.add(taskRunSessionId);
      }
    }

    if (invocation.dispatchId) {
      const activeHandle = this.deps.activeDispatchRegistry.get(invocation.dispatchId);
      const activeSessionId = activeHandle?.sessionId?.trim();
      if (activeSessionId) {
        sessionIds.add(activeSessionId);
      }
    }

    return [...sessionIds];
  }
}
