import type {
  ListenAssignmentChangedEvent,
  ListenAttentionItemEvent,
  ListenContextDigestPayload,
  ListenProjectPayload,
} from "../../contracts/connection-chat-types.js";
import { ConnectionChatRepository } from "../../repositories/connection-chat-repository.js";
import { ProjectManagementRepository } from "../../repositories/project-management-repository.js";
import { ProjectAttentionRepository } from "../../repositories/project-attention-repository.js";
import { ProjectWorkerAssignmentRepository } from "../../repositories/project-worker-assignment-repository.js";
import { WorkerEndpointRepository } from "../../repositories/worker-endpoint-repository.js";
import { ExecutionRepository } from "../../repositories/execution-repository.js";
import type { DashboardSettings, DashboardSettingsScope, WorkerExecutionMode } from "../../contracts/app-types.js";

function makeCursor(updatedAt: string, id: string): string {
  return `${updatedAt}::${id}`;
}

function compareCursor(left: { updatedAt: string; id: string }, right: { updatedAt: string; id: string }): number {
  return makeCursor(left.updatedAt, left.id).localeCompare(makeCursor(right.updatedAt, right.id));
}

function isAssignableWorkerStatus(status: string | null | undefined): boolean {
  return status !== null && status !== "stale" && status !== "offline";
}

export class WorkerListenEventService {
  constructor(
    private readonly connectionChatRepository: ConnectionChatRepository,
    private readonly workerEndpointRepository: WorkerEndpointRepository,
    private readonly projectManagementRepository: ProjectManagementRepository,
    private readonly projectWorkerAssignmentRepository: ProjectWorkerAssignmentRepository,
    private readonly projectAttentionRepository: ProjectAttentionRepository,
    private readonly executionRepository: ExecutionRepository,
    private readonly getDashboardSettings: (scope?: DashboardSettingsScope) => DashboardSettings,
    private readonly resolveWorkerExecutionMode: (projectId: string, sprintId?: string | null) => WorkerExecutionMode = () => "CONNECTED_MCP",
  ) {}

  pullNextEvent(args: {
    connectionKey: string;
    projectId?: string;
    includeAttentionItems?: boolean;
  }): ListenAssignmentChangedEvent | ListenAttentionItemEvent | null {
    const connection = this.connectionChatRepository.getConnectionByKey(args.connectionKey);
    if (!connection || connection.role !== "worker") {
      return null;
    }

    const workerEndpoint = this.workerEndpointRepository.getWorkerEndpointByConnectionId(connection.id);
    if (!workerEndpoint || !workerEndpoint.capabilities.canSuperviseProjects) {
      return null;
    }

    const scopedProjectIds = (args.projectId
      ? [args.projectId]
      : connection.activeProjectIds.length > 0
        ? connection.activeProjectIds
        : connection.projectIds)
      .filter(Boolean);
    if (scopedProjectIds.length === 0) {
      return null;
    }

    const bindings = new Map(
      this.connectionChatRepository.listProjectBindingStates(connection.id).map((binding) => [binding.projectId, binding]),
    );

    for (const projectId of scopedProjectIds) {
      if (this.resolveWorkerExecutionMode(projectId) !== "CONNECTED_MCP") {
        continue;
      }
      const event = this.pullAssignmentChangedEvent(workerEndpoint.id, projectId, bindings.get(projectId)?.lastAssignmentCursor || null);
      if (event) {
        this.connectionChatRepository.updateProjectBindingCursor(connection.id, projectId, {
          assignmentCursor: makeCursor(event.assignment.updatedAt, event.assignment.assignmentId),
        });
        return event;
      }
    }

    if (args.includeAttentionItems === false) {
      return null;
    }

    for (const projectId of scopedProjectIds) {
      if (this.resolveWorkerExecutionMode(projectId) !== "CONNECTED_MCP") {
        continue;
      }
      const event = this.pullAttentionItemEvent(workerEndpoint.id, projectId, bindings.get(projectId)?.lastAttentionCursor || null);
      if (event) {
        this.connectionChatRepository.updateProjectBindingCursor(connection.id, projectId, {
          attentionCursor: makeCursor(event.item.updatedAt, event.item.id),
        });
        return event;
      }
    }

    return null;
  }

  private pullAssignmentChangedEvent(
    workerEndpointId: string,
    projectId: string,
    lastCursor: string | null,
  ): ListenAssignmentChangedEvent | null {
    const assignments = this.projectWorkerAssignmentRepository.listAssignmentsForProject(projectId);
    const workerAssignment = assignments
      .filter((assignment) => assignment.workerEndpointId === workerEndpointId)
      .filter((assignment) => !lastCursor || makeCursor(assignment.updatedAt, assignment.id) > lastCursor)
      .sort(compareCursor)[0];

    if (!workerAssignment) {
      return null;
    }

    const nextCursor = makeCursor(workerAssignment.updatedAt, workerAssignment.id);

    const activeAssignments = assignments.filter((assignment) => (
      assignment.status === "active"
      && assignment.capabilities.canSuperviseProjects
      && isAssignableWorkerStatus(assignment.workerStatus)
    ));
    const primary = activeAssignments.find((assignment) => assignment.assignmentRole === "primary") || null;
    const project = this.buildProjectPayload(projectId);
    return {
      kind: "assignment_changed",
      assignment: {
        assignmentId: workerAssignment.id,
        workerEndpointId: workerAssignment.workerEndpointId,
        assignmentRole: workerAssignment.assignmentRole,
        status: workerAssignment.status,
        assignedAt: workerAssignment.assignedAt,
        updatedAt: workerAssignment.updatedAt,
        releasedAt: workerAssignment.releasedAt,
        releaseReason: workerAssignment.releaseReason,
        primaryAssignedWorkerEndpointId: primary?.workerEndpointId || null,
        overflowAssignedWorkerEndpointIds: activeAssignments
          .filter((assignment) => assignment.assignmentRole === "overflow")
          .map((assignment) => assignment.workerEndpointId)
          .filter((value): value is string => Boolean(value)),
      },
      project,
      workingDirectoryHint: `cd ${project.repoPath}`,
      contextDigest: this.buildContextDigest(projectId),
      continuation: {
        nextTool: "listen",
        instruction: "Update your local project context for this assignment change, then call listen again with the same connection_key to keep supervising work.",
      },
    };
  }

  private pullAttentionItemEvent(
    workerEndpointId: string,
    projectId: string,
    _lastCursor: string | null,
  ): ListenAttentionItemEvent | null {
    if (this.resolveWorkerExecutionMode(projectId) !== "CONNECTED_MCP") {
      return null;
    }

    const activeAssignments = this.projectWorkerAssignmentRepository.listAssignmentsForProject(projectId, {
      activeOnly: true,
    });
    const workerOwnsProject = activeAssignments.some((assignment) => assignment.workerEndpointId === workerEndpointId);
    if (!workerOwnsProject) {
      return null;
    }

    const item = this.projectAttentionRepository.listProjectAttentionItems(projectId, {
      statuses: ["open"],
      limit: 200,
    }).filter((candidate) => (
      candidate.ownerType === "worker"
      && this.resolveWorkerExecutionMode(candidate.projectId, candidate.sprintId) === "CONNECTED_MCP"
      && (candidate.assignedWorkerEndpointId === workerEndpointId || candidate.assignedWorkerEndpointId === null)
    )).sort(compareCursor)[0];

    if (!item) {
      return null;
    }

    const project = this.buildProjectPayload(projectId);
    return {
      kind: "attention_item",
      item: {
        id: item.id,
        projectId: item.projectId,
        sprintId: item.sprintId,
        taskId: item.taskId,
        sprintRunId: item.sprintRunId,
        dispatchId: item.dispatchId,
        attentionType: item.attentionType,
        severity: item.severity,
        ownerType: item.ownerType,
        status: item.status,
        assignedWorkerEndpointId: item.assignedWorkerEndpointId,
        title: item.title,
        summaryMarkdown: item.summaryMarkdown,
        payload: item.payload,
        openedAt: item.openedAt,
        updatedAt: item.updatedAt,
      },
      project,
      workingDirectoryHint: `cd ${project.repoPath}`,
      contextDigest: this.buildContextDigest(projectId),
      continuation: {
        nextTool: "listen",
        instruction: this.buildAttentionContinuationInstruction(project.repoPath, item),
      },
    };
  }

  private buildProjectPayload(projectId: string): ListenProjectPayload {
    const project = this.projectManagementRepository.getProject(projectId);
    if (!project) {
      throw new Error(`Project not found for worker event: ${projectId}`);
    }
    const snapshot = this.executionRepository.getProjectExecutionSnapshot(projectId);
    const activeSprintSummary = snapshot.sprintRuns.find((run) => ["running", "queued", "paused", "cancel_requested"].includes(run.status))
      || snapshot.sprintRuns[0]
      || null;
    const sprintId = activeSprintSummary?.sprintId || null;
    const sprint = sprintId
      ? this.projectManagementRepository.getSprint(sprintId)
      : this.projectManagementRepository.listSprints(projectId).sprints[0] || null;

    const settings = this.getDashboardSettings({
      projectId: project.id,
      sprintId: sprint?.id || undefined,
    });
    const defaultBranch = settings.git.defaultBranch || project.defaultBranch || "main";

    return {
      id: project.id,
      name: project.name,
      repoPath: project.baseDir,
      defaultBranch,
      featureBranch: sprint?.featureBranch || null,
    };
  }

  private buildContextDigest(projectId: string): ListenContextDigestPayload {
    const snapshot = this.executionRepository.getProjectExecutionSnapshot(projectId);
    const activeSprint = snapshot.sprintRuns.find((run) => ["running", "queued", "paused", "cancel_requested"].includes(run.status))
      || snapshot.sprintRuns[0]
      || null;
    const unresolvedAttention = this.projectAttentionRepository.listProjectAttentionItems(projectId, {
      statuses: ["open", "claimed"],
      limit: 5,
    });

    return {
      activeSprintId: activeSprint?.sprintId || null,
      activeSprintName: activeSprint?.sprintName || null,
      activeSprintNumber: activeSprint?.sprintNumber ?? null,
      unresolvedAttentionCount: unresolvedAttention.length,
      unresolvedAttentionTitles: unresolvedAttention.slice(0, 3).map((item) => item.title),
      recentEventTypes: snapshot.recentEvents.slice(0, 5).map((event) => event.eventType),
    };
  }

  private buildAttentionContinuationInstruction(
    repoPath: string,
    item: { attentionType: string; payload: Record<string, unknown> | null },
  ): string {
    if (item.attentionType === "merge_conflict") {
      const conflictingBranches = this.asRecord(item.payload?.conflictingBranches);
      const sourceBranch = this.readPayloadString(conflictingBranches, "source")
        || this.readPayloadString(item.payload, "workerBranch")
        || "the task branch";
      const targetBranch = this.readPayloadString(conflictingBranches, "target")
        || this.readPayloadString(item.payload, "featureBranch")
        || "the sprint feature branch";
      return `Change into ${repoPath}, inspect the merge conflict between ${sourceBranch} and ${targetBranch}, use the task prompt context in the attention payload to resolve it, then call listen again with the same connection_key to keep supervising work.`;
    }

    return "Review the attention item in the provided project context, handle the blocker using your available tools, then call listen again with the same connection_key to keep supervising work.";
  }

  private readPayloadString(
    payload: Record<string, unknown> | null | undefined,
    key: string,
  ): string | null {
    const value = payload?.[key];
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  }
}
