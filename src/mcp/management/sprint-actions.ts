import type { ProjectManagementRepository } from "../../repositories/project-management-repository.js";
import type { ExecutionControlService } from "../../services/execution-control-service.js";
import type { ExecutionRepository } from "../../repositories/execution-repository.js";
import type { ManagementResponseEnvelope, ManageCodeUxArgs } from "../../contracts/internal-management-types.js";
import type {
  CreateSprintInput,
  IssuePromptContext,
  PlanSprintOptions,
  PlanningOverrides,
  RepositoryIssueSearchResult,
  SprintLinkedIssueInput,
  SprintLinkedIssueRecord,
  SprintRecord,
  UpdateSprintInput,
} from "../../contracts/project-management-types.js";
import type { PlanningAgentService } from "../../services/planning-agent-service.js";
import type { IssueSearchInput, SprintIssueService } from "../../services/sprint-issue-service.js";
import type { SchedulerService } from "../../services/scheduler-service.js";
import type { Logger } from "../../shared/logging/logger.js";
import { getCurrentMcpAgentId, getCurrentMcpThreadId } from "../../server/mcp-agent-context.js";
import { mergePromptWithLinkedIssues } from "../../services/linked-issue-prompt-markdown.js";
import {
  parseOptionalEnumStrict,
  parseOptionalIntegerStrict,
  parseOptionalNullableString,
  parseOptionalString,
  parseOptionalStringAlias,
  parseRequiredString as readRequiredString,
  parseRequiredStringAlias as readRequiredStringAlias,
} from "./payload-parsers.js";

const VALID_SPRINT_STATUSES = ["running", "paused", "completed", "failed", "cancelled", "idle"] as const;

function readString(payload: Record<string, unknown>, key: string): string | undefined {
  return parseOptionalString(payload, key);
}

function readStringArray(payload: Record<string, unknown>, key: string): string[] | undefined {
  const value = payload[key];
  if (!Array.isArray(value)) {
    return undefined;
  }
  const strings = value
    .map((item) => typeof item === "string" ? item.trim() : "")
    .filter(Boolean);
  return strings.length > 0 ? strings : undefined;
}

function readNumberArray(payload: Record<string, unknown>, key: string): number[] | undefined {
  const value = payload[key];
  if (!Array.isArray(value)) {
    return undefined;
  }
  const numbers = value
    .map((item) => typeof item === "number" ? item : typeof item === "string" ? Number(item.trim()) : NaN)
    .filter((item) => Number.isFinite(item));
  return numbers.length > 0 ? numbers : undefined;
}

function clampImportLimit(value: number | undefined): number | undefined {
  if (!Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(1, Math.min(100, Math.trunc(value as number)));
}

function normalizeLinkedIssues(value: unknown): CreateSprintInput["linkedIssues"] | undefined {
  return Array.isArray(value) ? value as CreateSprintInput["linkedIssues"] : undefined;
}

function toLinkedIssueInput(issue: SprintLinkedIssueInput): SprintLinkedIssueInput {
  return {
    provider: issue.provider,
    sourceProvider: issue.sourceProvider,
    sourceKind: issue.sourceKind,
    externalId: issue.externalId,
    hostDomain: issue.hostDomain,
    projectKey: issue.projectKey,
    repository: issue.repository,
    issueNumber: issue.issueNumber,
    issueKey: issue.issueKey,
    title: issue.title,
    url: issue.url,
    state: issue.state,
    labels: issue.labels,
    assignees: issue.assignees,
    issueBodyMarkdown: issue.issueBodyMarkdown,
    issueConversationMarkdown: issue.issueConversationMarkdown,
    includeConversation: issue.includeConversation,
    issueAuthor: issue.issueAuthor,
    issueCreatedAt: issue.issueCreatedAt,
    issueUpdatedAt: issue.issueUpdatedAt,
    metadata: issue.metadata,
  };
}

function hasSearchFilters(input: IssueSearchInput): boolean {
  return Boolean(
    input.search
      || input.repository
      || input.hostDomain
      || input.workspaceId
      || input.providerProjectId
      || input.teamId
      || input.teamKey
      || input.databaseId
      || input.boardId
      || input.documentId
      || input.fileKey
      || input.muralId
      || input.itemTypes?.length
      || input.projectKey
      || input.state
      || input.status
      || input.labels?.length
      || input.assignee
      || input.assigneeText
      || input.author
      || input.reporter
      || input.milestone
      || input.issueText
      || input.createdAfter
      || input.createdBefore
      || input.updatedAfter
      || input.updatedBefore
      || input.sortField
      || input.sortDirection
  );
}

function hasExplicitIssueReferences(input: IssueSearchInput): boolean {
  return Boolean(
    input.issueKeys?.length
      || input.issueNumbers?.length
      || input.issueRefs?.length
      || input.externalIds?.length
      || input.boardId
      || input.documentId
      || input.fileKey
      || input.muralId
      || input.databaseId
  );
}

function buildImportIssueSearchInput(payload: Record<string, unknown>): IssueSearchInput {
  const input: IssueSearchInput = {
    search: readString(payload, "search"),
    provider: parseOptionalEnumStrict(payload, "provider", ["github", "gitlab", "jira", "notion", "asana", "linear", "miro", "lucid", "figma", "mural"] as const),
    repository: readString(payload, "repository"),
    hostDomain: readString(payload, "hostDomain"),
    workspaceId: readString(payload, "workspaceId"),
    providerProjectId: readString(payload, "providerProjectId") || readString(payload, "externalProjectId") || readString(payload, "asanaProjectId") || readString(payload, "linearProjectId"),
    teamId: readString(payload, "teamId"),
    teamKey: readString(payload, "teamKey"),
    databaseId: readString(payload, "databaseId"),
    boardId: readString(payload, "boardId"),
    documentId: readString(payload, "documentId"),
    fileKey: readString(payload, "fileKey"),
    muralId: readString(payload, "muralId"),
    itemTypes: readStringArray(payload, "itemTypes"),
    projectKey: readString(payload, "projectKey"),
    state: parseImportState(payload),
    status: parseImportStatus(payload),
    labels: readStringArray(payload, "labels"),
    assignee: readString(payload, "assignee"),
    assigneeText: readString(payload, "assigneeText"),
    author: readString(payload, "author"),
    reporter: readString(payload, "reporter"),
    milestone: readString(payload, "milestone"),
    issueText: readString(payload, "issueText"),
    issueKeys: readStringArray(payload, "issueKeys"),
    issueNumbers: readNumberArray(payload, "issueNumbers"),
    issueRefs: readStringArray(payload, "issueRefs"),
    externalIds: readStringArray(payload, "externalIds"),
    includeConversation: payload.includeConversation === true ? true : payload.includeConversation === false ? false : undefined,
    createdAfter: readString(payload, "createdAfter"),
    createdBefore: readString(payload, "createdBefore"),
    updatedAfter: readString(payload, "updatedAfter"),
    updatedBefore: readString(payload, "updatedBefore"),
    sortField: parseOptionalEnumStrict(payload, "sortField", ["updated", "created", "comments", "priority", "status", "assignee", "reporter"] as const),
    sortDirection: parseOptionalEnumStrict(payload, "sortDirection", ["asc", "desc"] as const),
    limit: clampImportLimit(parseOptionalIntegerStrict(payload, "limit")),
  };
  return input;
}

function parseImportState(payload: Record<string, unknown>): IssueSearchInput["state"] {
  const provider = typeof payload.provider === "string" ? payload.provider.trim().toLowerCase() : "";
  if (provider === "linear" || provider === "asana" || provider === "notion" || provider === "miro" || provider === "lucid" || provider === "figma" || provider === "mural") {
    return readString(payload, "state");
  }
  return parseOptionalEnumStrict(payload, "state", ["open", "closed", "all"] as const);
}

function parseImportStatus(payload: Record<string, unknown>): IssueSearchInput["status"] {
  const provider = typeof payload.provider === "string" ? payload.provider.trim().toLowerCase() : "";
  if (provider === "linear" || provider === "asana" || provider === "notion" || provider === "miro" || provider === "lucid" || provider === "figma" || provider === "mural") {
    return readString(payload, "status");
  }
  return parseOptionalEnumStrict(payload, "status", ["open", "in_progress", "done", "all"] as const);
}

function assertSprintBelongsToProject(sprint: SprintRecord | null | undefined, sprintId: string, projectId: string): SprintRecord {
  if (!sprint) {
    throw new Error(`Sprint not found: ${sprintId}`);
  }
  if (sprint.projectId !== projectId) {
    throw new Error(`Sprint ${sprintId} does not belong to project ${projectId}`);
  }
  return sprint;
}

interface ImportIssuesResult {
  mode: "search" | "explicit";
  provider: IssueSearchInput["provider"] | null;
  searchedIssues: RepositoryIssueSearchResult[];
  importedContexts: IssuePromptContext[];
  linkedIssues: SprintLinkedIssueRecord[];
  warnings: Array<{ issueId: string; issueKey: string; message: string }>;
  sprint: SprintRecord | null;
  planning: unknown | null;
}

function normalizeCreateSprintInput(payload: Record<string, unknown>): CreateSprintInput {
  const input: CreateSprintInput = {};
  const name = parseOptionalStringAlias(payload, "name", "title");
  const originalPrompt = parseOptionalNullableString(payload, "originalPrompt");
  const goal = parseOptionalStringAlias(payload, "goal", "goalMarkdown");
  const slug = readString(payload, "slug");
  const status = parseOptionalEnumStrict(payload, "status", VALID_SPRINT_STATUSES);
  const linkedIssues = normalizeLinkedIssues(payload.linkedIssues);

  if (name) input.name = name;
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
  const originalPrompt = parseOptionalNullableString(payload, "originalPrompt");
  const goal = parseOptionalStringAlias(payload, "goal", "goalMarkdown");
  const slug = readString(payload, "slug");
  const status = parseOptionalEnumStrict(payload, "status", VALID_SPRINT_STATUSES);
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
  schedulerService?: Pick<SchedulerService, "createEntry">;
  logger?: Logger;
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
        const result = await this.deps.executionControlService.pauseSprintRun(sprintRunId);
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
        const searchInput = buildImportIssueSearchInput(payload);
        const explicitMode = hasExplicitIssueReferences(searchInput);
        const attachToSprint = sprintId !== undefined && payload.attachToSprint !== false;

        if (!explicitMode && !hasSearchFilters(searchInput)) {
          throw new Error("import_issues requires search filters or explicit issue references");
        }
        if (payload.planAfterImport === true && !sprintId) {
          throw new Error("sprintId is required when planAfterImport is true");
        }

        const searchedIssues = explicitMode
          ? []
          : await this.deps.sprintIssueService.searchIssues(projectId, searchInput);
        const importedContexts = explicitMode
          ? await this.deps.sprintIssueService.getIssuePromptContextsForReferences(projectId, searchInput)
          : [];
        const importedLinkedIssues = (explicitMode ? importedContexts : searchedIssues).map(toLinkedIssueInput);

        let linkedIssues: SprintLinkedIssueRecord[] = [];
        let warnings: Array<{ issueId: string; issueKey: string; message: string }> = [];
        let sprint: SprintRecord | null = null;
        if (sprintId && (attachToSprint || payload.planAfterImport === true)) {
          sprint = assertSprintBelongsToProject(
            this.deps.projectManagementRepository.getSprint(sprintId),
            sprintId,
            projectId,
          );
        }

        if (sprintId && attachToSprint) {
          const importResult = await this.deps.sprintIssueService.importLinkedIssues(sprintId, projectId, importedLinkedIssues);
          linkedIssues = importResult.linkedIssues;
          warnings = importResult.warnings;

          const promptIssues = explicitMode
            ? importedContexts
            : searchedIssues.filter((issue) => Boolean(issue.issueBodyMarkdown?.trim() || issue.issueConversationMarkdown?.trim()));
          if (promptIssues.length > 0 && sprint) {
            sprint = this.deps.projectManagementRepository.updateSprint(sprintId, {
              goal: mergePromptWithLinkedIssues(sprint.goal, promptIssues),
            });
          }
        }

        let planning: unknown = null;
        if (payload.planAfterImport === true && sprintId) {
          const options: PlanSprintOptions = {
            autoStart: payload.autoStart === true,
            replan: payload.replan === true,
            planningAgentPresetId: readString(payload, "planningAgentPresetId"),
            overrides: payload.overrides as PlanningOverrides | undefined,
          };
          planning = await this.deps.planningAgentService.planSprint(projectId, sprintId, options);
        }

        const provider = searchInput.provider
          || importedContexts[0]?.provider
          || searchedIssues[0]?.provider
          || null;
        const result: ImportIssuesResult = {
          mode: explicitMode ? "explicit" : "search",
          provider,
          searchedIssues,
          importedContexts,
          linkedIssues,
          warnings,
          sprint,
          planning,
        };
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

        const agentId = getCurrentMcpAgentId();
        const threadId = getCurrentMcpThreadId();
        const planning = this.deps.planningAgentService.startPlanSprint(projectId, sprintId, options);
        void planning.then(
          (result) => this.queuePlanningWakeup({
            projectId,
            sprintId,
            agentId,
            threadId,
            bodyMarkdown: [
              `Planning completed for sprint ${sprintId} with ${result.createdTaskIds.length} task(s).`,
              "Review the generated tasks and provide a concise recap that includes the task count and whether execution started.",
              `Execution started: ${result.started ? "yes" : "no"}.`,
            ].join(" "),
          }),
          (error) => this.queuePlanningWakeup({
            projectId,
            sprintId,
            agentId,
            threadId,
            bodyMarkdown: `Planning failed for sprint ${sprintId}: ${error instanceof Error ? error.message : String(error)}. Provide the user with a concise failure recap.`,
          }),
        ).catch((error) => {
          this.deps.logger?.error("Failed to queue MCP planning wakeup", {
            projectId,
            sprintId,
            error: error instanceof Error ? error.message : String(error),
          });
        });

        return {
          result: {
            status: "started",
            message: "Sprint planning started in the background. You will be notified when it completes or fails.",
            projectId,
            sprintId,
          },
        };
      }
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  private queuePlanningWakeup(args: {
    projectId: string;
    sprintId: string;
    agentId: string | null;
    threadId: string | null;
    bodyMarkdown: string;
  }): void {
    if (!this.deps.schedulerService) {
      this.deps.logger?.warn("Skipping MCP planning wakeup because scheduler service is unavailable", {
        projectId: args.projectId,
        sprintId: args.sprintId,
      });
      return;
    }
    if (!args.agentId || !args.threadId) {
      this.deps.logger?.warn("Skipping MCP planning wakeup because agent or thread context is unavailable", {
        projectId: args.projectId,
        sprintId: args.sprintId,
        hasAgentId: Boolean(args.agentId),
        hasThreadId: Boolean(args.threadId),
      });
      return;
    }

    this.deps.schedulerService.createEntry(args.projectId, {
      title: "Sprint planning update",
      targetType: "agent_wakeup",
      scheduledFor: new Date().toISOString(),
      recurrence: { frequency: "none", interval: 1, endMode: "never" },
      agentWakeupTarget: {
        bodyMarkdown: args.bodyMarkdown,
        threadId: args.threadId,
        origin: "agent_scheduler",
        source: "agent_scheduler",
        createdByAgentId: args.agentId,
      },
    });
  }
}
