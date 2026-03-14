import type { ProjectAttentionItemRecord, ProjectAttentionType, WorkerAttentionOutcome } from "../../contracts/project-attention-types.js";
import { ConnectionChatRepository } from "../../repositories/connection-chat-repository.js";
import { ProjectAttentionService } from "./project-attention-service.js";

export interface ReportWorkerAttentionOutcomeInput {
  attentionItemId: string;
  workerEndpointId: string;
  connectionId: string;
  outcome: WorkerAttentionOutcome;
  summaryMarkdown: string;
  resolutionReason?: string;
  threadTitle?: string;
}

export interface ReportWorkerAttentionOutcomeResult {
  sourceItem: ProjectAttentionItemRecord;
  handoffItem: ProjectAttentionItemRecord | null;
  threadId: string | null;
  threadMessageId: string | null;
}

interface HandoffSpec {
  attentionType: Extract<ProjectAttentionType, "dashboard_reply_required" | "human_escalation_required">;
  titlePrefix: string;
  heading: string;
}

export class WorkerAttentionOutcomeService {
  constructor(
    private readonly projectAttentionService: ProjectAttentionService,
    private readonly connectionChatRepository: ConnectionChatRepository,
  ) {}

  reportOutcome(input: ReportWorkerAttentionOutcomeInput): ReportWorkerAttentionOutcomeResult {
    const summaryMarkdown = input.summaryMarkdown.trim();
    if (!summaryMarkdown) {
      throw new Error("summaryMarkdown is required when reporting a worker attention outcome.");
    }

    const current = this.requireWorkerOwnedItem(input.attentionItemId, input.workerEndpointId);
    const currentPayload = current.payload || {};
    if (
      current.status !== "open"
      && current.status !== "claimed"
      && currentPayload.workerOutcome === input.outcome
    ) {
      const handoffAttentionItemId = this.readPayloadString(currentPayload.handoffAttentionItemId);
      return {
        sourceItem: current,
        handoffItem: handoffAttentionItemId ? this.projectAttentionService.getItem(handoffAttentionItemId) : null,
        threadId: this.readPayloadString(currentPayload.handoffThreadId),
        threadMessageId: this.readPayloadString(currentPayload.handoffThreadMessageId),
      };
    }

    if (input.outcome === "handled_locally") {
      return {
        sourceItem: this.projectAttentionService.resolveItem(current.id, {
          status: "resolved",
          reason: input.resolutionReason || "worker_handled_locally",
          resolutionSummaryMarkdown: this.buildHandledLocallySummary(current, summaryMarkdown),
          workerEndpointId: input.workerEndpointId,
          payloadPatch: {
            workerOutcome: input.outcome,
            workerOutcomeSummaryMarkdown: summaryMarkdown,
          },
        }),
        handoffItem: null,
        threadId: null,
        threadMessageId: null,
      };
    }

    const handoffSpec = this.getHandoffSpec(input.outcome);
    const thread = this.connectionChatRepository.createThread(current.projectId, {
      title: input.threadTitle?.trim() || `${handoffSpec.titlePrefix}: ${current.title}`,
      connectionId: input.connectionId,
    });
    const message = this.connectionChatRepository.postSystemMessage(current.projectId, {
      threadId: thread.id,
      connectionId: input.connectionId,
      bodyMarkdown: this.buildHandoffThreadMessage(current, input.outcome, summaryMarkdown),
    });
    const handoffItem = this.projectAttentionService.openItem({
      projectId: current.projectId,
      sprintId: current.sprintId,
      taskId: current.taskId,
      sprintRunId: current.sprintRunId,
      dispatchId: current.dispatchId,
      attentionType: handoffSpec.attentionType,
      severity: current.severity,
      ownerType: "human",
      title: `${handoffSpec.titlePrefix}: ${current.title}`,
      summaryMarkdown,
      payload: {
        ...(current.payload || {}),
        sourceAttentionItemId: current.id,
        sourceAttentionType: current.attentionType,
        workerOutcome: input.outcome,
        workerOutcomeSummaryMarkdown: summaryMarkdown,
        handoffThreadId: thread.id,
        handoffThreadMessageId: message.id,
        triggeredByWorkerEndpointId: input.workerEndpointId,
      },
    });
    const resolvedSource = this.projectAttentionService.resolveItem(current.id, {
      status: "resolved",
      reason: input.resolutionReason || `worker_outcome_${input.outcome}`,
      resolutionSummaryMarkdown: this.buildResolvedSourceSummary(current, handoffSpec.heading, summaryMarkdown),
      workerEndpointId: input.workerEndpointId,
      payloadPatch: {
        workerOutcome: input.outcome,
        workerOutcomeSummaryMarkdown: summaryMarkdown,
        handoffAttentionItemId: handoffItem.id,
        handoffThreadId: thread.id,
        handoffThreadMessageId: message.id,
      },
    });

    return {
      sourceItem: resolvedSource,
      handoffItem,
      threadId: thread.id,
      threadMessageId: message.id,
    };
  }

  private requireWorkerOwnedItem(itemId: string, workerEndpointId: string): ProjectAttentionItemRecord {
    const item = this.projectAttentionService.getItem(itemId);
    if (!item) {
      throw new Error(`Project attention item not found: ${itemId}`);
    }
    if (item.ownerType !== "worker") {
      throw new Error(`Attention item ${itemId} is not worker-owned.`);
    }
    if (item.assignedWorkerEndpointId && item.assignedWorkerEndpointId !== workerEndpointId) {
      throw new Error(`Attention item ${itemId} is assigned to another worker endpoint.`);
    }
    return item;
  }

  private getHandoffSpec(outcome: Exclude<WorkerAttentionOutcome, "handled_locally">): HandoffSpec {
    if (outcome === "needs_dashboard_reply") {
      return {
        attentionType: "dashboard_reply_required",
        titlePrefix: "Dashboard reply needed",
        heading: "Needs dashboard reply",
      };
    }

    return {
      attentionType: "human_escalation_required",
      titlePrefix: "Human escalation required",
      heading: "Needs human escalation",
    };
  }

  private buildHandledLocallySummary(item: ProjectAttentionItemRecord, summaryMarkdown: string): string {
    return [
      item.summaryMarkdown.trim(),
      "",
      "Worker outcome: handled locally.",
      "",
      summaryMarkdown,
    ].filter(Boolean).join("\n");
  }

  private buildResolvedSourceSummary(
    item: ProjectAttentionItemRecord,
    heading: string,
    summaryMarkdown: string,
  ): string {
    return [
      item.summaryMarkdown.trim(),
      "",
      `Worker outcome: ${heading}.`,
      "",
      summaryMarkdown,
    ].filter(Boolean).join("\n");
  }

  private buildHandoffThreadMessage(
    item: ProjectAttentionItemRecord,
    outcome: Exclude<WorkerAttentionOutcome, "handled_locally">,
    summaryMarkdown: string,
  ): string {
    const repoPath = this.readPayloadString(item.payload?.repoPath);
    const workingDirectoryHint = this.readPayloadString(item.payload?.workingDirectoryHint);
    const lines = [
      `## Worker attention outcome`,
      "",
      `Outcome: ${outcome === "needs_dashboard_reply" ? "Needs dashboard reply" : "Needs human escalation"}`,
      `Attention item: ${item.id}`,
      `Attention type: ${item.attentionType}`,
      `Severity: ${item.severity}`,
    ];

    if (repoPath) {
      lines.push(`Repo path: ${repoPath}`);
    }
    if (workingDirectoryHint) {
      lines.push(`Working directory hint: ${workingDirectoryHint}`);
    }

    lines.push(
      "",
      "Worker summary:",
      summaryMarkdown,
      "",
      "Original blocker:",
      item.summaryMarkdown.trim(),
    );

    return lines.join("\n");
  }

  private readPayloadString(value: unknown): string | null {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  }
}
