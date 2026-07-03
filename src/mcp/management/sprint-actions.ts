import type { ProjectManagementRepository } from "../../repositories/project-management-repository.js";
import type { ExecutionControlService } from "../../services/execution-control-service.js";
import type { ExecutionRepository } from "../../repositories/execution-repository.js";
import type { ManagementResponseEnvelope, ManagementApproval, ManageCodeUxArgs } from "../../contracts/internal-management-types.js";
import type { CreateSprintInput, UpdateSprintInput, PlanSprintOptions, PlanningOverrides } from "../../contracts/project-management-types.js";
import type { PlanningAgentService } from "../../services/planning-agent-service.js";
import type { IssueSearchInput, SprintIssueService } from "../../services/sprint-issue-service.js";
import { mergePromptWithLinkedIssues } from "../../services/linked-issue-prompt-markdown.js";

const VALID_SPRINT_STATUSES = ["running", "paused", "completed", "failed", "cancelled", "idle"] as const;

function readString(payload: Record<string, unknown>, key: string): string | undefined {
  return typeof payload[key] === "string" ? payload[key].trim() : undefined;
}

function readRequiredString(payload: Record<string, unknown>, key: string): string {
  const value = readString(payload, key);
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
}

function readRequiredStringAlias(payload: Record<string, unknown>, primaryKey: string, aliasKey: string): string {
  const value = readString(payload, primaryKey) || readString(payload, aliasKey);
  if (!value) {
    throw new Error(`${primaryKey} or ${aliasKey} is required`);
  }
  return value;
}

function readNullableString(payload: Record<string, unknown>, key: string): string | null | undefined {
  if (!(key in payload)) {
    return undefined;
  }
  if (payload[key] === null) {
    return null;
  }
  return typeof payload[key] === "string" ? payload[key].trim() : undefined;
}

function readStringAlias(payload: Record<string, unknown>, primaryKey: string, aliasKey: string): string | undefined {
  if (typeof payload[primaryKey] === "string") {
    return payload[primaryKey].trim();
  }
  if (typeof payload[aliasKey] === "string") {
    return payload[aliasKey].trim();
  }
  return undefined;
}

function readSprintStatus(value: unknown): CreateSprintInput["status"] | UpdateSprintInput["status"] | undefined {
  return typeof value === "string" && VALID_SPRINT_STATUSES.includes(value as typeof VALID_SPRINT_STATUSES[number])
    ? value as CreateSprintInput["status"]
    : undefined;
}

function normalizeLinkedIssues(value: unknown): CreateSprintInput["linkedIssues"] | undefined {
  return Array.isArray(value) ? value as CreateSprintInput["linkedIssues"] : undefined;
}

function normalizeCreateSprintInput(payload: Record<string, unknown>): CreateSprintInput {
  const input: CreateSprintInput = {
    name: readRequiredStringAlias(payload, "name", "title"),
  };
  const originalPrompt = readNullableString(payload, "originalPrompt");
  const goal = readStringAlias(payload, "goal", "goalMarkdown");
  const slug = readString(payload, "slug");
  const status = readSprintStatus(payload.status);
  const linkedIssues = normalizeLinkedIssues(payload.linkedIssues);

  if (originalPrompt !== undefined) input.originalPrompt = originalPrompt;
  if (goal !== undefined || linkedIssues) input.goal = mergePromptWithLinkedIssues(goal || "", linkedIssues || []);
  if (typeof payload.number === "number") input.number = payload.number;
  if (slug) input.slug = slug;
  if (status) input.status = status;
  if (typeof payload.showcasePinned === "boolean") input.showcasePinned = payload.showcasePinned;
  if (typeof payload.startDate === "string" || payload.startDate === null) input.startDate = payload.startDate;
  if (typeof payload.endDate === "string" || payload.endDate === null) input.endDate = payload.endDate;
  if (typeof payload.featureBranch === "string" || payload.featureBranch === null) input.featureBranch = payload.featureBranch;
  if (typeof payload.baseCommitSha === "string" || payload.baseCommitSha === null) input.baseCommitSha = payload.baseCommitSha;
  if (linkedIssues) input.linkedIssues = linkedIssues;

  return input;
}

function normalizeUpdateSprintInput(payload: Record<string, unknown>): UpdateSprintInput {
  const input: UpdateSprintInput = {};
  if ("name" in payload || "title" in payload) {
    input.name = readRequiredStringAlias(payload, "name", "title");
  }
  const originalPrompt = readNullableString(payload, "originalPrompt");
  const goal = readStringAlias(payload, "goal", "goalMarkdown");
  const slug = readString(payload, "slug");
  const status = readSprintStatus(payload.status);
  const linkedIssues = normalizeLinkedIssues(payload.linkedIssues);

  if (originalPrompt !== undefined) input.originalPrompt = originalPrompt;
  if (goal !== undefined) input.goal = mergePromptWithLinkedIssues(goal, linkedIssues || []);
  if ("number" in payload && (typeof payload.number === "number" || payload.number === null)) input.number = payload.number;
  if ("slug" in payload) input.slug = slug || undefined;
  if (status) input.status = status;
  if (typeof payload.showcasePinned === "boolean") input.showcasePinned = payload.showcasePinned;
  if (typeof payload.startDate === "string" || payload.startDate === null) input.startDate = payload.startDate;
  if (typeof payload.endDate === "string" || payload.endDate === null) input.endDate = payload.endDate;
  if (typeof payload.featureBranch === "string" || payload.featureBranch === null) input.featureBranch = payload.featureBranch;
  if (typeof payload.baseCommitSha === "string" || payload.baseCommitSha === null) input.baseCommitSha = payload.baseCommitSha;
  if (linkedIssues) input.linkedIssues = linkedIssues;

  return input;
}

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
    const { action, approval } = args;
    const payload = args.payload || {};

    switch (action) {
      case "list": {
        const projectId = readRequiredString(payload, "projectId");
        const result = this.deps.projectManagementRepository.listSprints(projectId);
        return { result };
      }
      case "get": {
        const sprintId = readRequiredString(payload, "sprintId");
        const result = this.deps.projectManagementRepository.getSprint(sprintId);
        if (!result) {
          throw new Error(`Sprint not found: ${sprintId}`);
        }
        return { result };
      }
      case "create": {
        const projectId = readRequiredString(payload, "projectId");
        const input = normalizeCreateSprintInput(payload);
        const result = this.deps.projectManagementRepository.createSprint(projectId, input);
        return { result };
      }
      case "update": {
        const sprintId = readRequiredString(payload, "sprintId");
        const input = normalizeUpdateSprintInput(payload);
        const result = this.deps.projectManagementRepository.updateSprint(sprintId, input);
        return { result };
      }
      case "delete": {
        const sprintId = readRequiredString(payload, "sprintId");
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
        const projectId = readRequiredString(payload, "projectId");
        const sprintId = readRequiredString(payload, "sprintId");
        const orchestration = await this.deps.executionControlService.orchestrateSprint(projectId, sprintId);
        return { result: { status: "success", message: "Sprint orchestration started", orchestration } };
      }
      case "pause": {
        const sprintRunId = readRequiredString(payload, "sprintRunId");
        const result = this.deps.executionControlService.pauseSprintRun(sprintRunId);
        return { result };
      }
      case "cancel": {
        const sprintRunId = readRequiredString(payload, "sprintRunId");
        const result = await this.deps.executionControlService.cancelSprintRun(sprintRunId);
        return { result };
      }
      case "force_cancel": {
        const sprintRunId = readRequiredString(payload, "sprintRunId");
        const result = await this.deps.executionControlService.forceCancelSprintRun(sprintRunId);
        return { result };
      }
      case "inspect_run": {
        const projectId = readRequiredString(payload, "projectId");
        const sprintId = readRequiredString(payload, "sprintId");

        const sprintRunId = readString(payload, "sprintRunId");
        const sprint = this.deps.projectManagementRepository.getSprint(sprintId);
        if (!sprint) {
          throw new Error(`Sprint not found: ${sprintId}`);
        }

        if (sprintRunId) {
          const run = this.deps.executionRepository.getSprintRun(sprintRunId);
          return { result: { sprint, runs: run ? [run] : [] } };
        }

        const runs = this.deps.executionRepository.listSprintRuns(projectId, sprintId);
        return { result: { sprint, runs } };
      }
      case "import_issues": {
        const projectId = readRequiredString(payload, "projectId");
        const sprintId = readString(payload, "sprintId");
        const searchInput: IssueSearchInput = {
          search: readString(payload, "search"),
          provider: payload.provider === "github" || payload.provider === "gitlab"
            ? payload.provider
            : undefined,
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
        const projectId = readRequiredString(payload, "projectId");
        const sprintId = readRequiredString(payload, "sprintId");

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
