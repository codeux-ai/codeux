import type {
  CreateWorkerClarificationInput,
  ListWorkerClarificationsOptions,
  ReplyToWorkerClarificationInput,
  ResolveWorkerClarificationInput,
  WorkerClarificationEventMetadata,
  WorkerClarificationRecord,
  WorkerClarificationReplyResult,
} from "../contracts/worker-clarification-types.js";
import { ExecutionRepository } from "../repositories/execution-repository.js";
import { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import { EntityNotFoundError, ValidationError } from "../repositories/repository-utils.js";
import { WorkerClarificationRepository } from "../repositories/worker-clarification-repository.js";

export const MAX_WORKER_CLARIFICATION_QUESTION_MARKDOWN_CHARS = 16_000;
export const MAX_WORKER_CLARIFICATION_ANSWER_MARKDOWN_CHARS = 32_000;
const MAX_IDENTIFIER_CHARS = 512;

interface NormalizedClarificationScope {
  projectId: string;
  taskId: string | null;
  sprintId: string | null;
  sprintRunId: string | null;
  dispatchId: string | null;
  taskRunId: string | null;
  sessionId: string | null;
}

function requiredText(value: string, label: string, maxChars: number): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new ValidationError(`${label} is required.`);
  if (normalized.length > maxChars) {
    throw new ValidationError(`${label} must be at most ${maxChars} characters.`);
  }
  return normalized;
}

function optionalIdentifier(value: string | null | undefined, label: string): string | null {
  if (value === undefined || value === null) return null;
  return requiredText(value, label, MAX_IDENTIFIER_CHARS);
}

export class WorkerClarificationService {
  constructor(
    private readonly clarificationRepository: WorkerClarificationRepository,
    private readonly projectRepository: ProjectManagementRepository,
    private readonly executionRepository: ExecutionRepository,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  create(input: CreateWorkerClarificationInput): WorkerClarificationRecord {
    const scope = this.normalizeScope(input);
    const requesterAgentId = requiredText(input.requesterAgentId, "Requester agent id", MAX_IDENTIFIER_CHARS);
    const deduplicationKey = requiredText(input.deduplicationKey, "Clarification deduplication key", MAX_IDENTIFIER_CHARS);
    const questionMarkdown = requiredText(
      input.questionMarkdown,
      "Clarification question markdown",
      MAX_WORKER_CLARIFICATION_QUESTION_MARKDOWN_CHARS,
    );
    const clarification = this.clarificationRepository.create({
      ...scope,
      requesterAgentId,
      deduplicationKey,
      questionMarkdown,
      requestedAt: this.now(),
    });
    this.appendTaskRunEvent(clarification, "worker_clarification_requested", requesterAgentId);
    return clarification;
  }

  list(projectId: string, options?: ListWorkerClarificationsOptions): WorkerClarificationRecord[] {
    this.requireProject(requiredText(projectId, "Project id", MAX_IDENTIFIER_CHARS));
    return this.clarificationRepository.list(projectId, options);
  }

  get(projectId: string, clarificationId: string): WorkerClarificationRecord | null {
    this.requireProject(requiredText(projectId, "Project id", MAX_IDENTIFIER_CHARS));
    return this.clarificationRepository.get(
      projectId,
      requiredText(clarificationId, "Clarification id", MAX_IDENTIFIER_CHARS),
    );
  }

  reply(
    projectId: string,
    clarificationId: string,
    input: ReplyToWorkerClarificationInput,
  ): WorkerClarificationReplyResult {
    const normalizedProjectId = requiredText(projectId, "Project id", MAX_IDENTIFIER_CHARS);
    this.requireProject(normalizedProjectId);
    const answerMarkdown = requiredText(
      input.answerMarkdown,
      "Clarification answer markdown",
      MAX_WORKER_CLARIFICATION_ANSWER_MARKDOWN_CHARS,
    );
    const repliedByAgentId = requiredText(input.repliedByAgentId, "Replying agent id", MAX_IDENTIFIER_CHARS);
    const clarification = this.clarificationRepository.markReplied(
      normalizedProjectId,
      requiredText(clarificationId, "Clarification id", MAX_IDENTIFIER_CHARS),
      { answerMarkdown, repliedByAgentId, repliedAt: this.now() },
    );
    this.appendTaskRunEvent(clarification, "worker_clarification_replied", repliedByAgentId);
    return {
      clarification,
      continuation: {
        kind: "worker_clarification_reply",
        clarificationId: clarification.id,
        projectId: clarification.projectId,
        taskId: clarification.taskId,
        sprintId: clarification.sprintId,
        sprintRunId: clarification.sprintRunId,
        dispatchId: clarification.dispatchId,
        taskRunId: clarification.taskRunId,
        sessionId: clarification.sessionId,
        requesterAgentId: clarification.requesterAgentId,
        repliedByAgentId,
        answerMarkdown,
      },
    };
  }

  resolve(
    projectId: string,
    clarificationId: string,
    input: ResolveWorkerClarificationInput,
  ): WorkerClarificationRecord {
    const normalizedProjectId = requiredText(projectId, "Project id", MAX_IDENTIFIER_CHARS);
    this.requireProject(normalizedProjectId);
    const resolvedByAgentId = requiredText(input.resolvedByAgentId, "Resolving agent id", MAX_IDENTIFIER_CHARS);
    const reason = input.reason === undefined
      ? undefined
      : requiredText(input.reason, "Clarification resolution reason", 2_000);
    const clarification = this.clarificationRepository.resolve(
      normalizedProjectId,
      requiredText(clarificationId, "Clarification id", MAX_IDENTIFIER_CHARS),
      { ...input, resolvedByAgentId, reason, resolvedAt: this.now() },
    );
    this.appendTaskRunEvent(clarification, `worker_clarification_${clarification.status}`, resolvedByAgentId);
    return clarification;
  }

  private normalizeScope(input: CreateWorkerClarificationInput): NormalizedClarificationScope {
    const projectId = requiredText(input.projectId, "Project id", MAX_IDENTIFIER_CHARS);
    this.requireProject(projectId);
    let taskId = optionalIdentifier(input.taskId, "Task id");
    let sprintId = optionalIdentifier(input.sprintId, "Sprint id");
    let sprintRunId = optionalIdentifier(input.sprintRunId, "Sprint run id");
    let dispatchId = optionalIdentifier(input.dispatchId, "Dispatch id");
    const taskRunId = optionalIdentifier(input.taskRunId, "Task run id");
    let sessionId = optionalIdentifier(input.sessionId, "Session id");

    const taskRun = taskRunId ? this.executionRepository.getTaskRun(taskRunId) : null;
    if (taskRunId && !taskRun) throw new EntityNotFoundError(`Task run not found: ${taskRunId}`);
    if (taskRun) {
      this.assertProject("Task run", taskRun.id, taskRun.projectId, projectId);
      taskId = this.mergeReference("task", taskId, taskRun.taskId);
      sprintId = this.mergeReference("sprint", sprintId, taskRun.sprintId);
      sprintRunId = this.mergeReference("sprint run", sprintRunId, taskRun.sprintRunId);
      dispatchId = this.mergeReference("dispatch", dispatchId, taskRun.dispatchId);
      sessionId = this.mergeReference("session", sessionId, taskRun.sessionId);
    }

    const dispatch = dispatchId ? this.executionRepository.getTaskDispatch(dispatchId) : null;
    if (dispatchId && !dispatch) throw new EntityNotFoundError(`Task dispatch not found: ${dispatchId}`);
    if (dispatch) {
      this.assertProject("Task dispatch", dispatch.id, dispatch.projectId, projectId);
      taskId = this.mergeReference("task", taskId, dispatch.taskId);
      sprintId = this.mergeReference("sprint", sprintId, dispatch.sprintId);
      sprintRunId = this.mergeReference("sprint run", sprintRunId, dispatch.sprintRunId);
    }

    if (sprintRunId) {
      const sprintRun = this.executionRepository.getSprintRun(sprintRunId);
      if (!sprintRun) throw new EntityNotFoundError(`Sprint run not found: ${sprintRunId}`);
      this.assertProject("Sprint run", sprintRun.id, sprintRun.projectId, projectId);
      sprintId = this.mergeReference("sprint", sprintId, sprintRun.sprintId);
    }
    if (taskId) {
      const task = this.projectRepository.getTask(taskId);
      if (!task) throw new EntityNotFoundError(`Task not found: ${taskId}`);
      this.assertProject("Task", task.id, task.projectId, projectId);
      sprintId = this.mergeReference("sprint", sprintId, task.sprintId);
    }
    if (sprintId) {
      const sprint = this.projectRepository.getSprint(sprintId);
      if (!sprint) throw new EntityNotFoundError(`Sprint not found: ${sprintId}`);
      this.assertProject("Sprint", sprint.id, sprint.projectId, projectId);
    }

    return { projectId, taskId, sprintId, sprintRunId, dispatchId, taskRunId, sessionId };
  }

  private requireProject(projectId: string): void {
    if (!this.projectRepository.getProject(projectId)) {
      throw new EntityNotFoundError(`Project not found: ${projectId}`);
    }
  }

  private assertProject(label: string, id: string, actualProjectId: string, expectedProjectId: string): void {
    if (actualProjectId !== expectedProjectId) {
      throw new ValidationError(`${label} ${id} does not belong to project ${expectedProjectId}.`);
    }
  }

  private mergeReference(label: string, supplied: string | null, actual: string | null): string | null {
    if (!actual) return supplied;
    if (supplied && supplied !== actual) {
      throw new ValidationError(`Clarification ${label} reference does not match the linked runtime record.`);
    }
    return actual;
  }

  private appendTaskRunEvent(record: WorkerClarificationRecord, eventType: string, originator: string): void {
    if (!record.taskRunId) return;
    const metadata: WorkerClarificationEventMetadata = {
      clarificationId: record.id,
      attentionItemId: record.id,
      projectId: record.projectId,
      sprintId: record.sprintId,
      taskId: record.taskId,
      sprintRunId: record.sprintRunId,
      dispatchId: record.dispatchId,
      taskRunId: record.taskRunId,
      sessionId: record.sessionId,
      requesterAgentId: record.requesterAgentId,
      status: record.status,
    };
    this.executionRepository.appendTaskRunEvent(record.taskRunId, eventType, originator, { ...metadata }, {
      sourceEventKey: `worker-clarification:${record.id}:${eventType}`,
    });
  }
}
