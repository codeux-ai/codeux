import type { SprintRecord } from "../contracts/project-management-types.js";
import type { ExecutionControlService } from "./execution-control-service.js";
import type { ExecutionRepository } from "../repositories/execution-repository.js";
import type { ProjectAttentionRepository } from "../repositories/project-attention-repository.js";
import type { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import type { QaReviewRepository } from "../repositories/qa-review-repository.js";
import type { Logger } from "../shared/logging/logger.js";

export interface SprintManualActionServiceDeps {
  projectManagementRepository: Pick<ProjectManagementRepository, "getSprint" | "updateSprint">;
  executionRepository: Pick<ExecutionRepository, "findActiveSprintRun">;
  executionControlService: Pick<ExecutionControlService, "forceCancelSprintRun">;
  qaReviewRepository: Pick<QaReviewRepository, "recordManualSprintPass">;
  projectAttentionRepository: Pick<ProjectAttentionRepository, "listProjectAttentionItems" | "resolveAttentionItem">;
  logger: Logger;
}

export class SprintManualActionService {
  constructor(private readonly deps: SprintManualActionServiceDeps) {}

  async markCompleted(sprintId: string): Promise<SprintRecord> {
    const sprint = this.requireSprint(sprintId);
    const activeRun = this.deps.executionRepository.findActiveSprintRun(sprint.projectId, sprint.id);

    if (activeRun) {
      await this.deps.executionControlService.forceCancelSprintRun(activeRun.id);
    }

    const updated = this.deps.projectManagementRepository.updateSprint(sprint.id, { status: "completed" });
    this.deps.logger.info("Sprint manually marked completed", {
      projectId: sprint.projectId,
      sprintId: sprint.id,
      sprintRunId: activeRun?.id ?? null,
    });
    return updated;
  }

  markQaPassed(sprintId: string): SprintRecord {
    const sprint = this.requireSprint(sprintId);
    const activeRun = this.deps.executionRepository.findActiveSprintRun(sprint.projectId, sprint.id);
    const qaRun = this.deps.qaReviewRepository.recordManualSprintPass({
      projectId: sprint.projectId,
      sprintId: sprint.id,
      sprintRunId: activeRun?.id ?? null,
    });

    const qaHandoffs = this.deps.projectAttentionRepository.listProjectAttentionItems(sprint.projectId, {
      statuses: ["open", "claimed"],
      selectedSprintId: sprint.id,
      limit: 500,
    }).filter((item) => (
      item.sprintId === sprint.id
      && item.taskId === null
      && item.attentionType === "human_escalation_required"
      && item.payload?.sourceAttentionType === "qa_review"
      && item.payload?.qaScope === "sprint"
    ));

    for (const handoff of qaHandoffs) {
      this.deps.projectAttentionRepository.resolveAttentionItem(handoff.id, {
        status: "resolved",
        reason: "manual_qa_pass",
        resolutionSummaryMarkdown: "Sprint QA was manually marked as passed from the dashboard.",
        payloadPatch: { manualQaRunId: qaRun.id },
      });
    }

    this.deps.logger.info("Sprint QA manually marked passed", {
      projectId: sprint.projectId,
      sprintId: sprint.id,
      sprintRunId: activeRun?.id ?? null,
      qaRunId: qaRun.id,
      resolvedHandoffCount: qaHandoffs.length,
    });
    return this.requireSprint(sprint.id);
  }

  private requireSprint(sprintId: string): SprintRecord {
    const sprint = this.deps.projectManagementRepository.getSprint(sprintId);
    if (!sprint) {
      throw new Error(`Sprint not found: ${sprintId}`);
    }
    return sprint;
  }
}
