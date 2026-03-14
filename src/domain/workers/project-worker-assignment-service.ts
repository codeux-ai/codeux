import { ProjectWorkerAssignmentRepository } from "../../repositories/project-worker-assignment-repository.js";
import { WorkerEndpointRepository } from "../../repositories/worker-endpoint-repository.js";
import type { ProjectWorkerAssignmentRecord } from "../../contracts/worker-types.js";

export class ProjectWorkerAssignmentService {
  constructor(
    private readonly projectWorkerAssignmentRepository: ProjectWorkerAssignmentRepository,
    private readonly workerEndpointRepository: WorkerEndpointRepository,
  ) {}

  noteWorkerActivity(projectId: string, workerEndpointId: string): ProjectWorkerAssignmentRecord {
    const workerEndpoint = this.workerEndpointRepository.getWorkerEndpoint(workerEndpointId);
    if (!workerEndpoint) {
      throw new Error(`Worker endpoint not found: ${workerEndpointId}`);
    }

    const current = this.projectWorkerAssignmentRepository.getActiveAssignment(projectId, workerEndpointId);
    const projectAssignments = this.projectWorkerAssignmentRepository.listAssignmentsForProject(projectId, { activeOnly: true });
    const currentPrimary = projectAssignments.find((assignment) => assignment.assignmentRole === "primary");
    const workerAssignments = this.projectWorkerAssignmentRepository.listActiveAssignmentsForWorker(workerEndpointId);
    const workerOwnsPrimaryElsewhere = workerAssignments.some((assignment) => (
      assignment.assignmentRole === "primary" && assignment.projectId !== projectId
    ));

    const shouldBePrimary = !currentPrimary || currentPrimary.workerEndpointId === workerEndpointId;
    const nextRole = shouldBePrimary && !workerOwnsPrimaryElsewhere ? "primary" : "overflow";

    if (current) {
      return this.projectWorkerAssignmentRepository.touchAssignment(current.id, {
        assignmentRole: current.assignmentRole === nextRole ? undefined : nextRole,
      });
    }

    return this.projectWorkerAssignmentRepository.createAssignment(projectId, workerEndpoint, nextRole);
  }
}
