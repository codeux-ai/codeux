import { isAssignableWorkerStatus } from "./worker-status-utils.js";
import { ProjectWorkerAssignmentRepository } from "../../repositories/project-worker-assignment-repository.js";
import {
  WorkerEndpointRepository,
  type ResolveWorkerEndpointInput,
} from "../../repositories/worker-endpoint-repository.js";
import type {
  ProjectWorkerAssignmentRecord,
  WorkerEndpointRecord,
} from "../../contracts/worker-types.js";


function isLivePreferredWorkerStatus(status: string | null | undefined): boolean {
  return status === "connected" || status === "idle" || status === "paused";
}

function hasWorkerSelection(input?: SetProjectPreferredWorkerInput): boolean {
  return Boolean(
    input?.workerConnectionId?.trim()
    || input?.workerEndpointId?.trim()
    || input?.workerEndpointKey?.trim(),
  );
}

export type SetProjectPreferredWorkerInput = ResolveWorkerEndpointInput;

export class ProjectWorkerAssignmentService {
  constructor(
    private readonly projectWorkerAssignmentRepository: ProjectWorkerAssignmentRepository,
    private readonly workerEndpointRepository: WorkerEndpointRepository,
  ) {}

  noteWorkerActivity(projectId: string, workerEndpointId: string): ProjectWorkerAssignmentRecord {
    return this.upsertWorkerAssignment(projectId, workerEndpointId, true);
  }

  ensureWorkerAssignment(projectId: string, workerEndpointId: string): ProjectWorkerAssignmentRecord {
    return this.upsertWorkerAssignment(projectId, workerEndpointId, false);
  }

  releaseWorkerAssignment(projectId: string, workerEndpointId: string, releaseReason?: string): ProjectWorkerAssignmentRecord | null {
    const current = this.projectWorkerAssignmentRepository.getActiveAssignment(projectId, workerEndpointId);
    if (!current) {
      return null;
    }
    return this.projectWorkerAssignmentRepository.releaseAssignment(current.id, releaseReason);
  }

  setProjectPreferredWorker(
    projectId: string,
    input?: SetProjectPreferredWorkerInput,
  ): ProjectWorkerAssignmentRecord[] {
    const preferredWorker = this.workerEndpointRepository.resolveWorkerEndpoint(input || {});
    if (!preferredWorker) {
      if (hasWorkerSelection(input)) {
        const selectedTarget = input?.workerConnectionId
          || input?.workerEndpointId
          || input?.workerEndpointKey;
        throw new Error(`Preferred worker target not found: ${selectedTarget}`);
      }
      return this.clearProjectPreferredWorker(projectId);
    }

    this.assertPreferredWorkerTarget(preferredWorker, input);

    const projectAssignments = this.projectWorkerAssignmentRepository.listAssignmentsForProject(projectId, { activeOnly: true });
    for (const assignment of projectAssignments) {
      if (assignment.assignmentRole === "primary" && assignment.workerEndpointId !== preferredWorker.id) {
        this.projectWorkerAssignmentRepository.touchAssignment(assignment.id, {
          assignmentRole: "overflow",
        });
      }
    }

    const currentAssignment = this.projectWorkerAssignmentRepository.getActiveAssignment(projectId, preferredWorker.id);
    if (!currentAssignment) {
      this.projectWorkerAssignmentRepository.createAssignment(projectId, preferredWorker, "primary");
    } else if (currentAssignment.assignmentRole !== "primary") {
      this.projectWorkerAssignmentRepository.touchAssignment(currentAssignment.id, {
        assignmentRole: "primary",
      });
    }

    return this.projectWorkerAssignmentRepository.listAssignmentsForProject(projectId, { activeOnly: true });
  }

  private clearProjectPreferredWorker(projectId: string): ProjectWorkerAssignmentRecord[] {
    const projectAssignments = this.projectWorkerAssignmentRepository.listAssignmentsForProject(projectId, { activeOnly: true });
    for (const assignment of projectAssignments) {
      if (assignment.assignmentRole === "primary") {
        this.projectWorkerAssignmentRepository.touchAssignment(assignment.id, {
          assignmentRole: "overflow",
        });
      }
    }

    return this.projectWorkerAssignmentRepository.listAssignmentsForProject(projectId, { activeOnly: true });
  }

  private upsertWorkerAssignment(
    projectId: string,
    workerEndpointId: string,
    touchExisting: boolean,
  ): ProjectWorkerAssignmentRecord {
    const workerEndpoint = this.workerEndpointRepository.getWorkerEndpoint(workerEndpointId);
    if (!workerEndpoint) {
      throw new Error(`Worker endpoint not found: ${workerEndpointId}`);
    }

    const current = this.projectWorkerAssignmentRepository.getActiveAssignment(projectId, workerEndpointId);
    const projectAssignments = this.projectWorkerAssignmentRepository.listAssignmentsForProject(projectId, { activeOnly: true });
    const currentPrimary = projectAssignments.find((assignment) => (
      assignment.assignmentRole === "primary"
      && assignment.capabilities.canSuperviseProjects
      && isAssignableWorkerStatus(assignment.workerStatus)
    ));
    const workerAssignments = this.projectWorkerAssignmentRepository.listActiveAssignmentsForWorker(workerEndpointId);
    const workerOwnsPrimaryElsewhere = workerAssignments.some((assignment) => (
      assignment.assignmentRole === "primary"
      && assignment.projectId !== projectId
      && assignment.capabilities.canSuperviseProjects
      && isAssignableWorkerStatus(assignment.workerStatus)
    ));

    const shouldBePrimary = !currentPrimary || currentPrimary.workerEndpointId === workerEndpointId;
    const nextRole = shouldBePrimary && !workerOwnsPrimaryElsewhere ? "primary" : "overflow";

    if (current) {
      if (!touchExisting && current.assignmentRole === nextRole) {
        return current;
      }
      return this.projectWorkerAssignmentRepository.touchAssignment(current.id, {
        assignmentRole: current.assignmentRole === nextRole ? undefined : nextRole,
      });
    }

    return this.projectWorkerAssignmentRepository.createAssignment(projectId, workerEndpoint, nextRole);
  }

  private assertPreferredWorkerTarget(
    workerEndpoint: WorkerEndpointRecord,
    input?: SetProjectPreferredWorkerInput,
  ): void {
    if (!workerEndpoint.capabilities.canSuperviseProjects) {
      throw new Error(`Worker endpoint cannot supervise projects: ${workerEndpoint.id}`);
    }

    if (!isLivePreferredWorkerStatus(workerEndpoint.status)) {
      const selectedTarget = input?.workerConnectionId
        || input?.workerEndpointId
        || input?.workerEndpointKey
        || workerEndpoint.id;
      throw new Error(`Preferred worker target is not live: ${selectedTarget}`);
    }
  }
}
