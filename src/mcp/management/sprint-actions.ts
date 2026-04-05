import type { ProjectManagementRepository } from "../../repositories/project-management-repository.js";
import type { ExecutionControlService } from "../../services/execution-control-service.js";
import type { ExecutionRepository } from "../../repositories/execution-repository.js";
import type { ManagementResponseEnvelope, ManagementApproval } from "../../contracts/internal-management-types.js";
import type { CreateSprintInput, UpdateSprintInput } from "../../contracts/project-management-types.js";

export async function handleSprintAction(
  action: string,
  payload: Record<string, unknown>,
  projectRepo: ProjectManagementRepository,
  executionControlService: ExecutionControlService,
  executionRepo: ExecutionRepository,
  domain: string,
  approval?: ManagementApproval
): Promise<ManagementResponseEnvelope> {
  switch (action) {
    case "list": {
      const projectId = payload.projectId as string;
      if (!projectId) {
        throw new Error("Missing projectId in payload");
      }
      const result = projectRepo.listSprints(projectId);
      return { result };
    }
    case "get": {
      const sprintId = payload.sprintId as string;
      if (!sprintId) {
        throw new Error("Missing sprintId in payload");
      }
      const result = projectRepo.getSprint(sprintId);
      return { result };
    }
    case "create": {
      const projectId = payload.projectId as string;
      if (!projectId) {
        throw new Error("Missing projectId in payload");
      }
      const input = payload as unknown as CreateSprintInput;
      const result = projectRepo.createSprint(projectId, input);
      return { result };
    }
    case "update": {
      const sprintId = payload.sprintId as string;
      if (!sprintId) {
        throw new Error("Missing sprintId in payload");
      }
      const input = payload as unknown as UpdateSprintInput;
      const result = projectRepo.updateSprint(sprintId, input);
      return { result };
    }
    case "delete": {
      const sprintId = payload.sprintId as string;
      if (!sprintId) {
        throw new Error("Missing sprintId in payload");
      }
      if (approval?.confirmed !== true) {
        return {
          approvalRequired: true,
          approvalMessage: `The action 'delete' is destructive and requires explicit approval. Please review the changes and call this tool again with approval.confirmed set to true.`,
        };
      }
      projectRepo.deleteSprint(sprintId);
      return { result: { status: "success", deletedSprintId: sprintId } };
    }
    case "start": {
      const projectId = payload.projectId as string;
      const sprintId = payload.sprintId as string;
      if (!projectId || !sprintId) {
        throw new Error("Missing projectId or sprintId in payload");
      }
      await executionControlService.orchestrateSprint(projectId, sprintId);
      return { result: { status: "success", message: "Sprint orchestration started" } };
    }
    case "pause": {
      const sprintRunId = payload.sprintRunId as string;
      if (!sprintRunId) {
        throw new Error("Missing sprintRunId in payload");
      }
      const result = executionControlService.pauseSprintRun(sprintRunId);
      return { result };
    }
    case "cancel": {
      const sprintRunId = payload.sprintRunId as string;
      if (!sprintRunId) {
        throw new Error("Missing sprintRunId in payload");
      }
      const result = executionControlService.cancelSprintRun(sprintRunId);
      return { result };
    }
    case "force_cancel": {
      const sprintRunId = payload.sprintRunId as string;
      if (!sprintRunId) {
        throw new Error("Missing sprintRunId in payload");
      }
      const result = await executionControlService.forceCancelSprintRun(sprintRunId);
      return { result };
    }
    case "inspect_run": {
      const projectId = payload.projectId as string;
      const sprintId = payload.sprintId as string;
      if (!projectId || !sprintId) {
        throw new Error("Missing projectId or sprintId in payload");
      }

      const sprintRunId = payload.sprintRunId as string | undefined;
      const sprint = projectRepo.getSprint(sprintId);

      if (sprintRunId) {
        const run = executionRepo.getSprintRun(sprintRunId);
        return { result: { sprint, runs: run ? [run] : [] } };
      }

      const runs = executionRepo.listSprintRuns(projectId, sprintId);
      return { result: { sprint, runs } };
    }
    default:
      throw new Error(`Unknown action: ${action}`);
  }
}
