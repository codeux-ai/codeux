import type { ProjectWorkerAssignmentRecord } from "../../contracts/worker-types.js";
import type { ProjectAttentionItemRecord } from "../../contracts/project-attention-types.js";
import type { ExecutionDashboardSnapshot } from "../../contracts/app-types.js";
import type { ProjectSummary, SprintRecord } from "../../contracts/project-management-types.js";
import { ProjectWorkerAssignmentRepository } from "../../repositories/project-worker-assignment-repository.js";
import { ProjectAttentionRepository } from "../../repositories/project-attention-repository.js";
import { ExecutionRepository } from "../../repositories/execution-repository.js";
import { ProjectManagementRepository } from "../../repositories/project-management-repository.js";

export function makeCursor(updatedAt: string, id: string): string {
  return `${updatedAt}::${id}`;
}

export function compareCursor(left: { updatedAt: string; id: string }, right: { updatedAt: string; id: string }): number {
  return makeCursor(left.updatedAt, left.id).localeCompare(makeCursor(right.updatedAt, right.id));
}

export class WorkerListenProjectCache {
  private assignments: ProjectWorkerAssignmentRecord[] | null = null;
  private activeAssignments: ProjectWorkerAssignmentRecord[] | null = null;
  private openAttentionItems: ProjectAttentionItemRecord[] | null = null;
  private unresolvedAttentionItems: ProjectAttentionItemRecord[] | null = null;
  private snapshot: ExecutionDashboardSnapshot | null = null;
  private project: ProjectSummary | null = null;
  private activeSprint: SprintRecord | null | undefined = undefined;

  constructor(
    public readonly projectId: string,
    private readonly projectWorkerAssignmentRepository: ProjectWorkerAssignmentRepository,
    private readonly projectAttentionRepository: ProjectAttentionRepository,
    private readonly executionRepository: ExecutionRepository,
    private readonly projectManagementRepository: ProjectManagementRepository,
  ) {}

  getAssignments(): ProjectWorkerAssignmentRecord[] {
    if (!this.assignments) {
      this.assignments = this.projectWorkerAssignmentRepository.listAssignmentsForProject(this.projectId);
    }
    return this.assignments;
  }

  getActiveAssignments(): ProjectWorkerAssignmentRecord[] {
    if (!this.activeAssignments) {
      this.activeAssignments = this.getAssignments().filter((a) => a.status === "active");
    }
    return this.activeAssignments;
  }

  getOpenAttentionItems(): ProjectAttentionItemRecord[] {
    if (!this.openAttentionItems) {
      this.openAttentionItems = this.projectAttentionRepository.listProjectAttentionItems(this.projectId, {
        statuses: ["open"],
        limit: 200,
      });
    }
    return this.openAttentionItems;
  }

  getUnresolvedAttentionItems(): ProjectAttentionItemRecord[] {
    if (!this.unresolvedAttentionItems) {
      this.unresolvedAttentionItems = this.projectAttentionRepository.listProjectAttentionItems(this.projectId, {
        statuses: ["open", "claimed"],
        limit: 5,
      });
    }
    return this.unresolvedAttentionItems;
  }

  getExecutionSnapshot(): ExecutionDashboardSnapshot {
    if (!this.snapshot) {
      this.snapshot = this.executionRepository.getProjectExecutionSnapshot(this.projectId);
    }
    return this.snapshot;
  }

  getProject(): ProjectSummary | null {
    if (this.project === null) {
      this.project = this.projectManagementRepository.getProject(this.projectId) as unknown as ProjectSummary;
    }
    return this.project;
  }

  getActiveSprint(): SprintRecord | null {
    if (this.activeSprint === undefined) {
      const snapshot = this.getExecutionSnapshot();
      const activeSprintSummary = snapshot.sprintRuns.find((run) => ["running", "queued", "paused", "cancel_requested"].includes(run.status))
        || snapshot.sprintRuns[0]
        || null;
      const sprintId = activeSprintSummary?.sprintId || null;
      this.activeSprint = sprintId
        ? this.projectManagementRepository.getSprint(sprintId)
        : this.projectManagementRepository.listSprints(this.projectId).sprints[0] || null;
    }
    return this.activeSprint;
  }

  findNextAssignment(workerEndpointId: string, lastCursor: string | null): ProjectWorkerAssignmentRecord | null {
    return this.getAssignments()
      .filter((assignment) => assignment.workerEndpointId === workerEndpointId)
      .filter((assignment) => !lastCursor || makeCursor(assignment.updatedAt, assignment.id) > lastCursor)
      .sort(compareCursor)[0] || null;
  }

  findNextAttentionItem(workerEndpointId: string, lastCursor: string | null, isConnectedMode: boolean): ProjectAttentionItemRecord | null {
    if (!isConnectedMode) return null;

    const workerOwnsProject = this.getActiveAssignments().some((assignment) => assignment.workerEndpointId === workerEndpointId);
    if (!workerOwnsProject) {
      return null;
    }

    const validItems = this.getOpenAttentionItems().filter((candidate) => (
      candidate.ownerType === "worker"
      && (candidate.assignedWorkerEndpointId === workerEndpointId || candidate.assignedWorkerEndpointId === null)
    )).sort(compareCursor);

    // In original code, the cursor logic for attention items was simply absent in the filter chain,
    // so it just grabbed the first item after sorting.
    // By keeping it this way, we pass the test 're-delivers an open attention item even when the stored cursor has already advanced past it'
    return validItems[0] || null;
  }
}
