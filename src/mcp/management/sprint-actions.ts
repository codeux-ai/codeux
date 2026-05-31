import type { ProjectManagementRepository } from "../../repositories/project-management-repository.js";
import type { ExecutionControlService } from "../../services/execution-control-service.js";
import type { ExecutionRepository } from "../../repositories/execution-repository.js";
import type { ManagementResponseEnvelope, ManagementApproval, ManageCodeUxArgs } from "../../contracts/internal-management-types.js";
import type { CreateSprintInput, UpdateSprintInput, PlanSprintOptions, PlanningOverrides, LinkedIssueProvider } from "../../contracts/project-management-types.js";
import type { PlanningAgentService } from "../../services/planning-agent-service.js";
import type { SprintIssueService } from "../../services/sprint-issue-service.js";

export interface SprintActionsDeps {
  projectManagementRepository: ProjectManagementRepository;
  executionControlService: ExecutionControlService;
  executionRepository: ExecutionRepository;
  planningAgentService: PlanningAgentService;
  sprintIssueService: SprintIssueService;
}

export class SprintActions {
  constructor(private readonly deps: SprintActionsDeps) {}

  async handleSprintAction(args: ManageCodeUxArgs): Promise<ManagementResponseEnvelope> {
    const { action, payload, approval } = args;

    switch (action) {
      case "list": {
        const projectId = payload.projectId as string;
        if (!projectId) {
          throw new Error("Missing projectId in payload");
        }
        const result = this.deps.projectManagementRepository.listSprints(projectId);
        return { result };
      }
      case "get": {
        const sprintId = payload.sprintId as string;
        if (!sprintId) {
          throw new Error("Missing sprintId in payload");
        }
        const result = this.deps.projectManagementRepository.getSprint(sprintId);
        return { result };
      }
      case "create": {
        const projectId = payload.projectId as string;
        if (!projectId) {
          throw new Error("Missing projectId in payload");
        }
        const input = payload as unknown as CreateSprintInput;
        const result = this.deps.projectManagementRepository.createSprint(projectId, input);
        return { result };
      }
      case "update": {
        const sprintId = payload.sprintId as string;
        if (!sprintId) {
          throw new Error("Missing sprintId in payload");
        }
        const input = payload as unknown as UpdateSprintInput;
        const result = this.deps.projectManagementRepository.updateSprint(sprintId, input);
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
        this.deps.projectManagementRepository.deleteSprint(sprintId);
        return { result: { status: "success", deletedSprintId: sprintId } };
      }
      case "start": {
        const projectId = payload.projectId as string;
        const sprintId = payload.sprintId as string;
        if (!projectId || !sprintId) {
          throw new Error("Missing projectId or sprintId in payload");
        }
        await this.deps.executionControlService.orchestrateSprint(projectId, sprintId);
        return { result: { status: "success", message: "Sprint orchestration started" } };
      }
      case "pause": {
        const sprintRunId = payload.sprintRunId as string;
        if (!sprintRunId) {
          throw new Error("Missing sprintRunId in payload");
        }
        const result = this.deps.executionControlService.pauseSprintRun(sprintRunId);
        return { result };
      }
      case "cancel": {
        const sprintRunId = payload.sprintRunId as string;
        if (!sprintRunId) {
          throw new Error("Missing sprintRunId in payload");
        }
        const result = await this.deps.executionControlService.cancelSprintRun(sprintRunId);
        return { result };
      }
      case "force_cancel": {
        const sprintRunId = payload.sprintRunId as string;
        if (!sprintRunId) {
          throw new Error("Missing sprintRunId in payload");
        }
        const result = await this.deps.executionControlService.forceCancelSprintRun(sprintRunId);
        return { result };
      }
      case "inspect_run": {
        const projectId = payload.projectId as string;
        const sprintId = payload.sprintId as string;
        if (!projectId || !sprintId) {
          throw new Error("Missing projectId or sprintId in payload");
        }

        const sprintRunId = payload.sprintRunId as string | undefined;
        const sprint = this.deps.projectManagementRepository.getSprint(sprintId);

        if (sprintRunId) {
          const run = this.deps.executionRepository.getSprintRun(sprintRunId);
          return { result: { sprint, runs: run ? [run] : [] } };
        }

        const runs = this.deps.executionRepository.listSprintRuns(projectId, sprintId);
        return { result: { sprint, runs } };
      }
      case "import_issues": {
        const projectId = payload.projectId as string;
        if (!projectId) {
          throw new Error("Missing projectId in payload");
        }
        const sprintId = payload.sprintId as string | undefined;
        const searchInput = {
          search: payload.search as string | undefined,
          provider: payload.provider as LinkedIssueProvider | undefined,
          limit: typeof payload.limit === 'number' ? payload.limit : undefined,
        };

        const issues = await this.deps.sprintIssueService.searchIssues(projectId, searchInput);

        let result: unknown = issues;
        if (sprintId) {
          result = this.deps.projectManagementRepository.replaceSprintLinkedIssues(projectId, sprintId, issues);
        }
        return { result };
      }
      case "plan": {
        const projectId = payload.projectId as string;
        const sprintId = payload.sprintId as string;
        if (!projectId || !sprintId) {
          throw new Error("Missing projectId or sprintId in payload");
        }

        const options: PlanSprintOptions = {
          autoStart: payload.autoStart === true,
          replan: payload.replan === true,
          planningAgentPresetId: payload.planningAgentPresetId as string | undefined,
          overrides: payload.overrides as PlanningOverrides | undefined,
        };

        const result = await this.deps.planningAgentService.planSprint(projectId, sprintId, options);
        return { result };
      }
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }
}
