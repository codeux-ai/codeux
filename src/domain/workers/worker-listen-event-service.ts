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

function makeCursor(updatedAt: string, id: string): string {
  return `${updatedAt}::${id}`;
}

export class WorkerListenEventService {
  constructor(
    private readonly connectionChatRepository: ConnectionChatRepository,
    private readonly workerEndpointRepository: WorkerEndpointRepository,
    private readonly projectManagementRepository: ProjectManagementRepository,
    private readonly projectWorkerAssignmentRepository: ProjectWorkerAssignmentRepository,
    private readonly projectAttentionRepository: ProjectAttentionRepository,
    private readonly executionRepository: ExecutionRepository,
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
      .sort((left, right) => makeCursor(right.updatedAt, right.id).localeCompare(makeCursor(left.updatedAt, left.id)))[0];

    if (!workerAssignment) {
      return null;
    }

    const nextCursor = makeCursor(workerAssignment.updatedAt, workerAssignment.id);
    if (lastCursor && nextCursor <= lastCursor) {
      return null;
    }

    const activeAssignments = assignments.filter((assignment) => assignment.status === "active");
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
    lastCursor: string | null,
  ): ListenAttentionItemEvent | null {
    const activeAssignments = this.projectWorkerAssignmentRepository.listAssignmentsForProject(projectId, {
      activeOnly: true,
    });
    const workerOwnsProject = activeAssignments.some((assignment) => assignment.workerEndpointId === workerEndpointId);
    if (!workerOwnsProject) {
      return null;
    }

    const item = this.projectAttentionRepository.listProjectAttentionItems(projectId, {
      statuses: ["open"],
      limit: 20,
    }).find((candidate) => (
      candidate.ownerType === "worker"
      && (candidate.assignedWorkerEndpointId === workerEndpointId || candidate.assignedWorkerEndpointId === null)
      && (!lastCursor || makeCursor(candidate.updatedAt, candidate.id) > lastCursor)
    ));

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
        instruction: "Review the attention item in the provided project context, handle the blocker using your available tools, then call listen again with the same connection_key to keep supervising work.",
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
    const sprint = activeSprintSummary
      ? this.projectManagementRepository.getSprint(activeSprintSummary.sprintId)
      : this.projectManagementRepository.listSprints(projectId)[0] || null;

    return {
      id: project.id,
      name: project.name,
      repoPath: project.baseDir,
      defaultBranch: project.defaultBranch,
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
}
