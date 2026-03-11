import { randomUUID } from "crypto";
import { formatSprintBranch } from "../git/sprint-branch-scheme.js";
import type { DashboardSettings } from "../contracts/app-types.js";
import type { WorkerSprintPreflightClaim } from "../contracts/execution-types.js";
import type { McpConnectionRecord } from "../contracts/connection-chat-types.js";
import type { SprintAgentArgs } from "../sprint/sprint-types.js";
import type { SprintOrchestrator } from "../sprint/sprint-orchestrator.js";
import { ExecutionRepository } from "../repositories/execution-repository.js";
import { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import { ConnectionChatRepository } from "../repositories/connection-chat-repository.js";
import type { Logger } from "../shared/logging/logger.js";

export interface PullWorkerSprintPreflightArgs {
  connectionKey: string;
  projectId?: string;
  sprintId?: string;
}

export interface UpdateWorkerSprintPreflightArgs {
  connectionKey: string;
  jobId: string;
  leaseToken: string;
  state: "RUNNING" | "COMPLETED" | "FAILED" | "BLOCKED";
  summaryMarkdown?: string;
  errorMessage?: string;
}

export interface UpdateWorkerSprintPreflightResult {
  job: WorkerSprintPreflightClaim["job"];
  controlAction: "cancel" | null;
}

export class WorkerSprintPreflightService {
  constructor(
    private readonly executionRepository: ExecutionRepository,
    private readonly projectManagementRepository: ProjectManagementRepository,
    private readonly connectionChatRepository: ConnectionChatRepository,
    private readonly sprintOrchestrator: SprintOrchestrator,
    private readonly getDashboardSettings: () => DashboardSettings,
    private readonly logger?: Logger,
  ) {}

  pullNextJob(args: PullWorkerSprintPreflightArgs): WorkerSprintPreflightClaim | null {
    const connection = this.requireWorkerConnection(args.connectionKey);
    const projectIds = this.resolveProjectIds(connection, args.projectId);

    for (const projectId of projectIds) {
      const claimed = this.executionRepository.claimNextSprintPreflightJob({
        projectId,
        sprintId: args.sprintId,
        connectionId: connection.id,
      });
      if (!claimed) {
        continue;
      }

      const now = new Date().toISOString();
      const leaseToken = randomUUID();
      this.executionRepository.acquireLease({
        scopeType: "sprint_preflight_job",
        scopeId: claimed.id,
        ownerKey: connection.connectionKey,
        leaseToken,
        expiresAt: this.createLeaseExpiry(),
      });

      const job = this.executionRepository.updateSprintPreflightJob(claimed.id, {
        connectionId: connection.id,
        status: "running",
        startedAt: claimed.startedAt || now,
        lastHeartbeatAt: now,
      });

      const project = this.requireProject(job.projectId);
      const sprint = this.requireSprint(job.sprintId);
      const featureBranch = sprint.featureBranch?.trim()
        || (typeof sprint.number === "number"
          ? formatSprintBranch(this.getDashboardSettings().git.sprintBranchScheme, sprint.number)
          : `${this.getDashboardSettings().git.featureBranchPrefix}sprint-${sprint.id.slice(0, 8)}`);
      const defaultBranch = project.defaultBranch?.trim() || this.getDashboardSettings().git.defaultBranch || "main";
      const repoPath = project.baseDir;

      this.executionRepository.appendSprintRunEvent(job.sprintRunId, "sprint_preflight_claimed", "connection", {
        jobId: job.id,
        connectionId: connection.id,
        connectionKey: connection.connectionKey,
        jobType: job.jobType,
      }, {
        sourceEventKey: `sprint-preflight-claimed:${job.id}`,
      });
      this.connectionChatRepository.touchConnectionHeartbeat(connection.id, "connected");
      this.logger?.info("Worker claimed sprint preflight job", {
        connectionKey: connection.connectionKey,
        jobId: job.id,
        projectId: project.id,
        sprintId: sprint.id,
        sprintRunId: job.sprintRunId,
      });

      return {
        job,
        leaseToken,
        project: {
          id: project.id,
          name: project.name,
          baseDir: project.baseDir,
          sourceType: project.sourceType,
          sourceRef: project.sourceRef,
          defaultBranch: project.defaultBranch,
          featureBranchPrefix: project.featureBranchPrefix,
        },
        sprint: {
          id: sprint.id,
          name: sprint.name,
          number: sprint.number,
          goal: sprint.goal,
          featureBranch: sprint.featureBranch,
        },
        executionContext: {
          repoPath,
          defaultBranch,
          featureBranch,
        },
      };
    }

    this.connectionChatRepository.touchConnectionHeartbeat(connection.id, "listening");
    return null;
  }

  updateJob(args: UpdateWorkerSprintPreflightArgs): UpdateWorkerSprintPreflightResult {
    const connection = this.requireWorkerConnection(args.connectionKey);
    const job = this.requireJob(args.jobId);
    const lease = this.executionRepository.getLease("sprint_preflight_job", job.id);

    if (!lease || lease.leaseToken !== args.leaseToken) {
      throw new Error(`Worker lease is not active for sprint preflight job ${job.id}`);
    }
    if (job.connectionId && job.connectionId !== connection.id) {
      throw new Error(`Sprint preflight job ${job.id} is assigned to another connection.`);
    }

    const now = new Date().toISOString();
    const cancelRequested = job.status === "cancel_requested";
    const nextJob = this.executionRepository.updateSprintPreflightJob(job.id, {
      connectionId: connection.id,
      status: this.mapStateToJobStatus(args.state, cancelRequested),
      startedAt: job.startedAt || now,
      finishedAt: args.state === "RUNNING" ? job.finishedAt : now,
      lastHeartbeatAt: now,
      errorMessage: args.errorMessage === undefined ? job.errorMessage : args.errorMessage,
    });

    this.executionRepository.appendSprintRunEvent(job.sprintRunId, this.mapStateToEventType(args.state, cancelRequested), "connection", {
      jobId: job.id,
      connectionId: connection.id,
      connectionKey: connection.connectionKey,
      summaryMarkdown: args.summaryMarkdown ?? null,
      errorMessage: args.errorMessage ?? null,
      jobType: job.jobType,
    }, {
      sourceEventKey: `sprint-preflight-update:${job.id}:${cancelRequested ? "cancel" : args.state.toLowerCase()}`,
    });

    if (args.state === "RUNNING") {
      this.executionRepository.renewLease({
        scopeType: "sprint_preflight_job",
        scopeId: job.id,
        leaseToken: args.leaseToken,
        expiresAt: this.createLeaseExpiry(),
      });
      this.connectionChatRepository.touchConnectionHeartbeat(connection.id, "connected");
      return {
        job: nextJob,
        controlAction: cancelRequested ? "cancel" : null,
      };
    }

    this.executionRepository.releaseLease("sprint_preflight_job", job.id, args.leaseToken);
    this.connectionChatRepository.touchConnectionHeartbeat(connection.id, "listening");

    if (cancelRequested) {
      this.executionRepository.finalizeSprintRunCancellationIfIdle(job.sprintRunId);
      return {
        job: nextJob,
        controlAction: null,
      };
    }

    if (args.state === "COMPLETED") {
      this.resumeQueuedSprintRun(job.sprintRunId);
      return {
        job: nextJob,
        controlAction: null,
      };
    }

    const sprintRun = this.executionRepository.getSprintRun(job.sprintRunId);
    if (sprintRun) {
      const terminalStatus = args.state === "FAILED" ? "failed" : "paused";
      this.executionRepository.updateSprintRun(sprintRun.id, {
        status: terminalStatus,
        startedAt: sprintRun.startedAt || now,
        finishedAt: now,
        lastHeartbeatAt: now,
      });
    }

    return {
      job: nextJob,
      controlAction: null,
    };
  }

  private resumeQueuedSprintRun(sprintRunId: string): void {
    const sprintRun = this.executionRepository.getSprintRun(sprintRunId);
    if (!sprintRun) {
      throw new Error(`Sprint run not found for sprint preflight completion: ${sprintRunId}`);
    }

    const orchestrateArgs: SprintAgentArgs = {
      action: "orchestrate",
      project_id: sprintRun.projectId,
      sprint_id: sprintRun.sprintId,
      wait: true,
      existing_sprint_run_id: sprintRun.id,
      skip_branch_preflight: true,
    };

    void this.sprintOrchestrator.execute(orchestrateArgs).catch((error) => {
      this.logger?.error("Failed to resume sprint after worker preflight completion", {
        sprintRunId,
        projectId: sprintRun.projectId,
        sprintId: sprintRun.sprintId,
        error: error instanceof Error ? error.message : String(error),
      });
      const now = new Date().toISOString();
      this.executionRepository.updateSprintRun(sprintRun.id, {
        status: "failed",
        startedAt: sprintRun.startedAt || now,
        finishedAt: now,
        lastHeartbeatAt: now,
      });
      this.executionRepository.appendSprintRunEvent(sprintRun.id, "sprint_preflight_resume_failed", "system", {
        errorMessage: error instanceof Error ? error.message : String(error),
      }, {
        sourceEventKey: `sprint-preflight-resume-failed:${sprintRun.id}`,
      });
    });
  }

  private requireWorkerConnection(connectionKey: string): McpConnectionRecord {
    const connection = this.connectionChatRepository.getConnectionByKey(connectionKey);
    if (!connection) {
      throw new Error(`Connection not found for key: ${connectionKey}`);
    }
    if (connection.role !== "worker") {
      throw new Error(`Connection ${connectionKey} is not registered as a worker.`);
    }
    return connection;
  }

  private resolveProjectIds(connection: McpConnectionRecord, requestedProjectId?: string): string[] {
    if (requestedProjectId) {
      const projectId = requestedProjectId.trim();
      if (!projectId) {
        throw new Error("Project id cannot be blank.");
      }
      if (!connection.projectIds.includes(projectId)) {
        throw new Error(`Connection ${connection.connectionKey} is not bound to project ${projectId}`);
      }
      return [projectId];
    }

    const projectIds = connection.activeProjectIds.length > 0 ? connection.activeProjectIds : connection.projectIds;
    if (projectIds.length === 0) {
      throw new Error(`Connection ${connection.connectionKey} is not bound to any active project.`);
    }
    return projectIds;
  }

  private requireProject(projectId: string) {
    const project = this.projectManagementRepository.getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }
    return project;
  }

  private requireSprint(sprintId: string) {
    const sprint = this.projectManagementRepository.getSprint(sprintId);
    if (!sprint) {
      throw new Error(`Sprint not found: ${sprintId}`);
    }
    return sprint;
  }

  private requireJob(jobId: string) {
    const job = this.executionRepository.getSprintPreflightJob(jobId);
    if (!job) {
      throw new Error(`Sprint preflight job not found: ${jobId}`);
    }
    return job;
  }

  private mapStateToJobStatus(
    state: UpdateWorkerSprintPreflightArgs["state"],
    cancelRequested: boolean,
  ): WorkerSprintPreflightClaim["job"]["status"] {
    if (cancelRequested) {
      return state === "RUNNING" ? "cancel_requested" : "cancelled";
    }
    switch (state) {
      case "COMPLETED":
        return "completed";
      case "FAILED":
        return "failed";
      case "BLOCKED":
        return "blocked";
      case "RUNNING":
      default:
        return "running";
    }
  }

  private mapStateToEventType(
    state: UpdateWorkerSprintPreflightArgs["state"],
    cancelRequested: boolean,
  ): string {
    if (cancelRequested) {
      return state === "RUNNING" ? "sprint_preflight_cancel_pending" : "sprint_preflight_cancelled";
    }
    switch (state) {
      case "COMPLETED":
        return "sprint_preflight_completed";
      case "FAILED":
        return "sprint_preflight_failed";
      case "BLOCKED":
        return "sprint_preflight_blocked";
      case "RUNNING":
      default:
        return "sprint_preflight_heartbeat";
    }
  }

  private createLeaseExpiry(): string {
    return new Date(Date.now() + 5 * 60 * 1000).toISOString();
  }
}
