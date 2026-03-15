import { ProjectAttentionRepository, type OpenProjectAttentionItemInput } from "../../repositories/project-attention-repository.js";
import { ProjectWorkerAssignmentRepository } from "../../repositories/project-worker-assignment-repository.js";
import type { ProjectAttentionItemRecord, ProjectAttentionOwnerType, ProjectAttentionType } from "../../contracts/project-attention-types.js";

function isAssignableWorkerStatus(status: string | null | undefined): boolean {
  return status !== null && status !== "stale" && status !== "offline";
}

export class ProjectAttentionService {
  constructor(
    private readonly projectAttentionRepository: ProjectAttentionRepository,
    private readonly projectWorkerAssignmentRepository: ProjectWorkerAssignmentRepository,
  ) {}

  openItem(input: OpenProjectAttentionItemInput & { preferredWorkerEndpointId?: string | null }): ProjectAttentionItemRecord {
    const assignedWorkerEndpointId = this.resolveAssignedWorkerEndpointId(
      input.projectId,
      input.ownerType,
      input.preferredWorkerEndpointId,
    );

    return this.projectAttentionRepository.openOrRefreshItem({
      ...input,
      assignedWorkerEndpointId,
    });
  }

  resolveItemsForDispatch(dispatchId: string, reason?: string): number {
    return this.projectAttentionRepository.resolveAttentionItemsForDispatch(dispatchId, {
      status: "resolved",
      reason,
    });
  }

  resolveItemsForTask(projectId: string, taskId: string, attentionTypes: ProjectAttentionType[], reason?: string): number {
    return this.projectAttentionRepository.resolveAttentionItems(
      {
        projectId,
        taskId,
        attentionTypes,
      },
      {
        status: "resolved",
        reason,
      },
    );
  }

  resolveItemsForSprintRun(projectId: string, sprintRunId: string, attentionTypes: ProjectAttentionType[], reason?: string): number {
    return this.projectAttentionRepository.resolveAttentionItems(
      {
        projectId,
        sprintRunId,
        attentionTypes,
      },
      {
        status: "resolved",
        reason,
      },
    );
  }

  listActiveProjectItems(projectId: string): ProjectAttentionItemRecord[] {
    return this.projectAttentionRepository.listProjectAttentionItems(projectId, {
      statuses: ["open", "claimed"],
      limit: 50,
    });
  }

  getItem(itemId: string): ProjectAttentionItemRecord | null {
    return this.projectAttentionRepository.getAttentionItem(itemId);
  }

  claimItem(itemId: string, workerEndpointId: string, claimReason?: string): ProjectAttentionItemRecord {
    const current = this.requireItem(itemId);
    if (current.ownerType !== "worker") {
      throw new Error(`Attention item ${itemId} is not worker-claimable.`);
    }
    if (current.assignedWorkerEndpointId && current.assignedWorkerEndpointId !== workerEndpointId) {
      throw new Error(`Attention item ${itemId} is assigned to another worker endpoint.`);
    }
    return this.projectAttentionRepository.claimAttentionItem(itemId, {
      assignedWorkerEndpointId: workerEndpointId,
      claimReason,
    });
  }

  resolveItem(itemId: string, input?: {
    status?: "resolved" | "dismissed" | "expired";
    reason?: string;
    resolutionSummaryMarkdown?: string;
    workerEndpointId?: string | null;
    payloadPatch?: Record<string, unknown> | null;
  }): ProjectAttentionItemRecord {
    const current = this.requireItem(itemId);
    if (
      input?.workerEndpointId
      && current.ownerType === "worker"
      && current.assignedWorkerEndpointId
      && current.assignedWorkerEndpointId !== input.workerEndpointId
    ) {
      throw new Error(`Attention item ${itemId} is assigned to another worker endpoint.`);
    }
    return this.projectAttentionRepository.resolveAttentionItem(itemId, {
      status: input?.status,
      reason: input?.reason,
      resolutionSummaryMarkdown: input?.resolutionSummaryMarkdown,
      resolvedByWorkerEndpointId: input?.workerEndpointId ?? null,
      payloadPatch: input?.payloadPatch,
    });
  }

  private requireItem(itemId: string): ProjectAttentionItemRecord {
    const item = this.projectAttentionRepository.getAttentionItem(itemId);
    if (!item) {
      throw new Error(`Project attention item not found: ${itemId}`);
    }
    return item;
  }

  private resolveAssignedWorkerEndpointId(
    projectId: string,
    ownerType: ProjectAttentionOwnerType,
    preferredWorkerEndpointId?: string | null,
  ): string | null {
    if (ownerType !== "worker") {
      return null;
    }
    const assignments = this.projectWorkerAssignmentRepository.listAssignmentsForProject(projectId, {
      activeOnly: true,
    });
    if (preferredWorkerEndpointId) {
      const preferred = assignments.find((assignment) => (
        assignment.workerEndpointId === preferredWorkerEndpointId
        && assignment.capabilities.canSuperviseProjects
        && isAssignableWorkerStatus(assignment.workerStatus)
      ));
      if (preferred?.workerEndpointId) {
        return preferred.workerEndpointId;
      }
    }

    const primary = assignments.find((assignment) => (
      assignment.assignmentRole === "primary"
      && assignment.capabilities.canSuperviseProjects
      && isAssignableWorkerStatus(assignment.workerStatus)
    ));
    if (primary?.workerEndpointId) {
      return primary.workerEndpointId;
    }

    const overflow = assignments.find((assignment) => (
      assignment.assignmentRole === "overflow"
      && assignment.capabilities.canSuperviseProjects
      && isAssignableWorkerStatus(assignment.workerStatus)
    ));
    return overflow?.workerEndpointId || null;
  }
}
