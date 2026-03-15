import { ProjectWorkerAssignmentRepository } from "../../repositories/project-worker-assignment-repository.js";
import { WorkerEndpointRepository } from "../../repositories/worker-endpoint-repository.js";
import type { ProjectWorkerAssignmentRecord } from "../../contracts/worker-types.js";

function isAssignableWorkerStatus(status: string | null | undefined): boolean {
  return status !== null && status !== "stale" && status !== "offline";
}

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
}
