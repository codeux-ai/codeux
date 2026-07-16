import type {
  AcquireExecutionLeaseInput,
  CreateSprintRunInput,
  ExecutionLeaseRecord,
  SprintRunRecord,
  SprintRunStatus,
  UpdateSprintRunInput,
} from "../contracts/execution-types.js";
import type { SprintStatus } from "../contracts/project-management-types.js";
import type { ExecutionRepository } from "../repositories/execution-repository.js";
import type { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import { acquireProjectGitHelper } from "../shared/subprocess/command-runner.js";

type ProjectGitHelperLeaseFactory = (repoPath: string) => () => Promise<void>;

export interface SprintRunLifecycleServiceDeps {
  executionRepository: Pick<
    ExecutionRepository,
    | "acquireLease"
    | "appendSprintRunEvent"
    | "createSprintRun"
    | "finalizeSprintRunCancellationIfIdle"
    | "getSprintRun"
    | "releaseLease"
    | "renewLease"
    | "updateSprintRun"
  >;
  projectManagementRepository: Pick<ProjectManagementRepository, "getProject" | "getRawSprintStatus" | "updateSprint">;
  acquireProjectGitHelper?: ProjectGitHelperLeaseFactory;
}

export interface SprintRunTransitionInput {
  sprintRunId: string;
  status: SprintRunStatus;
  eventType: string;
  eventPayload: Record<string, unknown>;
  sourceEventKey: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  lastHeartbeatAt?: string | null;
}

export function mapSprintRunStatusToSprintStatus(status: SprintRunStatus): SprintStatus {
  switch (status) {
    case "queued":
    case "running":
    case "cancel_requested":
      return "running";
    case "paused":
      return "paused";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
  }
}

export class SprintRunLifecycleService {
  private readonly projectGitHelperReleasesBySprintRunId = new Map<string, () => Promise<void>>();
  private readonly acquireProjectGitHelper: ProjectGitHelperLeaseFactory;

  constructor(private readonly deps: SprintRunLifecycleServiceDeps) {
    this.acquireProjectGitHelper = deps.acquireProjectGitHelper ?? acquireProjectGitHelper;
  }

  createRun(input: CreateSprintRunInput): SprintRunRecord {
    const sprintRun = this.deps.executionRepository.createSprintRun(input);
    this.syncSprintStatus(sprintRun.sprintId, sprintRun.status);
    this.syncProjectGitHelper(sprintRun);
    return sprintRun;
  }

  updateRun(sprintRunId: string, input: UpdateSprintRunInput): SprintRunRecord {
    const updated = this.deps.executionRepository.updateSprintRun(sprintRunId, input);
    if (input.status) {
      this.syncSprintStatus(updated.sprintId, updated.status);
      this.syncProjectGitHelper(updated);
    }
    return updated;
  }

  markRunning(sprintRunId: string, input: Omit<UpdateSprintRunInput, "status"> = {}): SprintRunRecord {
    return this.updateRun(sprintRunId, {
      ...input,
      status: "running",
      lastHeartbeatAt: input.lastHeartbeatAt ?? new Date().toISOString(),
    });
  }

  transition(input: SprintRunTransitionInput): SprintRunRecord {
    const now = new Date().toISOString();
    const isTerminal = input.status === "completed" || input.status === "failed" || input.status === "cancelled";
    const update: UpdateSprintRunInput = {
      status: input.status,
      lastHeartbeatAt: input.lastHeartbeatAt ?? now,
    };
    if (input.startedAt !== undefined) {
      update.startedAt = input.startedAt;
    }
    if (input.finishedAt !== undefined) {
      update.finishedAt = input.finishedAt;
    } else if (isTerminal) {
      update.finishedAt = now;
    }

    const updated = this.updateRun(input.sprintRunId, update);
    this.deps.executionRepository.appendSprintRunEvent(
      input.sprintRunId,
      input.eventType,
      "system",
      input.eventPayload,
      {
        sourceEventKey: input.sourceEventKey,
      },
    );
    return updated;
  }

  renewHeartbeat(args: { sprintRunId: string; sprintId: string; leaseToken?: string }): boolean {
    const latestRun = this.deps.executionRepository.getSprintRun(args.sprintRunId);
    if (
      latestRun?.status === "paused" ||
      latestRun?.status === "cancelled" ||
      latestRun?.status === "cancel_requested" ||
      latestRun?.status === "completed" ||
      latestRun?.status === "failed"
    ) {
      if (latestRun) {
        this.syncSprintStatus(latestRun.sprintId, latestRun.status);
        this.syncProjectGitHelper(latestRun);
      }
      return false;
    }

    const now = new Date().toISOString();
    if (args.leaseToken) {
      this.deps.executionRepository.renewLease({
        scopeType: "sprint",
        scopeId: args.sprintId,
        leaseToken: args.leaseToken,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      });
    }

    this.updateRun(args.sprintRunId, {
      status: "running",
      lastHeartbeatAt: now,
    });
    return true;
  }

  acquireSprintLease(input: Omit<AcquireExecutionLeaseInput, "scopeType">): ExecutionLeaseRecord {
    return this.deps.executionRepository.acquireLease({
      ...input,
      scopeType: "sprint",
    });
  }

  releaseSprintLease(sprintId: string, leaseToken?: string): void {
    this.deps.executionRepository.releaseLease("sprint", sprintId, leaseToken);
  }

  finalizeCancellationIfIdle(sprintRunId: string): SprintRunRecord | null {
    const updated = this.deps.executionRepository.finalizeSprintRunCancellationIfIdle(sprintRunId);
    if (updated) {
      this.syncSprintStatus(updated.sprintId, updated.status);
      this.syncProjectGitHelper(updated);
    }
    return updated;
  }

  syncSprintStatus(sprintId: string, runStatus: SprintRunStatus): void {
    const nextStatus = mapSprintRunStatusToSprintStatus(runStatus);
    if (this.deps.projectManagementRepository.getRawSprintStatus(sprintId) === nextStatus) {
      return;
    }
    this.deps.projectManagementRepository.updateSprint(sprintId, { status: nextStatus });
  }

  private syncProjectGitHelper(sprintRun: SprintRunRecord): void {
    if (isActiveSprintRunStatus(sprintRun.status)) {
      if (this.projectGitHelperReleasesBySprintRunId.has(sprintRun.id)) {
        return;
      }

      const repoPath = this.deps.projectManagementRepository.getProject(sprintRun.projectId)?.baseDir.trim();
      if (!repoPath) {
        return;
      }

      this.projectGitHelperReleasesBySprintRunId.set(
        sprintRun.id,
        this.acquireProjectGitHelper(repoPath),
      );
      return;
    }

    const release = this.projectGitHelperReleasesBySprintRunId.get(sprintRun.id);
    if (!release) {
      return;
    }

    this.projectGitHelperReleasesBySprintRunId.delete(sprintRun.id);
    void release().catch(() => undefined);
  }
}

function isActiveSprintRunStatus(status: SprintRunStatus): boolean {
  return status === "queued" || status === "running" || status === "cancel_requested";
}
